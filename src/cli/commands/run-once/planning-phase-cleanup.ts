import type { PlanningRemoteHead } from "../../../git/planning-publication-git.ts";
import type {
  PlanningWorkspaceLifecycle,
  PlanningWorkspaceOwnership,
} from "../../../git/planning-workspaces.ts";
import type { PullRequestOpenPlanningPhase } from "../../../workflow/planning-state-types.ts";

type PlanningPhaseCleanupCandidate = Pick<
  PullRequestOpenPlanningPhase,
  "base" | "publication" | "workspace"
>;

export type PlanningPhaseCleanupOutcome =
  | Readonly<{
      kind: "cleanup-pending";
      phase: PullRequestOpenPlanningPhase;
      reason: "ignored-worktree-content";
      ignoredPaths: readonly string[];
    }>
  | Readonly<{ kind: "cleaned"; phase: PullRequestOpenPlanningPhase }>
  | Readonly<{
      kind: "remote-head-changed";
      phase: PullRequestOpenPlanningPhase;
      remoteHead: PlanningRemoteHead;
    }>;

export async function finishPlanningPhaseCleanup(input: {
  phase: PullRequestOpenPlanningPhase;
  workspaces: PlanningWorkspaceLifecycle;
  remoteHead: (
    phase: PlanningPhaseCleanupCandidate,
  ) => Promise<PlanningRemoteHead>;
  checkpoint: (phase: PullRequestOpenPlanningPhase) => Promise<void>;
}): Promise<PlanningPhaseCleanupOutcome> {
  let phase = input.phase;
  const cleanup = phase.workspace.cleanup;
  if (cleanup.state === "ready" || cleanup.state === "cleanup-pending") {
    const remoteHead = await input.remoteHead(phase);
    if (
      typeof remoteHead !== "object" ||
      remoteHead === null ||
      (remoteHead.state !== "missing" &&
        (remoteHead.state !== "present" ||
          typeof remoteHead.headOid !== "string"))
    )
      throw new TypeError("Invalid planning remote head observation");
    if (
      remoteHead.state !== "present" ||
      remoteHead.headOid !== phase.publication.headOid
    )
      return { kind: "remote-head-changed", phase, remoteHead };
    const removal = await input.workspaces.removeWorktree({
      runId: phase.workspace.runId,
      phase: phase.kind,
      workspace: { ...phase.workspace, cleanup },
    });
    switch (removal?.kind) {
      case "cleanup-pending": {
        const cleanup = {
          state: "cleanup-pending" as const,
          reason: removal.reason,
          ignoredPaths: [...removal.ignoredPaths],
        };
        if (
          JSON.stringify(phase.workspace.cleanup) !== JSON.stringify(cleanup)
        ) {
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
      case "removed":
        break;
      default:
        throw new TypeError("Invalid planning worktree removal outcome");
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
