import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  ImplementationCompletePlanningPhase,
  ImplementationPullRequestOpenPlanningPhase,
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import { durableImplementationResult } from "./planning-runtime-state.ts";
import type { AgentIssuePrCreatedResult } from "./types.ts";

export type PlanningFinishInput = {
  state: PlanningStateV1;
  phaseIndex: number;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
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
): Promise<{ state: PlanningStateV1; result: AgentIssuePrCreatedResult }> {
  let state = input.state;
  const initial = state.phases[input.phaseIndex];
  if (initial?.kind !== "implementation")
    throw new RangeError("Invalid implementation phase");
  if (initial.status === "complete")
    return { state, result: durableImplementationResult(initial) };
  if (initial.status !== "pull-request-open")
    throw new RangeError("Implementation pull request has not been validated");
  let phase: ImplementationPullRequestOpenPlanningPhase = initial;
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
  if (
    phase.finish.cleanupHookStarted === true &&
    phase.finish.cleanupHookCompleted !== true
  )
    throw new Error(
      "Planning cleanup hook outcome is unknown; operator repair required",
    );
  if (phase.finish.cleanupHookCompleted !== true) {
    phase = { ...phase, finish: { ...phase.finish, cleanupHookStarted: true } };
    state = await checkpoint(input, state, phase);
    phase = state.phases[
      input.phaseIndex
    ] as ImplementationPullRequestOpenPlanningPhase;
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
  if (phase.workspace.cleanup.state === "ready") {
    await input.workspaces.removeWorktree({
      runId: state.runId,
      phase: "implementation",
      workspace: { ...phase.workspace, cleanup: { state: "ready" } },
    });
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
  return { state, result: durableImplementationResult(complete) };
}
