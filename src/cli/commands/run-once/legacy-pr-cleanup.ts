import { resolve } from "node:path";
import { runCleanupHookScript } from "../../../pi/hooks.ts";
import { PlanningWorkspaceGit } from "../../../git/planning-workspace-git.ts";
import { PlanningWorkspaceConflictError } from "../../../git/planning-workspaces.ts";
import { writeRunState } from "./run-state.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import type { PipelineFinishStageOptions } from "./pipeline-finish.ts";
import type { AgentIssueCleanupPendingResult } from "./types.ts";

/** Uses the same guarded expected-head and ignored-content cleanup as planning. */
export async function cleanupLegacyPublishedWorkspace(
  options: PipelineFinishStageOptions,
): Promise<AgentIssueCleanupPendingResult | undefined> {
  if (!options.implementationPr || !options.branch)
    throw new Error("Cleanup requires saved PR ownership");
  const publication = options.implementationPr.publication;
  const runId = options.lease.record.ownerToken;
  const workspace = {
    runId,
    phase: "implementation" as const,
    identity: {
      branch: options.branch,
      worktreePath: resolve(options.config.repoRoot, options.worktreePath),
    },
    remote: options.config.remote,
    baseBranch: publication.baseBranch,
    // Cleanup uses this pinned commit only for ownership/head checks, not as merge proof.
    baseOid: publication.headOid,
    headOid: publication.headOid,
  };
  const git = new PlanningWorkspaceGit({
    runner: options.runner,
    repoRoot: options.config.repoRoot,
    worktreeRoot: resolve(options.config.repoRoot, options.config.worktreeDir),
    ...(options.mutation ? { mutation: options.mutation } : {}),
  });
  const checkpoint = async (
    key: "cleanupHookCompleted" | "worktreeRemoved" | "branchRemoved",
  ) => {
    await writeRunState(
      options.config.runStateDir,
      {
        issueNumber: options.issue.number,
        status: "implementing",
        checkpoints: { [key]: true },
      },
      options.lease,
      options.timestamp,
    );
    options.checkpoints[key] = true;
  };
  if (!options.checkpoints.cleanupHookCompleted) {
    const snapshot = await git.inspect(workspace.identity);
    if (snapshot.state === "ready") {
      if (snapshot.headOid !== publication.headOid)
        throw new PlanningWorkspaceConflictError(
          "head-oid-mismatch",
          workspace.identity,
        );
      const effects = await runCleanupHookScript(
        options.runner,
        options.config.repoRoot,
        options.worktreePath,
        options.config.cleanupHook,
      );
      const failed = effects.find((effect) => effect.status === "failed");
      if (failed) throw new Error(failed.message);
    }
    await checkpoint("cleanupHookCompleted");
  }
  if (!options.checkpoints.worktreeRemoved) {
    const outcome = await git.removeWorktree({
      runId,
      phase: "implementation",
      workspace: { ...workspace, cleanup: { state: "ready" } },
    });
    if (outcome.kind === "cleanup-pending")
      return {
        status: "cleanup-pending",
        issue: options.issue,
        phase: "implementation",
        reason: "ignored-worktree-content",
        prUrl: options.implementationPr.url,
        branch: options.branch,
        worktreePath: options.worktreePath,
        ignoredPaths: [...outcome.ignoredPaths],
        remediation: [
          "Preserve or remove the listed ignored content, then rerun this explicit issue.",
        ],
        publicFailure: runOnceFailure("ignored-worktree-content", {
          issueNumber: options.issue.number,
          status: "cleanup-pending",
          phase: "implementation",
          branch: options.branch,
          worktreePath: options.worktreePath,
          ignoredPaths: outcome.ignoredPaths,
        }),
      };
    await checkpoint("worktreeRemoved");
  }
  if (!options.checkpoints.branchRemoved) {
    await git.removeBranch({
      runId,
      phase: "implementation",
      workspace: {
        ...workspace,
        cleanup: {
          state: "worktree-removed",
          pushedHeadOid: publication.headOid,
        },
      },
      authorization: { kind: "merged-terminal" },
    });
    await checkpoint("branchRemoved");
  }
}
