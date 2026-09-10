import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  ImplementationCompletePlanningPhase,
  ImplementationPullRequestOpenPlanningPhase,
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
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
  now?: () => Date;
};

function resultFor(
  phase:
    | ImplementationPullRequestOpenPlanningPhase
    | ImplementationCompletePlanningPhase,
): AgentIssuePrCreatedResult {
  return {
    status: "pr-created",
    prUrl: phase.pullRequest.url,
    branch: phase.implementation.branch,
    commits: [...phase.implementation.commits],
    validation: [...phase.implementation.validation],
    ...(phase.implementation.reviewSummary === undefined
      ? {}
      : { reviewSummary: phase.implementation.reviewSummary }),
    ...(phase.implementation.landingDecision === undefined
      ? {}
      : { landingDecision: phase.implementation.landingDecision }),
    visualEvidence: phase.implementation.visualEvidence.map((evidence) => ({
      screenshotPath: evidence.screenshotPath,
      ...(evidence.caption === undefined ? {} : { caption: evidence.caption }),
      ...(evidence.referencePaths === undefined
        ? {}
        : { referencePaths: [...evidence.referencePaths] }),
      ...(evidence.url === undefined ? {} : { url: evidence.url }),
    })),
  };
}

async function checkpoint(
  input: PlanningFinishInput,
  state: PlanningStateV1,
  phase: PlanningPhaseStateV1,
): Promise<PlanningStateV1> {
  return input.stateStore.replace({
    issueNumber: state.issueNumber,
    expectedRunId: state.runId,
    expectedRevision: state.revision,
    lock: input.lock,
    next: {
      ...state,
      revision: state.revision + 1,
      updatedAt: (input.now ?? (() => new Date()))().toISOString(),
      phases: state.phases.map((item, index) =>
        index === input.phaseIndex ? phase : item,
      ),
    },
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
    return { state, result: resultFor(initial) };
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
    } catch {
      /* established best effort */
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
    input.effects.postHandoff(resultFor(phase)),
  );
  await effect("cleanupHookCompleted", input.effects.cleanupHook);
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
  return { state, result: resultFor(complete) };
}
