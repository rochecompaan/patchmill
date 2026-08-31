import type { CommandRunner, RunRecoveryDecision } from "./types.ts";
import type { RunRecoveryMutationResult } from "./recovery-mutation.ts";
import {
  assertRecoveryWorkspaceUnchanged,
  recoveryCommand,
  recoveryWorktreePath,
} from "./recovery-mutation-helpers.ts";

/** Execute the reset-only preserving cleanup after a pinned reassessment. */
export async function executeResetRecoveryMutation(input: {
  decision: Extract<RunRecoveryDecision, { action: "archive-reset-and-start" }>;
  runner: CommandRunner;
  repoRoot: string;
  reassess: () => Promise<RunRecoveryDecision>;
  completed: RunRecoveryMutationResult["completed"];
  quarantinePaths: string[];
}): Promise<void> {
  const p = input.decision.cleanup;
  const next = await input.reassess();
  if (next.action === "refuse")
    throw new Error("Recovery reassessment refused mutation");
  if (
    next.action !== "archive-reset-and-start" ||
    next.cleanup.branch !== p.branch ||
    next.cleanup.expectedWorktreePath !== p.expectedWorktreePath ||
    next.cleanup.expectedBranchOid !== p.expectedBranchOid ||
    next.cleanup.quarantinePath !== p.quarantinePath
  )
    throw new Error("Recovery evidence changed before workspace quarantine");
  if (p.expectedWorktreePath && p.quarantinePath) {
    await recoveryCommand(input.runner, input.repoRoot, [
      "worktree",
      "move",
      p.expectedWorktreePath,
      p.quarantinePath,
    ]);
    input.quarantinePaths.push(p.quarantinePath);
    input.completed.push({
      kind: "quarantine-worktree",
      from: p.expectedWorktreePath,
      to: p.quarantinePath,
    });
    const quarantine = recoveryWorktreePath(input.repoRoot, p.quarantinePath);
    try {
      await assertRecoveryWorkspaceUnchanged(
        input.runner,
        quarantine,
        "quarantine",
      );
    } catch {
      throw new Error(
        "Recovery workspace changed after quarantine; preserved without ref deletion",
      );
    }
    if (p.expectedBranchOid) {
      await recoveryCommand(input.runner, quarantine, [
        "update-ref",
        "--no-deref",
        "HEAD",
        p.expectedBranchOid,
        p.expectedBranchOid,
      ]);
      input.completed.push({
        kind: "detach-quarantine",
        path: p.quarantinePath,
        oid: p.expectedBranchOid,
      });
    }
  }
  if (p.branch && p.expectedBranchOid) {
    await recoveryCommand(input.runner, input.repoRoot, [
      "update-ref",
      "-d",
      `refs/heads/${p.branch}`,
      p.expectedBranchOid,
    ]);
    input.completed.push({
      kind: "update-branch",
      branch: p.branch,
      from: p.expectedBranchOid,
    });
  }
}
