import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandRunner, RunRecoveryDecision } from "./types.ts";
export class RunRecoveryMutationError extends Error {
  readonly action: Exclude<RunRecoveryDecision["action"], "refuse">;
  readonly completed: RunRecoveryMutationResult["completed"];
  readonly quarantinePaths: string[];
  readonly stagingPaths: string[];
  readonly preservedPaths: string[];
  constructor(
    cause: unknown,
    action: Exclude<RunRecoveryDecision["action"], "refuse">,
    completed: RunRecoveryMutationResult["completed"],
    quarantinePaths: string[],
    stagingPaths: string[],
  ) {
    super(
      `Recovery mutation failed during ${action}: ${cause instanceof Error ? cause.message : String(cause)}\nCompleted actions: ${completed.map((entry) => entry.kind).join(", ") || "none"}\nPreserved paths: ${[...new Set([...quarantinePaths, ...stagingPaths, ...completed.flatMap((entry) => (entry.kind === "publish-worktree" ? [entry.to] : []))])].join(", ") || "none"}`,
    );
    this.name = "RunRecoveryMutationError";
    this.cause = cause;
    this.action = action;
    this.completed = completed;
    this.quarantinePaths = quarantinePaths;
    this.stagingPaths = stagingPaths;
    this.preservedPaths = [
      ...new Set([
        ...quarantinePaths,
        ...stagingPaths,
        ...completed.flatMap((entry) =>
          entry.kind === "publish-worktree" ? [entry.to] : [],
        ),
      ]),
    ];
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
function worktreePath(repoRoot: string, path: string): string {
  return resolve(repoRoot, path);
}
async function assertExpectedPathAbsent(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Recovery target path appeared: ${path}`);
}
async function assertBranchOid(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
  expectedOid: string,
): Promise<void> {
  const result = await runner.run(
    "git",
    ["rev-parse", "--verify", `${branch}^{commit}`],
    { cwd: repoRoot },
  );
  if (result.code !== 0 || result.stdout.trim() !== expectedOid)
    throw new Error(`Recovery branch changed before publication: ${branch}`);
}
async function assertWorkspaceUnchanged(
  runner: CommandRunner,
  path: string,
  label: string,
): Promise<void> {
  const ordinary = await runner.run("git", [
    "-C",
    path,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const ignored = await runner.run("git", [
    "-C",
    path,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignored=matching",
  ]);
  if (
    ordinary.code !== 0 ||
    ignored.code !== 0 ||
    ordinary.stdout.trim() ||
    ignored.stdout.trim()
  )
    throw new Error(
      `Recovery workspace changed at ${label}; preserved without publishing or ref update`,
    );
}
function sameRefresh(
  next: Exclude<RunRecoveryDecision, { action: "refuse" }>,
  current: Extract<RunRecoveryDecision, { action: "refresh-and-resume" }>,
): boolean {
  return (
    next.action === "refresh-and-resume" &&
    JSON.stringify(next.refresh) === JSON.stringify(current.refresh)
  );
}
function sameRecreation(
  next: Exclude<RunRecoveryDecision, { action: "refuse" }>,
  current: Extract<RunRecoveryDecision, { action: "recreate-and-resume" }>,
): boolean {
  return (
    next.action === "recreate-and-resume" &&
    JSON.stringify(next.recreation) === JSON.stringify(current.recreation)
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
      if (!sameRefresh(next, input.decision))
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
      await assertWorkspaceUnchanged(
        input.runner,
        worktreePath(input.repoRoot, p.quarantinePath),
        "quarantine",
      );
      await command(
        input.runner,
        worktreePath(input.repoRoot, p.quarantinePath),
        [
          "update-ref",
          "--no-deref",
          "HEAD",
          p.expectedBranchOid,
          p.expectedBranchOid,
        ],
      );
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
      await assertWorkspaceUnchanged(
        input.runner,
        worktreePath(input.repoRoot, p.stagingPath),
        "staging",
      );
      await command(input.runner, worktreePath(input.repoRoot, p.stagingPath), [
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
      await assertWorkspaceUnchanged(
        input.runner,
        p.expectedWorktreePath,
        "published workspace",
      );
      return {
        action: input.decision.action,
        completed,
        quarantinePaths,
        stagingPaths,
      };
    }
    if (input.decision.action === "recreate-and-resume") {
      const p = input.decision.recreation;
      const beforeCreation = nonRefusal(await input.reassess());
      if (!sameRecreation(beforeCreation, input.decision))
        throw new Error(
          "Recovery evidence changed before workspace recreation",
        );
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
      await assertBranchOid(
        input.runner,
        input.repoRoot,
        p.branch,
        p.targetOid,
      );
      await assertExpectedPathAbsent(
        worktreePath(input.repoRoot, p.expectedWorktreePath),
      );
      await assertWorkspaceUnchanged(
        input.runner,
        worktreePath(input.repoRoot, p.stagingPath),
        "staging",
      );
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
      await assertWorkspaceUnchanged(
        input.runner,
        p.expectedWorktreePath,
        "published workspace",
      );
      return {
        action: input.decision.action,
        completed,
        quarantinePaths,
        stagingPaths,
      };
    }
    const p = input.decision.cleanup;
    const beforeQuarantine = nonRefusal(await input.reassess());
    if (
      beforeQuarantine.action !== "archive-reset-and-start" ||
      beforeQuarantine.cleanup.branch !== p.branch ||
      beforeQuarantine.cleanup.expectedWorktreePath !==
        p.expectedWorktreePath ||
      beforeQuarantine.cleanup.expectedBranchOid !== p.expectedBranchOid ||
      beforeQuarantine.cleanup.quarantinePath !== p.quarantinePath
    )
      throw new Error("Recovery evidence changed before workspace quarantine");
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
      const ordinary = await input.runner.run("git", [
        "-C",
        worktreePath(input.repoRoot, p.quarantinePath),
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]);
      const ignored = await input.runner.run("git", [
        "-C",
        worktreePath(input.repoRoot, p.quarantinePath),
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
      ]);
      if (
        ordinary.code !== 0 ||
        ignored.code !== 0 ||
        ordinary.stdout.trim() ||
        ignored.stdout.trim()
      )
        throw new Error(
          "Recovery workspace changed after quarantine; preserved without ref deletion",
        );
      if (p.expectedBranchOid) {
        await command(
          input.runner,
          worktreePath(input.repoRoot, p.quarantinePath),
          [
            "update-ref",
            "--no-deref",
            "HEAD",
            p.expectedBranchOid,
            p.expectedBranchOid,
          ],
        );
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
    throw new RunRecoveryMutationError(
      error,
      input.decision.action,
      completed,
      quarantinePaths,
      stagingPaths,
    );
  }
}
