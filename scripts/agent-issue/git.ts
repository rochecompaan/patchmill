import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CommandResult, CommandRunner } from "./types.ts";

const BRANCH_SLUG_LENGTH = 48;

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

function truncateSlug(value: string, limit = BRANCH_SLUG_LENGTH): string {
  if (value.length <= limit) return value;

  const truncated = value.slice(0, limit).replace(/-+$/g, "");
  return truncated || value.slice(0, limit);
}

export function buildIssueBranchSlug(title: string): string {
  return truncateSlug(slugify(title));
}

export function buildIssueBranchName(issueNumber: number, title: string): string {
  return `agent/issue-${issueNumber}-${buildIssueBranchSlug(title)}`;
}

export function buildIssueWorktreePath(issueNumber: number, title: string): string {
  return `.worktrees/agent-issue-${issueNumber}-${buildIssueBranchSlug(title)}`;
}

function formatCommandFailure(message: string, result: CommandResult): string {
  const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") || "(no output)";
  return `${message} with exit code ${result.code}: ${output}`;
}

function isAgentIssueRunLogStatus(line: string): boolean {
  return line.slice(3).startsWith(".pi/agent-issue/runs/");
}

function blockingStatusOutput(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "" && !isAgentIssueRunLogStatus(line))
    .join("\n");
}

export async function assertCleanWorktree(runner: CommandRunner, repoRoot: string): Promise<void> {
  const result = await runner.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(formatCommandFailure("git status failed", result));
  }

  const dirtyOutput = blockingStatusOutput(result.stdout);
  if (dirtyOutput !== "") {
    throw new Error(`Repository worktree is not clean: ${dirtyOutput}`);
  }
}

export async function createIssueWorktree(
  runner: CommandRunner,
  repoRoot: string,
  issueNumber: number,
  title: string,
  baseRef = "HEAD",
): Promise<{ branch: string; worktreePath: string }> {
  const branch = buildIssueBranchName(issueNumber, title);
  const worktreePath = buildIssueWorktreePath(issueNumber, title);
  const result = await runner.run("git", ["worktree", "add", "-b", branch, worktreePath, baseRef], { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(formatCommandFailure(`git worktree add failed for issue #${issueNumber}`, result));
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

async function branchExists(runner: CommandRunner, repoRoot: string, branch: string): Promise<boolean> {
  const result = await runner.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repoRoot });
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new Error(formatCommandFailure(`git show-ref failed for ${branch}`, result));
}

async function existingCommitLines(runner: CommandRunner, repoRoot: string, branch: string): Promise<string[]> {
  const result = await runner.run("git", ["log", "--oneline", `HEAD..${branch}`], { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(formatCommandFailure(`git log failed for ${branch}`, result));
  }

  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
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
  baseRef = "HEAD",
): Promise<IssueWorktreeResult> {
  const branch = buildIssueBranchName(issueNumber, title);
  const worktreePath = buildIssueWorktreePath(issueNumber, title);
  const listed = await commandOutput(runner, repoRoot, ["worktree", "list", "--porcelain"], "git worktree list failed");
  const expectedWorktreePath = resolve(repoRoot, worktreePath);
  const hasWorktree = porcelainWorktreePaths(listed).includes(expectedWorktreePath);

  if (hasWorktree) {
    const currentBranch = (await commandOutput(
      runner,
      repoRoot,
      ["-C", worktreePath, "branch", "--show-current"],
      `git branch failed for ${worktreePath}`,
    )).trim();
    if (currentBranch !== branch) {
      throw new Error(`Existing worktree ${worktreePath} is on ${currentBranch}, expected ${branch}`);
    }

    await assertCleanWorktree(runner, join(repoRoot, worktreePath));
    const existingCommits = await existingCommitLines(runner, repoRoot, branch);
    return {
      branch,
      worktreePath,
      created: false,
      hasExistingCommits: existingCommits.length > 0,
      existingCommits,
    };
  }

  if (await pathExists(expectedWorktreePath)) {
    throw new Error(`Existing path ${worktreePath} is not a registered git worktree`);
  }

  if (await branchExists(runner, repoRoot, branch)) {
    const result = await runner.run("git", ["worktree", "add", worktreePath, branch], { cwd: repoRoot });
    if (result.code !== 0) {
      throw new Error(formatCommandFailure(`git worktree add failed for issue #${issueNumber}`, result));
    }

    const existingCommits = await existingCommitLines(runner, repoRoot, branch);
    return {
      branch,
      worktreePath,
      created: true,
      hasExistingCommits: existingCommits.length > 0,
      existingCommits,
    };
  }

  const created = await createIssueWorktree(runner, repoRoot, issueNumber, title, baseRef);
  return {
    ...created,
    created: true,
    hasExistingCommits: false,
    existingCommits: [],
  };
}

export async function pushBranch(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
  remote = "origin",
): Promise<void> {
  const result = await runner.run("git", ["push", "--set-upstream", remote, branch], { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(formatCommandFailure(`git push failed for ${branch}`, result));
  }
}
