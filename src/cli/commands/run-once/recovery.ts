import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AgentIssueRunState,
  CommandResult,
  CommandRunner,
} from "./types.ts";

export type BlockedRunRecoveryKind =
  | "recoverable-clean"
  | "dirty-worktree"
  | "already-merged"
  | "diverged"
  | "missing-worktree-existing-branch"
  | "missing-branch-or-worktree"
  | "not-blocked-recovery";

export type BlockedRunRecoveryReport = {
  kind: BlockedRunRecoveryKind;
  runStatePath: string;
  issueNumber: number;
  title: string;
  status: AgentIssueRunState["status"];
  blockerReason?: string;
  branch: { name?: string; exists: boolean; merged: boolean };
  worktree: {
    path?: string;
    exists: boolean;
    registered: boolean;
    clean?: boolean;
    dirtyStatus?: string;
  };
  divergence?: { ahead: number; behind: number };
  commits: string[];
  recommendedActions: string[];
};

function commandFailure(message: string, result: CommandResult): Error {
  const output =
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "(no output)";
  return new Error(`${message} with exit code ${result.code}: ${output}`);
}

async function branchExists(
  runner: CommandRunner,
  repoRoot: string,
  branch: string | undefined,
): Promise<boolean> {
  if (!branch) return false;
  const result = await runner.run(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: repoRoot },
  );
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw commandFailure(`git show-ref failed for ${branch}`, result);
}

function worktreePaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length).trim()));
}

async function physicalWorktreeExists(
  repoRoot: string,
  worktreePath: string | undefined,
): Promise<boolean> {
  if (!worktreePath) return false;
  try {
    await stat(resolve(repoRoot, worktreePath));
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
}

async function registeredWorktreeExists(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string | undefined,
): Promise<boolean> {
  if (!worktreePath) return false;
  const result = await runner.run("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  if (result.code !== 0)
    throw commandFailure("git worktree list failed", result);
  return worktreePaths(result.stdout).includes(resolve(repoRoot, worktreePath));
}

async function worktreeStatus(input: {
  runner: CommandRunner;
  repoRoot: string;
  worktreePath: string;
}): Promise<{ clean: boolean; dirtyStatus?: string }> {
  const result = await input.runner.run(
    "git",
    [
      "-C",
      input.worktreePath,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ],
    { cwd: input.repoRoot },
  );
  if (result.code !== 0)
    throw commandFailure(`git status failed for ${input.worktreePath}`, result);
  const dirtyStatus = result.stdout.trim();
  return dirtyStatus === "" ? { clean: true } : { clean: false, dirtyStatus };
}

async function branchMerged(input: {
  runner: CommandRunner;
  repoRoot: string;
  branch: string;
  baseRef: string;
}): Promise<boolean> {
  const result = await input.runner.run(
    "git",
    ["merge-base", "--is-ancestor", input.branch, input.baseRef],
    { cwd: input.repoRoot },
  );
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw commandFailure(`git merge-base failed for ${input.branch}`, result);
}

async function branchDivergence(input: {
  runner: CommandRunner;
  repoRoot: string;
  branch: string;
  baseRef: string;
}): Promise<{ ahead: number; behind: number }> {
  const result = await input.runner.run(
    "git",
    [
      "rev-list",
      "--left-right",
      "--count",
      `${input.baseRef}...${input.branch}`,
    ],
    { cwd: input.repoRoot },
  );
  if (result.code !== 0)
    throw commandFailure(`git rev-list failed for ${input.branch}`, result);
  const fields = result.stdout.trim().split(/\s+/u);
  if (fields.length !== 2) {
    throw new Error(
      `git rev-list returned unparseable divergence for ${input.branch}: ${result.stdout.trim() || "(empty output)"}`,
    );
  }
  const [behindText, aheadText] = fields;
  if (!/^\d+$/u.test(behindText) || !/^\d+$/u.test(aheadText)) {
    throw new Error(
      `git rev-list returned unparseable divergence for ${input.branch}: ${result.stdout.trim()}`,
    );
  }
  const behind = Number.parseInt(behindText, 10);
  const ahead = Number.parseInt(aheadText, 10);
  return { ahead, behind };
}

async function unmergedCommitLines(input: {
  runner: CommandRunner;
  repoRoot: string;
  branch: string;
  baseRef: string;
}): Promise<string[]> {
  const result = await input.runner.run(
    "git",
    ["log", "--oneline", `${input.baseRef}..${input.branch}`],
    { cwd: input.repoRoot },
  );
  if (result.code !== 0)
    throw commandFailure(`git log failed for ${input.branch}`, result);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function recommendations(
  kind: BlockedRunRecoveryKind,
  report: Pick<BlockedRunRecoveryReport, "issueNumber" | "branch" | "worktree">,
): string[] {
  switch (kind) {
    case "recoverable-clean":
      return [
        `Retry after the external prerequisite is fixed with: patchmill run-once --issue ${report.issueNumber}`,
      ];
    case "dirty-worktree":
      return [
        "Commit, stash, or clean local modifications in the saved worktree before retrying.",
        `Then retry with: patchmill run-once --issue ${report.issueNumber}`,
      ];
    case "already-merged":
      return [
        "Confirm the work is landed, then clean/finalize the stale run state while preserving any branch or worktree you still need.",
      ];
    case "diverged":
      return [
        "Rebase or cherry-pick the saved work onto the current base, then retry the run.",
        `After recovery, retry with: patchmill run-once --issue ${report.issueNumber}`,
      ];
    case "missing-worktree-existing-branch":
      if (report.worktree.exists) {
        return [
          `The saved path ${report.worktree.path ?? "<savedPath>"} exists but is not registered as a git worktree; inspect and move or archive it before reattaching the branch.`,
          `After preserving that path, reattach with: git worktree add ${report.worktree.path ?? "<savedPath>"} ${report.branch.name ?? "<branch>"}`,
          `Then retry with: patchmill run-once --issue ${report.issueNumber}`,
        ];
      }
      if (report.worktree.registered) {
        return [
          `The saved worktree path ${report.worktree.path ?? "<savedPath>"} is still registered with Git but the path is missing; repair or restore the missing path if local files need preservation.`,
          "If no local files need preservation at that path, prune or remove the stale worktree registration, then reattach the saved branch.",
          `After repair, retry with: patchmill run-once --issue ${report.issueNumber}`,
        ];
      }
      return [
        `Reattach the saved branch with: git worktree add ${report.worktree.path ?? "<savedPath>"} ${report.branch.name ?? "<branch>"}`,
        `Then retry with: patchmill run-once --issue ${report.issueNumber}`,
      ];
    case "missing-branch-or-worktree":
      return [
        "Archive or remove stale run state only after confirming no saved branch or worktree needs preservation.",
      ];
    case "not-blocked-recovery":
      return ["No blocked run workspace recovery is available for this state."];
  }
}

export async function inspectBlockedRunRecovery(input: {
  runner: CommandRunner;
  repoRoot: string;
  runStatePath: string;
  state: AgentIssueRunState;
  baseRef: string;
}): Promise<BlockedRunRecoveryReport> {
  const baseReport = {
    runStatePath: input.runStatePath,
    issueNumber: input.state.issueNumber,
    title: input.state.title,
    status: input.state.status,
    blockerReason: input.state.lastError,
    branch: { name: input.state.branch, exists: false, merged: false },
    worktree: {
      path: input.state.worktreePath,
      exists: false,
      registered: false,
    },
    commits: input.state.commits ?? [],
  } satisfies Omit<BlockedRunRecoveryReport, "kind" | "recommendedActions">;

  if (
    input.state.status !== "blocked" ||
    (!input.state.branch && !input.state.worktreePath)
  ) {
    const kind = "not-blocked-recovery";
    return {
      ...baseReport,
      kind,
      recommendedActions: recommendations(kind, baseReport),
    };
  }

  const exists = await branchExists(
    input.runner,
    input.repoRoot,
    input.state.branch,
  );
  const [physicalExists, registered] = await Promise.all([
    physicalWorktreeExists(input.repoRoot, input.state.worktreePath),
    registeredWorktreeExists(
      input.runner,
      input.repoRoot,
      input.state.worktreePath,
    ),
  ]);
  const worktree = {
    ...baseReport.worktree,
    exists: physicalExists,
    registered,
  };
  if (registered && physicalExists && input.state.worktreePath) {
    Object.assign(
      worktree,
      await worktreeStatus({
        runner: input.runner,
        repoRoot: input.repoRoot,
        worktreePath: input.state.worktreePath,
      }),
    );
  }

  let merged = false;
  let divergence: { ahead: number; behind: number } | undefined;
  let commits = baseReport.commits;
  if (exists && input.state.branch) {
    merged = await branchMerged({
      runner: input.runner,
      repoRoot: input.repoRoot,
      branch: input.state.branch,
      baseRef: input.baseRef,
    });
    divergence = await branchDivergence({
      runner: input.runner,
      repoRoot: input.repoRoot,
      branch: input.state.branch,
      baseRef: input.baseRef,
    });
    const gitCommits = await unmergedCommitLines({
      runner: input.runner,
      repoRoot: input.repoRoot,
      branch: input.state.branch,
      baseRef: input.baseRef,
    });
    if (gitCommits.length > 0) commits = gitCommits;
  }

  let kind: BlockedRunRecoveryKind;
  if (!exists) kind = "missing-branch-or-worktree";
  else if (!registered || !worktree.exists)
    kind = "missing-worktree-existing-branch";
  else if (worktree.clean === false) kind = "dirty-worktree";
  else if (merged) kind = "already-merged";
  else if ((divergence?.behind ?? 0) > 0) kind = "diverged";
  else kind = "recoverable-clean";

  const report: Omit<BlockedRunRecoveryReport, "recommendedActions"> = {
    ...baseReport,
    kind,
    branch: { name: input.state.branch, exists, merged },
    worktree,
    divergence,
    commits,
  };
  return { ...report, recommendedActions: recommendations(kind, report) };
}

function branchStatus(report: BlockedRunRecoveryReport): string {
  const parts = [report.branch.exists ? "exists" : "missing"];
  if (report.branch.exists)
    parts.push(report.branch.merged ? "merged" : "unmerged");
  if (report.divergence) {
    parts.push(`ahead ${report.divergence.ahead}`);
    parts.push(`behind ${report.divergence.behind}`);
  }
  return parts.join(", ");
}

function worktreeStatusText(report: BlockedRunRecoveryReport): string {
  const parts = [report.worktree.exists ? "path exists" : "path missing"];
  parts.push(report.worktree.registered ? "registered" : "not registered");
  if (report.worktree.clean === true) parts.push("clean");
  if (report.worktree.clean === false) parts.push("dirty");
  return parts.join(", ");
}

export function formatBlockedRunRecoveryReport(
  report: BlockedRunRecoveryReport,
): string {
  const lines = [
    `Issue #${report.issueNumber} has a blocked run with preserved workspace state.`,
    `Run state: ${report.runStatePath}`,
  ];
  if (report.blockerReason)
    lines.push(`Blocked reason: ${report.blockerReason}`);
  lines.push(
    `Saved branch: ${report.branch.name ?? "(none)"} (${branchStatus(report)})`,
    `Saved worktree: ${report.worktree.path ?? "(none)"} (${worktreeStatusText(report)})`,
  );
  if (report.worktree.dirtyStatus) {
    lines.push("Dirty status:", report.worktree.dirtyStatus);
  }
  if (report.commits.length > 0) {
    lines.push("Commits:", ...report.commits.map((commit) => `- ${commit}`));
  }
  lines.push(
    "Recommended actions:",
    ...report.recommendedActions.map((action) => `- ${action}`),
  );
  return lines.join("\n");
}
