import type {
  PlanningWorkspaceLifecycle,
  PlanningWorkspaceOwnership,
} from "../../../git/planning-workspaces.ts";
import type {
  BranchPushedPlanningPhase,
  PullRequestOpenPlanningPhase,
} from "../../../workflow/planning-state-types.ts";

export async function finishPlanningPhaseCleanup(input: {
  phase: PullRequestOpenPlanningPhase;
  workspaces: PlanningWorkspaceLifecycle;
  remoteHead: (phase: BranchPushedPlanningPhase) => Promise<void>;
  checkpoint: (phase: PullRequestOpenPlanningPhase) => Promise<void>;
}): Promise<PullRequestOpenPlanningPhase> {
  let phase = input.phase;
  if (phase.workspace.cleanup.state === "ready") {
    await input.remoteHead({
      ...phase,
      status: "branch-pushed",
      workspace: phase.workspace as BranchPushedPlanningPhase["workspace"],
    });
    await input.workspaces.removeWorktree({
      runId: phase.workspace.runId,
      phase: phase.kind,
      workspace: phase.workspace as BranchPushedPlanningPhase["workspace"],
    });
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
  return phase;
}
