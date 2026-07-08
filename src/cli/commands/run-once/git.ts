import { access } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
  buildIssueBranchName as buildIssueBranchNameFromStrategy,
  buildIssueBranchSlug,
  buildIssueWorktreePath as buildIssueWorktreePathFromStrategy,
} from "../../../git/worktree-strategy.ts";
import type { GitWorktreeStrategyConfig } from "../../../git/types.ts";
import type { CommandResult, CommandRunner } from "./types.ts";

export { buildIssueBranchSlug };

export type BaseBranchDetectionResult =
  | { status: "detected"; branch: string; source: "remote-head" | "upstream" }
  | { status: "fallback"; branch: string; reason: string };

function resolveStrategy(
  strategyOrBaseRef:
    | GitWorktreeStrategyConfig
    | string = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.baseRef,
  worktreeDir = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.worktreeDir,
): GitWorktreeStrategyConfig {
  if (typeof strategyOrBaseRef === "string") {
    return {
      ...DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
      baseRef: strategyOrBaseRef,
      worktreeDir,
    };
  }

  return strategyOrBaseRef;
}

export function buildIssueBranchName(
  issueNumber: number,
  title: string,
  strategy: Pick<
    GitWorktreeStrategyConfig,
    "branchPrefix" | "slugLength"
  > = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
): string {
  return buildIssueBranchNameFromStrategy(issueNumber, title, strategy);
}

export function buildIssueWorktreePath(
  issueNumber: number,
  title: string,
  strategyOrWorktreeDir:
    | Pick<
        GitWorktreeStrategyConfig,
        "worktreeDir" | "worktreePrefix" | "slugLength"
      >
    | string = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
): string {
  const strategy =
    typeof strategyOrWorktreeDir === "string"
      ? {
          ...DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
          worktreeDir: strategyOrWorktreeDir,
        }
      : strategyOrWorktreeDir;
  return buildIssueWorktreePathFromStrategy(issueNumber, title, strategy);
}

export function cleanStatusIgnoredPaths(config: {
  cleanStatusIgnorePrefixes?: string[];
  runStateDir: string;
  todoRoot: string;
  additionalPaths?: string[];
}): string[] {
  return [
    ...new Set([
      ...(config.cleanStatusIgnorePrefixes ?? []),
      config.todoRoot,
      config.runStateDir,
      ...(config.additionalPaths ?? []),
    ]),
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCommandFailure(message: string, result: CommandResult): string {
  const output =
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "(no output)";
  return `${message} with exit code ${result.code}: ${output}`;
}

function branchFromRemoteRef(
  remote: string,
  value: string,
): string | undefined {
  const ref = value.trim();
  const shortPrefix = `${remote}/`;
  const fullPrefix = `refs/remotes/${remote}/`;
  const branch = ref.startsWith(shortPrefix)
    ? ref.slice(shortPrefix.length)
    : ref.startsWith(fullPrefix)
      ? ref.slice(fullPrefix.length)
      : undefined;
  return branch && branch.trim().length > 0 ? branch : undefined;
}

async function detectRemoteHeadBranch(
  runner: CommandRunner,
  repoRoot: string,
  remote: string,
): Promise<string | undefined> {
  const result = await runner.run(
    "git",
    ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`],
    { cwd: repoRoot },
  );
  if (result.code !== 0) return undefined;
  return branchFromRemoteRef(remote, result.stdout);
}

async function detectUpstreamBranch(
  runner: CommandRunner,
  repoRoot: string,
  remote: string,
): Promise<string | undefined> {
  const result = await runner.run(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd: repoRoot },
  );
  if (result.code !== 0) return undefined;
  return branchFromRemoteRef(remote, result.stdout);
}

export async function detectDefaultBaseBranch(
  runner: CommandRunner,
  repoRoot: string,
  remote: string,
  fallbackBranch = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.baseBranch,
): Promise<BaseBranchDetectionResult> {
  const remoteHeadBranch = await detectRemoteHeadBranch(
    runner,
    repoRoot,
    remote,
  );
  if (remoteHeadBranch) {
    return {
      status: "detected",
      branch: remoteHeadBranch,
      source: "remote-head",
    };
  }

  const upstreamBranch = await detectUpstreamBranch(runner, repoRoot, remote);
  if (upstreamBranch) {
    return { status: "detected", branch: upstreamBranch, source: "upstream" };
  }

  return {
    status: "fallback",
    branch: fallbackBranch,
    reason: "remote-head-and-upstream-unavailable",
  };
}

function issueBaseTargetRef(remote: string, baseBranch: string): string {
  return `refs/remotes/${remote}/${baseBranch}`;
}

async function verifyCommitRef(
  runner: CommandRunner,
  repoRoot: string,
  ref: string,
  failure: string,
): Promise<void> {
  const result = await runner.run(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(formatCommandFailure(failure, result));
  }
}

function normalizeGitPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/u, "");
}

function ignoredStatusPrefixes(
  repoRoot: string,
  ignoredPaths: string[],
): string[] {
  const prefixes = new Set<string>();

  for (const ignoredPath of ignoredPaths) {
    const relativePath = normalizeGitPath(
      relative(repoRoot, resolve(repoRoot, ignoredPath)),
    );
    if (
      relativePath === "" ||
      relativePath.startsWith("../") ||
      relativePath === ".."
    )
      continue;
    prefixes.add(relativePath);
  }

  return [...prefixes];
}

function isIgnoredStatusPath(path: string, ignoredPrefixes: string[]): boolean {
  const normalizedPath = normalizeGitPath(path.trim());
  return ignoredPrefixes.some(
    (prefix) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
}

export function blockingStatusOutput(
  stdout: string,
  repoRoot: string,
  ignoredPaths: string[] = [],
): string {
  const ignoredPrefixes = ignoredStatusPrefixes(repoRoot, ignoredPaths);
  return stdout
    .split("\n")
    .filter(
      (line) =>
        line.trim() !== "" &&
        !isIgnoredStatusPath(line.slice(3), ignoredPrefixes),
    )
    .join("\n");
}

export async function assertCleanWorktree(
  runner: CommandRunner,
  repoRoot: string,
  ignoredPaths: string[] = [],
): Promise<void> {
  const result = await runner.run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(formatCommandFailure("git status failed", result));
  }

  const dirtyOutput = blockingStatusOutput(
    result.stdout,
    repoRoot,
    ignoredPaths,
  );
  if (dirtyOutput !== "") {
    throw new Error(`Repository worktree is not clean: ${dirtyOutput}`);
  }
}

export async function assertIssueBaseContainedInPrBase(
  runner: CommandRunner,
  repoRoot: string,
  baseRef: string,
  remote: string,
  baseBranch: string,
): Promise<void> {
  const targetRef = issueBaseTargetRef(remote, baseBranch);

  await verifyCommitRef(
    runner,
    repoRoot,
    baseRef,
    `Configured git.baseRef ${baseRef} could not be resolved to a commit`,
  );
  await verifyCommitRef(
    runner,
    repoRoot,
    targetRef,
    `Configured PR target base ${targetRef} could not be resolved to a commit. Run git fetch ${remote}, or fix git.remote/git.baseBranch`,
  );

  const result = await runner.run(
    "git",
    ["log", "--oneline", `${targetRef}..${baseRef}`],
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(
      formatCommandFailure(
        `git log failed while checking whether git.baseRef ${baseRef} is contained in ${targetRef}`,
        result,
      ),
    );
  }

  const leakedCommits = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (leakedCommits.length === 0) return;

  throw new Error(
    [
      `Configured git.baseRef ${baseRef} is not contained in ${targetRef}.`,
      `These commits would be included in the issue PR:`,
      ...leakedCommits,
      ``,
      `Push or merge these commits into ${remote}/${baseBranch}, run git fetch if the remote ref is stale, or configure git.baseRef to a ref already contained in ${targetRef}.`,
    ].join("\n"),
  );
}

export async function createIssueWorktree(
  runner: CommandRunner,
  repoRoot: string,
  issueNumber: number,
  title: string,
  strategyOrBaseRef:
    | GitWorktreeStrategyConfig
    | string = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.baseRef,
  worktreeDir = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.worktreeDir,
): Promise<{ branch: string; worktreePath: string }> {
  const strategy = resolveStrategy(strategyOrBaseRef, worktreeDir);
  const branch = buildIssueBranchName(issueNumber, title, strategy);
  const worktreePath = buildIssueWorktreePath(issueNumber, title, strategy);
  const result = await runner.run(
    "git",
    ["worktree", "add", "-b", branch, worktreePath, strategy.baseRef],
    {
      cwd: repoRoot,
    },
  );
  if (result.code !== 0) {
    throw new Error(
      formatCommandFailure(
        `git worktree add failed for issue #${issueNumber}`,
        result,
      ),
    );
  }

  return { branch, worktreePath };
}

export type IssueWorktreeResult = {
  branch: string;
  worktreePath: string;
  created: boolean;
  hasExistingCommits: boolean;
  existingCommits: string[];
};

export type CleanupIssueWorkspaceStep = "worktree" | "branch";

export type CleanupIssueWorkspaceResult = {
  step: CleanupIssueWorkspaceStep;
  status: "cleaned" | "failed";
  message: string;
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  code: number;
};

async function commandOutput(
  runner: CommandRunner,
  repoRoot: string,
  args: string[],
  failure: string,
): Promise<string> {
  const result = await runner.run("git", args, { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(formatCommandFailure(failure, result));
  }

  return result.stdout;
}

async function branchExists(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
): Promise<boolean> {
  const result = await runner.run(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: repoRoot },
  );
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new Error(
    formatCommandFailure(`git show-ref failed for ${branch}`, result),
  );
}

async function existingCommitLines(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
  baseRef: string,
): Promise<string[]> {
  const result = await runner.run(
    "git",
    ["log", "--oneline", `${baseRef}..${branch}`],
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(
      formatCommandFailure(`git log failed for ${branch}`, result),
    );
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function porcelainWorktreePaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length).trim()));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureIssueWorktree(
  runner: CommandRunner,
  repoRoot: string,
  issueNumber: number,
  title: string,
  strategyOrBaseRef:
    | GitWorktreeStrategyConfig
    | string = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.baseRef,
  worktreeDir = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.worktreeDir,
  ignoredPaths: string[] = [],
): Promise<IssueWorktreeResult> {
  const strategy = resolveStrategy(strategyOrBaseRef, worktreeDir);
  const branch = buildIssueBranchName(issueNumber, title, strategy);
  const worktreePath = buildIssueWorktreePath(issueNumber, title, strategy);
  const listed = await commandOutput(
    runner,
    repoRoot,
    ["worktree", "list", "--porcelain"],
    "git worktree list failed",
  );
  const expectedWorktreePath = resolve(repoRoot, worktreePath);
  const hasWorktree =
    porcelainWorktreePaths(listed).includes(expectedWorktreePath);

  if (hasWorktree) {
    const currentBranch = (
      await commandOutput(
        runner,
        repoRoot,
        ["-C", worktreePath, "branch", "--show-current"],
        `git branch failed for ${worktreePath}`,
      )
    ).trim();
    if (currentBranch !== branch) {
      throw new Error(
        `Existing worktree ${worktreePath} is on ${currentBranch}, expected ${branch}`,
      );
    }

    await assertCleanWorktree(
      runner,
      resolve(repoRoot, worktreePath),
      ignoredPaths,
    );
    const existingCommits = await existingCommitLines(
      runner,
      repoRoot,
      branch,
      strategy.baseRef,
    );
    return {
      branch,
      worktreePath,
      created: false,
      hasExistingCommits: existingCommits.length > 0,
      existingCommits,
    };
  }

  if (await pathExists(expectedWorktreePath)) {
    throw new Error(
      `Existing path ${worktreePath} is not a registered git worktree`,
    );
  }

  if (await branchExists(runner, repoRoot, branch)) {
    const result = await runner.run(
      "git",
      ["worktree", "add", worktreePath, branch],
      { cwd: repoRoot },
    );
    if (result.code !== 0) {
      throw new Error(
        formatCommandFailure(
          `git worktree add failed for issue #${issueNumber}`,
          result,
        ),
      );
    }

    const existingCommits = await existingCommitLines(
      runner,
      repoRoot,
      branch,
      strategy.baseRef,
    );
    return {
      branch,
      worktreePath,
      created: true,
      hasExistingCommits: existingCommits.length > 0,
      existingCommits,
    };
  }

  const created = await createIssueWorktree(
    runner,
    repoRoot,
    issueNumber,
    title,
    strategy,
  );
  return {
    ...created,
    created: true,
    hasExistingCommits: false,
    existingCommits: [],
  };
}

function cleanupResult(config: {
  step: CleanupIssueWorkspaceStep;
  successMessage: string;
  failureMessage: string;
  command: string;
  args: string[];
  cwd: string;
  result: CommandResult;
}): CleanupIssueWorkspaceResult {
  const status = config.result.code === 0 ? "cleaned" : "failed";
  return {
    step: config.step,
    status,
    message:
      status === "cleaned"
        ? config.successMessage
        : `${config.failureMessage} with exit code ${config.result.code}`,
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    stdout: config.result.stdout,
    stderr: config.result.stderr,
    code: config.result.code,
  };
}

export async function cleanupIssueWorkspace(
  runner: CommandRunner,
  repoRoot: string,
  workspace: { branch: string; worktreePath: string },
): Promise<CleanupIssueWorkspaceResult[]> {
  const worktreeArgs = ["worktree", "remove", workspace.worktreePath];
  let worktreeResult: CommandResult;
  try {
    worktreeResult = await runner.run("git", worktreeArgs, {
      cwd: repoRoot,
    });
  } catch (error) {
    return [
      cleanupResult({
        step: "worktree",
        successMessage: `removed local worktree ${workspace.worktreePath}`,
        failureMessage: `git worktree remove failed for ${workspace.worktreePath}: ${errorMessage(error)}`,
        command: "git",
        args: worktreeArgs,
        cwd: repoRoot,
        result: { code: -1, stdout: "", stderr: errorMessage(error) },
      }),
    ];
  }
  const results: CleanupIssueWorkspaceResult[] = [
    cleanupResult({
      step: "worktree",
      successMessage: `removed local worktree ${workspace.worktreePath}`,
      failureMessage: `git worktree remove failed for ${workspace.worktreePath}`,
      command: "git",
      args: worktreeArgs,
      cwd: repoRoot,
      result: worktreeResult,
    }),
  ];

  if (worktreeResult.code !== 0) return results;

  const branchArgs = ["branch", "-D", workspace.branch];
  let branchResult: CommandResult;
  try {
    branchResult = await runner.run("git", branchArgs, { cwd: repoRoot });
  } catch (error) {
    results.push(
      cleanupResult({
        step: "branch",
        successMessage: `deleted local branch ${workspace.branch}`,
        failureMessage: `git branch -D failed for ${workspace.branch}: ${errorMessage(error)}`,
        command: "git",
        args: branchArgs,
        cwd: repoRoot,
        result: { code: -1, stdout: "", stderr: errorMessage(error) },
      }),
    );
    return results;
  }
  results.push(
    cleanupResult({
      step: "branch",
      successMessage: `deleted local branch ${workspace.branch}`,
      failureMessage: `git branch -D failed for ${workspace.branch}`,
      command: "git",
      args: branchArgs,
      cwd: repoRoot,
      result: branchResult,
    }),
  );

  return results;
}

export async function pushBranch(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
  remote = "origin",
): Promise<void> {
  const result = await runner.run(
    "git",
    ["push", "--set-upstream", remote, branch],
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(
      formatCommandFailure(`git push failed for ${branch}`, result),
    );
  }
}
