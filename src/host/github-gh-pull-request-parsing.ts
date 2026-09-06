import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  sameRepositoryIdentity,
  type FindPullRequestsQuery,
  type PullRequestReference,
  type PullRequestSummary,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import { parsePullRequestUrl } from "./pull-request-reference.ts";
import {
  GitHubPullRequestInputError,
  GitHubPullRequestJsonError,
  GitHubPullRequestResponseError,
  type GitHubPullRequestResponseReason,
} from "./github-gh-pull-request-errors.ts";

export type GitHubRepositorySelector = {
  host: string;
  owner: string;
  repository: string;
};
const response = (reason: GitHubPullRequestResponseReason) =>
  new GitHubPullRequestResponseError(reason, "GitHub response");
const object = (value: unknown, reason: GitHubPullRequestResponseReason) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw response(reason);
  return value as Record<string, unknown>;
};
const string = (value: unknown, reason: GitHubPullRequestResponseReason) => {
  if (typeof value !== "string") throw response(reason);
  return value;
};
const parts = (value: string, reason: GitHubPullRequestResponseReason) => {
  const result = value.split("/");
  if (result.length !== 2 || result.some((part) => !part))
    throw response(reason);
  return result as [string, string];
};
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new GitHubPullRequestJsonError(context, cause);
  }
}
export function githubRepositorySelector(
  repository: GitHubRepositorySelector,
): string {
  return `${repository.host}/${repository.owner}/${repository.repository}`;
}
export function parseGitHubRemoteRepositorySelector(
  remoteUrl: string,
): GitHubRepositorySelector {
  let host: string, path: string;
  const scp = remoteUrl.includes("://")
    ? undefined
    : /^(?:[^@/:]+@)?([^/:]+):(.+)$/u.exec(remoteUrl);
  if (scp) [host, path] = [scp[1]!, scp[2]!];
  else {
    let url: URL;
    try {
      url = new URL(remoteUrl);
    } catch {
      throw response("remote-url");
    }
    if (
      (url.protocol !== "https:" && url.protocol !== "ssh:") ||
      !url.hostname ||
      (url.username && url.protocol === "https:")
    )
      throw response("remote-url");
    host = url.hostname;
    path = url.pathname.replace(/^\//u, "");
  }
  const [owner, repository] = parts(path.replace(/\.git$/u, ""), "remote-url");
  return { host: host.toLowerCase(), owner, repository };
}
export function parseGitHubRepositoryIdentity(
  stdout: string,
  expectedHost?: string,
): RepositoryIdentity {
  const value = object(parseJson(stdout, "gh repo view"), "repository-payload");
  const [owner, repository] = parts(
    string(value.nameWithOwner, "repository-payload"),
    "repository-payload",
  );
  let url: URL;
  try {
    url = new URL(string(value.url, "repository-payload"));
  } catch {
    throw response("repository-payload");
  }
  if (
    !url.hostname ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw response("repository-payload");
  const [urlOwner, urlRepository] = parts(
    url.pathname.replace(/^\//u, "").replace(/\/$/u, ""),
    "repository-payload",
  );
  const identity = {
    provider: "github-gh" as const,
    host: url.hostname.toLowerCase(),
    owner,
    repository,
  };
  if (
    !equal(owner, urlOwner) ||
    !equal(repository, urlRepository) ||
    (expectedHost && !equal(identity.host, expectedHost))
  ) {
    throw new PullRequestIdentityError("repository payload identity mismatch", {
      actual: identity,
    });
  }
  return identity;
}
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
export type GitHubPullRequestExistence =
  | "present"
  | "missing"
  | "provider-error";
export function parseGitHubPullRequestExistence(
  stdout: string,
  target: RepositoryIdentity,
  number: number,
): GitHubPullRequestExistence {
  const value = object(
    parseJson(stdout, "gh api graphql"),
    "pull-request-existence-payload",
  );
  const repository = object(
    object(value.data, "pull-request-existence-payload").repository,
    "pull-request-existence-payload",
  );
  const [owner, name] = parts(
    string(repository.nameWithOwner, "pull-request-existence-payload"),
    "pull-request-existence-payload",
  );
  if (!sameRepositoryIdentity(target, { ...target, owner, repository: name }))
    throw new PullRequestIdentityError("existence repository mismatch", {
      expected: target,
      actual: { ...target, owner, repository: name },
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
    const error = object(errors[0], "pull-request-existence-payload");
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
  throw response("pull-request-existence-payload");
}
function checkedUrl(
  url: string,
  target: RepositoryIdentity,
  number?: number,
): { number: number } {
  let parsed;
  try {
    parsed = parsePullRequestUrl(url, "pull");
  } catch {
    throw response("pull-request-url");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.port ||
    !equal(parsed.hostname, target.host) ||
    !equal(parsed.owner, target.owner) ||
    !equal(parsed.repository, target.repository) ||
    parsed.number > 2_147_483_647
  )
    throw new PullRequestIdentityError("pull request URL identity mismatch", {
      expected: target,
    });
  if (number !== undefined && parsed.number !== number)
    throw response("pull-request-url");
  return parsed;
}
function summary(
  value: unknown,
  target: RepositoryIdentity,
  expected?: number,
): PullRequestSummary {
  const payload = object(value, "pull-request-payload"),
    number = payload.number;
  if (typeof number !== "number") throw response("pull-request-payload");
  assertPullRequestNumber(number);
  if (expected !== undefined && number !== expected)
    throw response("pull-request-payload");
  checkedUrl(string(payload.url, "pull-request-payload"), target, number);
  const baseBranch = string(payload.baseRefName, "pull-request-payload"),
    headBranch = string(payload.headRefName, "pull-request-payload"),
    headSha = string(payload.headRefOid, "pull-request-payload"),
    body = string(payload.body, "pull-request-payload");
  if (!baseBranch || !headBranch || !headSha)
    throw response("pull-request-payload");
  const [owner, repository] = parts(
    string(
      object(payload.headRepository, "pull-request-payload").nameWithOwner,
      "pull-request-payload",
    ),
    "pull-request-payload",
  );
  const headRepository = { ...target, owner, repository };
  if (!sameRepositoryIdentity(headRepository, target))
    throw new PullRequestIdentityError(
      "pull request head is not target repository",
      { expected: target, actual: headRepository },
    );
  const status =
    payload.state === "OPEN" && payload.mergeCommit === null
      ? { status: "open" as const }
      : payload.state === "CLOSED" && payload.mergeCommit === null
        ? { status: "closed-unmerged" as const }
        : payload.state === "MERGED" &&
            payload.mergeCommit &&
            typeof payload.mergeCommit === "object" &&
            typeof (payload.mergeCommit as Record<string, unknown>).oid ===
              "string" &&
            (payload.mergeCommit as Record<string, unknown>).oid
          ? {
              status: "merged" as const,
              mergeCommit: (payload.mergeCommit as Record<string, string>).oid,
            }
          : (() => {
              throw response("pull-request-state");
            })();
  return {
    number,
    url: string(payload.url, "pull-request-payload"),
    ...status,
    targetRepository: target,
    baseBranch,
    headRepository,
    headBranch,
    headSha,
    body,
  } as PullRequestSummary;
}
export function parseGitHubPullRequest(
  stdout: string,
  target: RepositoryIdentity,
  expected?: number,
): PullRequestSummary {
  return summary(parseJson(stdout, "gh pr response"), target, expected);
}
export function parseGitHubPullRequests(
  stdout: string,
  query: FindPullRequestsQuery,
  limit: number,
): readonly PullRequestSummary[] {
  const value = parseJson(stdout, "gh pr list");
  if (!Array.isArray(value)) throw response("pull-request-list");
  if (value.length >= limit)
    throw new IncompletePullRequestSearchError(query, limit);
  return value.map((item) => {
    const itemSummary = summary(item, query.targetRepository);
    if (
      itemSummary.baseBranch !== query.baseBranch ||
      itemSummary.headBranch !== query.headBranch
    )
      throw response("pull-request-list");
    if (
      !sameRepositoryIdentity(itemSummary.headRepository, query.headRepository)
    )
      throw new PullRequestIdentityError("listed head repository mismatch", {
        expected: query.headRepository,
        actual: itemSummary.headRepository,
      });
    return itemSummary;
  });
}
export function parseCreatedGitHubPullRequest(
  stdout: string,
  target: RepositoryIdentity,
): PullRequestReference {
  const values = stdout.trim().split(/\s+/u).filter(Boolean);
  if (values.length !== 1) throw response("pull-request-create-output");
  try {
    const parsed = checkedUrl(values[0]!, target);
    return { targetRepository: target, number: parsed.number };
  } catch (error) {
    if (error instanceof PullRequestIdentityError) throw error;
    throw new GitHubPullRequestResponseError(
      "pull-request-create-output",
      "gh pr create",
    );
  }
}
