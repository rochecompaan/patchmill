import type { CommandRunner, RunRecoveryDecision } from "./types.ts";
import type { RunRecoveryMutationResult } from "./recovery-mutation.ts";
import {
  assertRecoveryWorkspaceUnchanged,
  recoveryCommand,
  recoveryWorktreePath,
} from "./recovery-mutation-helpers.ts";

export async function executeRefreshRecoveryMutation(input: {
  decision: Extract<RunRecoveryDecision, { action: "refresh-and-resume" }>;
  runner: CommandRunner;
  repoRoot: string;
  reassess: () => Promise<RunRecoveryDecision>;
  completed: RunRecoveryMutationResult["completed"];
  quarantinePaths: string[];
  stagingPaths: string[];
}): Promise<void> {
  const p = input.decision.refresh;
  await recoveryCommand(input.runner, input.repoRoot, [
    "worktree",
    "add",
    "--detach",
    p.stagingPath,
    p.baseOid,
  ]);
  input.stagingPaths.push(p.stagingPath);
  input.completed.push({
    kind: "stage-worktree",
    path: p.stagingPath,
    oid: p.baseOid,
  });
  const next = await input.reassess();
  if (next.action === "refuse")
    throw new Error("Recovery reassessment refused mutation");
  if (
    next.action !== "refresh-and-resume" ||
    JSON.stringify(next.refresh) !== JSON.stringify(p)
  )
    throw new Error("Recovery evidence changed before workspace refresh");
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
  await assertRecoveryWorkspaceUnchanged(
    input.runner,
    quarantine,
    "quarantine",
  );
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
  await recoveryCommand(input.runner, input.repoRoot, [
    "update-ref",
    `refs/heads/${p.branch}`,
    p.baseOid,
    p.expectedBranchOid,
  ]);
  input.completed.push({
    kind: "update-branch",
    branch: p.branch,
    from: p.expectedBranchOid,
    to: p.baseOid,
  });
  const staging = recoveryWorktreePath(input.repoRoot, p.stagingPath);
  await assertRecoveryWorkspaceUnchanged(input.runner, staging, "staging");
  await recoveryCommand(input.runner, staging, [
    "symbolic-ref",
    "HEAD",
    `refs/heads/${p.branch}`,
  ]);
  await recoveryCommand(input.runner, input.repoRoot, [
    "worktree",
    "move",
    p.stagingPath,
    p.expectedWorktreePath,
  ]);
  input.completed.push({
    kind: "publish-worktree",
    from: p.stagingPath,
    to: p.expectedWorktreePath,
  });
  await assertRecoveryWorkspaceUnchanged(
    input.runner,
    p.expectedWorktreePath,
    "published workspace",
  );
}
