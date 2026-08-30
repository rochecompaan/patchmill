import type { CommandRunner, RunRecoveryDecision } from "./types.ts";
export class RunRecoveryMutationError extends Error {
  readonly action: Exclude<RunRecoveryDecision["action"], "refuse">;
  readonly completed: RunRecoveryMutationResult["completed"];
  readonly quarantinePaths: string[];
  readonly stagingPaths: string[];
  constructor(
    cause: unknown,
    action: Exclude<RunRecoveryDecision["action"], "refuse">,
    completed: RunRecoveryMutationResult["completed"],
    quarantinePaths: string[],
    stagingPaths: string[],
  ) {
    super(
      `Recovery mutation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "RunRecoveryMutationError";
    this.cause = cause;
    this.action = action;
    this.completed = completed;
    this.quarantinePaths = quarantinePaths;
    this.stagingPaths = stagingPaths;
  }
}
export type RunRecoveryMutationResult = {
  action: Exclude<RunRecoveryDecision["action"], "refuse">;
  completed: Array<
    | { kind: "stage-worktree"; path: string; oid: string }
    | { kind: "quarantine-worktree"; from: string; to: string }
    | { kind: "restore-worktree"; from: string; to: string }
    | { kind: "detach-quarantine"; path: string; oid: string }
    | { kind: "update-branch"; branch: string; from?: string; to?: string }
    | { kind: "prune-stale-registration" }
    | { kind: "publish-worktree"; from: string; to: string }
    | { kind: "recreate-worktree"; worktreePath: string; oid: string }
  >;
  quarantinePaths: string[];
  stagingPaths: string[];
};
function nonRefusal(
  decision: RunRecoveryDecision,
): Exclude<RunRecoveryDecision, { action: "refuse" }> {
  if (decision.action === "refuse")
    throw new Error("Recovery reassessment refused mutation");
  return decision;
}
async function command(
  runner: CommandRunner,
  repoRoot: string,
  args: string[],
): Promise<void> {
  const result = await runner.run("git", args, { cwd: repoRoot });
  if (result.code !== 0)
    throw new Error(
      `Recovery git mutation failed: git ${args.join(" ")}\n${result.stderr || result.stdout}`,
    );
}
export async function executeRunRecoveryMutation(input: {
  decision: Exclude<RunRecoveryDecision, { action: "refuse" }>;
  runner: CommandRunner;
  repoRoot: string;
  reassess: () => Promise<RunRecoveryDecision>;
}): Promise<RunRecoveryMutationResult> {
  const completed: RunRecoveryMutationResult["completed"] = [];
  const quarantinePaths: string[] = [];
  const stagingPaths: string[] = [];
  try {
    if (input.decision.action === "resume")
      return { action: "resume", completed, quarantinePaths, stagingPaths };
    if (input.decision.action === "refresh-and-resume") {
      const p = input.decision.refresh;
      await command(input.runner, input.repoRoot, [
        "worktree",
        "add",
        "--detach",
        p.stagingPath,
        p.baseOid,
      ]);
      stagingPaths.push(p.stagingPath);
      completed.push({
        kind: "stage-worktree",
        path: p.stagingPath,
        oid: p.baseOid,
      });
      const next = nonRefusal(await input.reassess());
      if (
        next.action !== "refresh-and-resume" ||
        next.refresh.expectedBranchOid !== p.expectedBranchOid ||
        next.refresh.baseOid !== p.baseOid
      )
        throw new Error("Recovery evidence changed before workspace refresh");
      await command(input.runner, input.repoRoot, [
        "worktree",
        "move",
        p.expectedWorktreePath,
        p.quarantinePath,
      ]);
      quarantinePaths.push(p.quarantinePath);
      completed.push({
        kind: "quarantine-worktree",
        from: p.expectedWorktreePath,
        to: p.quarantinePath,
      });
      await command(input.runner, p.quarantinePath, [
        "update-ref",
        "--no-deref",
        "HEAD",
        p.expectedBranchOid,
        p.expectedBranchOid,
      ]);
      completed.push({
        kind: "detach-quarantine",
        path: p.quarantinePath,
        oid: p.expectedBranchOid,
      });
      await command(input.runner, input.repoRoot, [
        "update-ref",
        `refs/heads/${p.branch}`,
        p.baseOid,
        p.expectedBranchOid,
      ]);
      completed.push({
        kind: "update-branch",
        branch: p.branch,
        from: p.expectedBranchOid,
        to: p.baseOid,
      });
      await command(input.runner, p.stagingPath, [
        "symbolic-ref",
        "HEAD",
        `refs/heads/${p.branch}`,
      ]);
      await command(input.runner, input.repoRoot, [
        "worktree",
        "move",
        p.stagingPath,
        p.expectedWorktreePath,
      ]);
      completed.push({
        kind: "publish-worktree",
        from: p.stagingPath,
        to: p.expectedWorktreePath,
      });
      return {
        action: input.decision.action,
        completed,
        quarantinePaths,
        stagingPaths,
      };
    }
    if (input.decision.action === "recreate-and-resume") {
      const p = input.decision.recreation;
      if (p.pruneStaleRegistration) {
        await command(input.runner, input.repoRoot, ["worktree", "prune"]);
        completed.push({ kind: "prune-stale-registration" });
      }
      if (p.mode === "advance-to-base" && p.expectedBranchOid) {
        await command(input.runner, input.repoRoot, [
          "update-ref",
          `refs/heads/${p.branch}`,
          p.targetOid,
          p.expectedBranchOid,
        ]);
        completed.push({
          kind: "update-branch",
          branch: p.branch,
          from: p.expectedBranchOid,
          to: p.targetOid,
        });
      }
      const ref = p.mode === "create-from-base" ? p.targetOid : p.branch;
      await command(
        input.runner,
        input.repoRoot,
        p.mode === "create-from-base"
          ? ["worktree", "add", "-b", p.branch, p.stagingPath, ref]
          : ["worktree", "add", p.stagingPath, ref],
      );
      stagingPaths.push(p.stagingPath);
      completed.push({
        kind: "recreate-worktree",
        worktreePath: p.stagingPath,
        oid: p.targetOid,
      });
      nonRefusal(await input.reassess());
      await command(input.runner, input.repoRoot, [
        "worktree",
        "move",
        p.stagingPath,
        p.expectedWorktreePath,
      ]);
      completed.push({
        kind: "publish-worktree",
        from: p.stagingPath,
        to: p.expectedWorktreePath,
      });
      return {
        action: input.decision.action,
        completed,
        quarantinePaths,
        stagingPaths,
      };
    }
    const p = input.decision.cleanup;
    if (p.expectedWorktreePath && p.quarantinePath) {
      await command(input.runner, input.repoRoot, [
        "worktree",
        "move",
        p.expectedWorktreePath,
        p.quarantinePath,
      ]);
      quarantinePaths.push(p.quarantinePath);
      completed.push({
        kind: "quarantine-worktree",
        from: p.expectedWorktreePath,
        to: p.quarantinePath,
      });
      const afterQuarantine = nonRefusal(await input.reassess());
      if (
        afterQuarantine.action !== "archive-reset-and-start" ||
        afterQuarantine.cleanup.expectedBranchOid !== p.expectedBranchOid ||
        afterQuarantine.cleanup.branch !== p.branch
      )
        throw new Error("Recovery evidence changed after workspace quarantine");
      if (p.expectedBranchOid) {
        await command(input.runner, p.quarantinePath, [
          "update-ref",
          "--no-deref",
          "HEAD",
          p.expectedBranchOid,
          p.expectedBranchOid,
        ]);
        completed.push({
          kind: "detach-quarantine",
          path: p.quarantinePath,
          oid: p.expectedBranchOid,
        });
      }
    }
    if (p.branch && p.expectedBranchOid) {
      await command(input.runner, input.repoRoot, [
        "update-ref",
        "-d",
        `refs/heads/${p.branch}`,
        p.expectedBranchOid,
      ]);
      completed.push({
        kind: "update-branch",
        branch: p.branch,
        from: p.expectedBranchOid,
      });
    }
    return {
      action: input.decision.action,
      completed,
      quarantinePaths,
      stagingPaths,
    };
  } catch (error) {
    if (completed.length || quarantinePaths.length || stagingPaths.length)
      throw new RunRecoveryMutationError(
        error,
        input.decision.action,
        completed,
        quarantinePaths,
        stagingPaths,
      );
    throw error;
  }
}
