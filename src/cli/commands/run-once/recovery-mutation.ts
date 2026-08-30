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
function worktreePath(repoRoot: string, path: string): string {
  return resolve(repoRoot, path);
}
function listedWorktreePaths(repoRoot: string, output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));
}

function registeredPrunable(
  repoRoot: string,
  output: string,
  expected: string,
): boolean {
  return output.split("\n\n").some((entry) => {
    const path = entry
      .split("\n")
      .find((line) => line.startsWith("worktree "))
      ?.slice("worktree ".length);
    return (
      path !== undefined &&
      resolve(repoRoot, path) === expected &&
      entry
        .split("\n")
        .some((line) => line === "prunable" || line.startsWith("prunable "))
    );
  });
}
/**
 * Git only exposes stale-registration deletion through repository-wide prune.
 * Its dry-run reports internal administrative paths rather than worktree paths,
 * so require a verified prunable expected registration and exactly one planned
 * removal. Any other candidate is an unrelated repository-side effect.
 */
function pruneDryRunCandidates(output: string): string[] {
  const lines = output.split("\n").filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines) {
    const match = /^Removing (.+?): /u.exec(line);
    if (!match?.[1])
      throw new Error(
        `Cannot prove worktree prune target from: ${line}; repair the expected registration manually`,
      );
    candidates.push(match[1]);
  }
  return candidates;
}
async function pruneStaleRegistration(
  runner: CommandRunner,
  repoRoot: string,
  expectedPath: string,
): Promise<void> {
  const expected = worktreePath(repoRoot, expectedPath);
  const before = await runner.run("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  if (before.code !== 0)
    throw new Error(
      `Cannot inspect stale worktree registration: ${before.stderr || before.stdout}`,
    );
  if (!listedWorktreePaths(repoRoot, before.stdout).includes(expected))
    throw new Error(
      `Expected stale worktree registration is absent: ${expected}; repair manually before recovery`,
    );
  if (!registeredPrunable(repoRoot, before.stdout, expected))
    throw new Error(
      `Expected worktree registration is not proven stale: ${expected}; repair manually before recovery`,
    );
  const dryRun = await runner.run(
    "git",
    ["worktree", "prune", "--dry-run", "--verbose", "--expire=now"],
    { cwd: repoRoot },
  );
  if (dryRun.code !== 0)
    throw new Error(
      `Cannot preflight stale worktree registration cleanup: ${dryRun.stderr || dryRun.stdout}`,
    );
  const candidates = pruneDryRunCandidates(
    [dryRun.stdout, dryRun.stderr].filter(Boolean).join("\n"),
  );
  if (candidates.length !== 1)
    throw new Error(
      `Refusing repository-wide worktree prune; expected only ${expected}, found ${candidates.join(", ") || "no removable registration"}. Repair manually before recovery`,
    );
  await command(runner, repoRoot, ["worktree", "prune", "--expire=now"]);
  const listed = await runner.run("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  if (listed.code !== 0)
    throw new Error(
      `Cannot verify stale worktree registration: ${listed.stderr || listed.stdout}`,
    );
  if (listedWorktreePaths(repoRoot, listed.stdout).includes(expected))
    throw new Error(
      `Stale worktree registration remains after prune: ${expected}; preserved without branch mutation`,
    );
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
      if (p.pruneStaleRegistration) {
        await pruneStaleRegistration(
          input.runner,
          input.repoRoot,
          p.expectedWorktreePath,
        );
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
      beforeQuarantine.cleanup.quarantinePath !== p.quarantinePath ||
      beforeQuarantine.cleanup.pruneStaleRegistration !==
        p.pruneStaleRegistration
    )
      throw new Error("Recovery evidence changed before workspace quarantine");
    if (p.pruneStaleRegistration) {
      if (!p.expectedWorktreePath)
        throw new Error(
          "Stale registration cleanup requires an expected worktree path",
        );
      await pruneStaleRegistration(
        input.runner,
        input.repoRoot,
        p.expectedWorktreePath,
      );
      completed.push({ kind: "prune-stale-registration" });
    } else if (p.expectedWorktreePath && p.quarantinePath) {
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
