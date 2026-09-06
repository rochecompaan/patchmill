import {
  PullRequestIdentityError,
  sameRepositoryIdentity,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestJsonError,
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";

export type GitHubPullRequestExistence =
  | "present"
  | "missing"
  | "provider-error";

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new GitHubPullRequestJsonError("gh api graphql", cause);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GitHubPullRequestResponseError(
      "pull-request-existence-payload",
      "gh api graphql",
    );
  return value as Record<string, unknown>;
}

export function parseGitHubPullRequestExistence(
  stdout: string,
  target: RepositoryIdentity,
  number: number,
): GitHubPullRequestExistence {
  const value = object(parseJson(stdout));
  const repository = object(object(value.data).repository);
  if (typeof repository.nameWithOwner !== "string")
    throw new GitHubPullRequestResponseError(
      "pull-request-existence-payload",
      "gh api graphql",
    );
  const parts = repository.nameWithOwner.split("/");
  if (parts.length !== 2 || parts.some((part) => !part))
    throw new PullRequestIdentityError("existence repository is incomplete");
  const actual = { ...target, owner: parts[0]!, repository: parts[1]! };
  if (!sameRepositoryIdentity(target, actual))
    throw new PullRequestIdentityError("existence repository mismatch", {
      expected: target,
      actual,
    });
  const errors = value.errors;
  if (
    repository.pullRequest &&
    typeof repository.pullRequest === "object" &&
    (repository.pullRequest as Record<string, unknown>).number === number &&
    errors === undefined
  )
    return "present";
  if (
    repository.pullRequest === null &&
    Array.isArray(errors) &&
    errors.length === 1
  ) {
    const error = object(errors[0]);
    if (
      error.type === "NOT_FOUND" &&
      Array.isArray(error.path) &&
      error.path.length === 2 &&
      error.path[0] === "repository" &&
      error.path[1] === "pullRequest"
    )
      return "missing";
  }
  if (Array.isArray(errors)) return "provider-error";
  throw new GitHubPullRequestResponseError(
    "pull-request-existence-payload",
    "gh api graphql",
  );
}
