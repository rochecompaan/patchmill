import { join } from "node:path";
import type { GitWorktreeStrategyConfig } from "./types.ts";

export const DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG: GitWorktreeStrategyConfig = {
  baseBranch: "main",
  baseRef: "HEAD",
  remote: "origin",
  branchPrefix: "agent/issue-",
  worktreeDir: ".worktrees",
  worktreePrefix: "patchmill-issue-",
  slugLength: 48,
  allowDirectLand: true,
};

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

function truncateSlug(value: string, limit: number): string {
  if (value.length <= limit) return value;

  const truncated = value.slice(0, limit).replace(/-+$/g, "");
  return truncated || value.slice(0, limit);
}

export function buildIssueBranchSlug(
  title: string,
  config: Pick<GitWorktreeStrategyConfig, "slugLength"> = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
): string {
  return truncateSlug(slugify(title), config.slugLength);
}

export function buildIssueBranchName(
  issueNumber: number,
  title: string,
  config: Pick<GitWorktreeStrategyConfig, "branchPrefix" | "slugLength"> = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
): string {
  return `${config.branchPrefix}${issueNumber}-${buildIssueBranchSlug(title, config)}`;
}

export function buildIssueWorktreePath(
  issueNumber: number,
  title: string,
  config: Pick<GitWorktreeStrategyConfig, "worktreeDir" | "worktreePrefix" | "slugLength"> = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
): string {
  return join(config.worktreeDir, `${config.worktreePrefix}${issueNumber}-${buildIssueBranchSlug(title, config)}`);
}
