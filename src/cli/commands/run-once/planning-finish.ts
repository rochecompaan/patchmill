import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import { PlanningWorkspaceConflictError } from "../../../git/planning-workspaces.ts";
import type {
  PlanningWorkspaceCleanupPending,
  PlanningWorkspaceLifecycle,
  PlanningWorkspaceOwnership,
} from "../../../git/planning-workspaces.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  ImplementationCompletePlanningPhase,
  ImplementationPullRequestOpenPlanningPhase,
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import {
  durableImplementationResult,
  durableMergedImplementationResult,
} from "./planning-runtime-state.ts";
import type { ImplementationPrReconciliation } from "../../../workflow/implementation-pr-reconciliation.ts";
import type {
  AgentIssuePrCreatedResult,
  AgentIssueMergedResult,
} from "../../../issue-run/types.ts";

export type PlanningImplementationFinishOutcome =
  | Readonly<{
      kind: "complete";
      state: PlanningStateV1;
      result: AgentIssueMergedResult;
    }>
  | Readonly<{
      kind: "implementation-published";
      state: PlanningStateV1;
      result: AgentIssuePrCreatedResult;
    }>
  | Readonly<{ kind: "blocked"; state: PlanningStateV1; reason: string }>;

export type PlanningFinishInput = {
  state: PlanningStateV1;
  phaseIndex: number;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  git: Pick<PlanningPublicationOperations, "inspectRemoteHead">;
  reconcilePr: (
    phase:
      | ImplementationPullRequestOpenPlanningPhase
      | ImplementationCompletePlanningPhase,
  ) => Promise<ImplementationPrReconciliation>;
  workspaces: Pick<
    PlanningWorkspaceLifecycle,
    "removeWorktree" | "removeBranch"
  >;
  effects: {
    publishCost: () => Promise<void>;
    validateVisualEvidence: () => Promise<void>;
    postHandoff: (result: AgentIssuePrCreatedResult) => Promise<void>;
    cleanupHook: () => Promise<void>;
    ensureDoneLabel: () => Promise<void>;
    applyDoneLabels: () => Promise<void>;
  };
  onCostPublicationFailure?: (error: unknown) => Promise<void>;
  now?: () => Date;
};

async function checkpoint(
  input: PlanningFinishInput,
  state: PlanningStateV1,
  phase: PlanningPhaseStateV1,
): Promise<PlanningStateV1> {
  return replacePlanningPhase({
    stateStore: input.stateStore,
    lock: input.lock,
    state,
    phaseIndex: input.phaseIndex,
    phase,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/** Applies one strict durable checkpoint after each finish effect. */
export async function finishPlanningImplementation(
  input: PlanningFinishInput,
): Promise<PlanningImplementationFinishOutcome> {
  let state = input.state;
  const initial = state.phases[input.phaseIndex];
  if (initial?.kind !== "implementation")
    throw new RangeError("Invalid implementation phase");
  if (initial.status === "complete")
    return {
      kind: "complete",
      state,
      result: durableMergedImplementationResult(initial),
    };
  if (initial.status !== "pull-request-open")
    throw new RangeError("Implementation pull request has not been validated");
  let phase: ImplementationPullRequestOpenPlanningPhase = initial;
  const reconciliation = await input.reconcilePr(phase);
  if (reconciliation.kind === "blocked")
    return { kind: "blocked", state, reason: reconciliation.reason };
  if (reconciliation.kind === "merged" && phase.merge === undefined) {
    phase = {
      ...phase,
      merge: {
        mergeOid: reconciliation.mergeOid,
        mergedBaseOid: reconciliation.mergedBaseOid,
      },
    };
    state = await checkpoint(input, state, phase);
  }
  if (
    phase.merge &&
    (reconciliation.kind !== "merged" ||
      phase.merge.mergeOid !== reconciliation.mergeOid)
  )
    return {
      kind: "blocked",
      state,
      reason: "Saved merge evidence conflicts with the host PR",
    };
  const effect = async (
    key: keyof ImplementationPullRequestOpenPlanningPhase["finish"],
    run: () => Promise<void>,
  ) => {
    if (phase.finish[key] === true) return;
    await run();
    phase = { ...phase, finish: { ...phase.finish, [key]: true } };
    state = await checkpoint(input, state, phase);
    phase = state.phases[
      input.phaseIndex
    ] as ImplementationPullRequestOpenPlanningPhase;
  };
  // Cost publication is deliberately best-effort but still gets a handled checkpoint.
  if (phase.finish.costPublicationCompleted !== true) {
    try {
      await input.effects.publishCost();
    } catch (error) {
      await input.onCostPublicationFailure?.(error);
    }
    phase = {
      ...phase,
      finish: { ...phase.finish, costPublicationCompleted: true },
    };
    state = await checkpoint(input, state, phase);
    phase = state.phases[
      input.phaseIndex
    ] as ImplementationPullRequestOpenPlanningPhase;
  }
  await effect("visualEvidenceValidated", input.effects.validateVisualEvidence);
  await effect("handoffCommentPosted", () =>
    input.effects.postHandoff(durableImplementationResult(phase)),
  );
  if (phase.finish.cleanupHookCompleted !== true) {
    await input.effects.cleanupHook();
    phase = {
      ...phase,
      finish: { ...phase.finish, cleanupHookCompleted: true },
    };
    state = await checkpoint(input, state, phase);
    phase = state.phases[
      input.phaseIndex
    ] as ImplementationPullRequestOpenPlanningPhase;
  }
  if (
    phase.workspace.cleanup.state === "ready" ||
    phase.workspace.cleanup.state === "cleanup-pending"
  ) {
    // A verified merge authorizes cleanup even if the remote branch is gone.
    if (reconciliation.kind === "open") {
      // Saved finish checkpoints do not prove the current remote HEAD.
      const remoteHead = await input.git.inspectRemoteHead({
        remote: phase.workspace.remote,
        branch: phase.publication.headBranch,
      });
      if (
        remoteHead.state !== "present" ||
        remoteHead.headOid !== phase.publication.headOid
      )
        throw new PlanningWorkspaceConflictError(
          "remote-head-mismatch",
          phase.workspace.identity,
        );
    }
    const removal = await input.workspaces.removeWorktree({
      runId: state.runId,
      phase: "implementation",
      workspace: phase.workspace as PlanningWorkspaceOwnership<
        { state: "ready" } | PlanningWorkspaceCleanupPending
      >,
    });
    if (removal?.kind !== "removed")
      throw new TypeError("Invalid planning worktree removal outcome");
    phase = {
      ...phase,
      workspace: {
        ...phase.workspace,
        cleanup: {
          state: "worktree-removed",
          pushedHeadOid: phase.workspace.headOid,
        },
      },
    };
    state = await checkpoint(input, state, phase);
    phase = state.phases[
      input.phaseIndex
    ] as ImplementationPullRequestOpenPlanningPhase;
  }
  if (phase.workspace.cleanup.state === "worktree-removed") {
    await input.workspaces.removeBranch({
      runId: state.runId,
      phase: "implementation",
      workspace: {
        ...phase.workspace,
        cleanup: {
          state: "worktree-removed",
          pushedHeadOid: phase.workspace.cleanup.pushedHeadOid,
        },
      },
      authorization: {
        kind:
          reconciliation.kind === "merged" ? "merged-terminal" : "publication",
      },
    });
    phase = {
      ...phase,
      workspace: {
        ...phase.workspace,
        cleanup: {
          state: "removed",
          pushedHeadOid: phase.workspace.cleanup.pushedHeadOid,
        },
      },
    };
    state = await checkpoint(input, state, phase);
    phase = state.phases[
      input.phaseIndex
    ] as ImplementationPullRequestOpenPlanningPhase;
  }
  if (reconciliation.kind === "open")
    return {
      kind: "implementation-published",
      state,
      result: durableImplementationResult(phase),
    };
  await effect("doneLabelEnsured", input.effects.ensureDoneLabel);
  await effect("doneLabelApplied", input.effects.applyDoneLabels);
  const complete = {
    ...phase,
    status: "complete" as const,
    workspace: {
      ...phase.workspace,
      cleanup: {
        state: "removed" as const,
        pushedHeadOid: phase.workspace.headOid,
      },
    },
    finish: phase.finish as Required<
      ImplementationPullRequestOpenPlanningPhase["finish"]
    >,
    completion: { kind: "implementation-pull-request" as const },
  } as ImplementationCompletePlanningPhase;
  state = await checkpoint(input, state, complete);
  return {
    kind: "complete",
    state,
    result: durableMergedImplementationResult(complete),
  };
}
