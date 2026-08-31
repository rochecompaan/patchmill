import type { CommandRunner, RunRecoveryDecision } from "./types.ts";
import type { RunRecoveryMutationResult } from "./recovery-mutation.ts";
import {
  assertRecoveryBranchOid,
  assertRecoveryPathAbsent,
  assertRecoveryWorkspaceUnchanged,
  recoveryCommand,
  recoveryWorktreePath,
} from "./recovery-mutation-helpers.ts";

export async function executeRecreateRecoveryMutation(input: {
  decision: Extract<RunRecoveryDecision, { action: "recreate-and-resume" }>;
  runner: CommandRunner;
  repoRoot: string;
  reassess: () => Promise<RunRecoveryDecision>;
  completed: RunRecoveryMutationResult["completed"];
  stagingPaths: string[];
}): Promise<void> {
  const p = input.decision.recreation;
  const next = await input.reassess();
  if (next.action === "refuse")
    throw new Error("Recovery reassessment refused mutation");
  if (
    next.action !== "recreate-and-resume" ||
    JSON.stringify(next.recreation) !== JSON.stringify(p)
  )
    throw new Error("Recovery evidence changed before workspace recreation");
  if (p.mode === "advance-to-base" && p.expectedBranchOid) {
    await recoveryCommand(input.runner, input.repoRoot, [
      "update-ref",
      `refs/heads/${p.branch}`,
      p.targetOid,
      p.expectedBranchOid,
    ]);
    input.completed.push({
      kind: "update-branch",
      branch: p.branch,
      from: p.expectedBranchOid,
      to: p.targetOid,
    });
  }
  const ref = p.mode === "create-from-base" ? p.targetOid : p.branch;
  await recoveryCommand(
    input.runner,
    input.repoRoot,
    p.mode === "create-from-base"
      ? ["worktree", "add", "-b", p.branch, p.stagingPath, ref]
      : ["worktree", "add", p.stagingPath, ref],
  );
  input.stagingPaths.push(p.stagingPath);
  input.completed.push({
    kind: "recreate-worktree",
    worktreePath: p.stagingPath,
    oid: p.targetOid,
  });
  await assertRecoveryBranchOid(
    input.runner,
    input.repoRoot,
    p.branch,
    p.targetOid,
  );
  await assertRecoveryPathAbsent(
    recoveryWorktreePath(input.repoRoot, p.expectedWorktreePath),
  );
  await assertRecoveryWorkspaceUnchanged(
    input.runner,
    recoveryWorktreePath(input.repoRoot, p.stagingPath),
    "staging",
  );
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
