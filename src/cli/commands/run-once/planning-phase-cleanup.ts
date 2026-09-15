import type {
  PlanningWorkspaceCleanupPending,
  PlanningWorkspaceLifecycle,
  PlanningWorkspaceOwnership,
} from "../../../git/planning-workspaces.ts";
import type {
  BranchPushedPlanningPhase,
  PullRequestOpenPlanningPhase,
} from "../../../workflow/planning-state-types.ts";

export type PlanningPhaseCleanupOutcome =
  | Readonly<{
      kind: "cleanup-pending";
      phase: PullRequestOpenPlanningPhase;
      reason: "ignored-worktree-content";
      ignoredPaths: readonly string[];
    }>
  | Readonly<{ kind: "cleaned"; phase: PullRequestOpenPlanningPhase }>;

export async function finishPlanningPhaseCleanup(input: {
  phase: PullRequestOpenPlanningPhase;
  workspaces: PlanningWorkspaceLifecycle;
  remoteHead: (phase: BranchPushedPlanningPhase) => Promise<void>;
  checkpoint: (phase: PullRequestOpenPlanningPhase) => Promise<void>;
}): Promise<PlanningPhaseCleanupOutcome> {
  let phase = input.phase;
  if (
    phase.workspace.cleanup.state === "ready" ||
    phase.workspace.cleanup.state === "cleanup-pending"
  ) {
    await input.remoteHead({
      ...phase,
      status: "branch-pushed",
      workspace: { ...phase.workspace, cleanup: { state: "ready" } },
    });
    const removal = await input.workspaces.removeWorktree({
      runId: phase.workspace.runId,
      phase: phase.kind,
      workspace: phase.workspace as PlanningWorkspaceOwnership<
        { state: "ready" } | PlanningWorkspaceCleanupPending
      >,
    });
    if (removal?.kind === "cleanup-pending") {
      const cleanup = {
        state: "cleanup-pending" as const,
        reason: removal.reason,
        ignoredPaths: [...removal.ignoredPaths],
      };
      if (JSON.stringify(phase.workspace.cleanup) !== JSON.stringify(cleanup)) {
        phase = { ...phase, workspace: { ...phase.workspace, cleanup } };
        await input.checkpoint(phase);
      }
      return {
        kind: "cleanup-pending",
        phase,
        reason: cleanup.reason,
        ignoredPaths: cleanup.ignoredPaths,
      };
    }
    phase = {
      ...phase,
      workspace: {
        ...phase.workspace,
        cleanup: {
          state: "worktree-removed",
          pushedHeadOid: phase.publication.headOid,
        },
      },
    };
    await input.checkpoint(phase);
  }
  if (phase.workspace.cleanup.state === "worktree-removed") {
    await input.workspaces.removeBranch({
      runId: phase.workspace.runId,
      phase: phase.kind,
      workspace: phase.workspace as PlanningWorkspaceOwnership<{
        state: "worktree-removed";
        pushedHeadOid: string;
      }>,
    });
    phase = {
      ...phase,
      workspace: {
        ...phase.workspace,
        cleanup: { state: "removed", pushedHeadOid: phase.publication.headOid },
      },
    };
    await input.checkpoint(phase);
  }
  return { kind: "cleaned", phase };
}
