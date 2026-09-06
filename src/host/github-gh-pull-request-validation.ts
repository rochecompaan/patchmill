import { GitHubPullRequestInputError } from "./github-gh-pull-request-errors.ts";

export function assertGitHubHeadBranch(headBranch: string): void {
  if (headBranch.trim().length === 0)
    throw new GitHubPullRequestInputError(
      "blank-head-branch",
      "Pull request head branch must not be blank",
    );
  if (headBranch.includes(":"))
    throw new GitHubPullRequestInputError(
      "qualified-head-branch",
      "Pull request head branch must not contain an owner qualifier",
    );
  const components = headBranch.split("/");
  if (
    headBranch.startsWith("-") ||
    headBranch.startsWith("refs/") ||
    headBranch === "HEAD" ||
    headBranch.startsWith("/") ||
    headBranch.endsWith("/") ||
    headBranch.endsWith(".") ||
    headBranch.includes("//") ||
    headBranch.includes("..") ||
    headBranch.includes("@{") ||
    /[\x00-\x20\x7f~^?*[\\]/u.test(headBranch) ||
    components.some((part) => part.startsWith(".") || part.endsWith(".lock"))
  )
    throw new GitHubPullRequestInputError(
      "invalid-head-branch",
      "Pull request head branch is not a valid unqualified Git branch",
    );
}

export function assertPullRequestNumber(number: number): void {
  if (!Number.isInteger(number) || number <= 0 || number > 2_147_483_647)
    throw new GitHubPullRequestInputError(
      "invalid-pull-request-number",
      "Pull request number must be an integer from 1 through 2147483647",
    );
}
