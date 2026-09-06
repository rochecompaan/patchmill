import {
  PullRequestIdentityError,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestJsonError,
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";

export type GitHubRepositorySelector = {
  host: string;
  owner: string;
  repository: string;
};

const response = () =>
  new GitHubPullRequestResponseError("repository-payload", "GitHub response");
const equal = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const identity = (
  reason: string,
  expected?: RepositoryIdentity,
  actual?: Partial<RepositoryIdentity>,
) =>
  new PullRequestIdentityError(reason, {
    ...(expected ? { expected } : {}),
    ...(actual ? { actual } : {}),
  });

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new GitHubPullRequestJsonError("gh repo view", cause);
  }
}

function selectorParts(value: string): [string, string] | undefined {
  const parts = value.split("/");
  return parts.length === 2 && parts.every(Boolean)
    ? (parts as [string, string])
    : undefined;
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
      throw new GitHubPullRequestResponseError("remote-url", "Git remote");
    }
    if (
      (url.protocol !== "https:" && url.protocol !== "ssh:") ||
      !url.hostname ||
      (url.username && url.protocol === "https:")
    )
      throw new GitHubPullRequestResponseError("remote-url", "Git remote");
    host = url.hostname;
    path = url.pathname.replace(/^\//u, "");
  }
  const parts = selectorParts(path.replace(/\.git$/u, ""));
  if (!parts)
    throw new GitHubPullRequestResponseError("remote-url", "Git remote");
  return { host: host.toLowerCase(), owner: parts[0], repository: parts[1] };
}

export function parseGitHubRepositoryIdentity(
  stdout: string,
  expectedHost?: string,
): RepositoryIdentity {
  const value = parseJson(stdout);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw response();
  const payload = value as Record<string, unknown>;
  if (typeof payload.nameWithOwner !== "string")
    throw identity("repository payload is missing nameWithOwner");
  const nameParts = selectorParts(payload.nameWithOwner);
  if (!nameParts)
    throw identity("repository payload has incomplete nameWithOwner");
  if (typeof payload.url !== "string")
    throw identity("repository payload is missing URL");
  let url: URL;
  try {
    url = new URL(payload.url);
  } catch {
    throw response();
  }
  if (
    !url.hostname ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw response();
  const declared = {
    provider: "github-gh" as const,
    host: url.hostname.toLowerCase(),
    owner: nameParts[0],
    repository: nameParts[1],
  };
  const urlParts = selectorParts(
    url.pathname.replace(/^\//u, "").replace(/\/$/u, ""),
  );
  if (!urlParts)
    throw identity("repository payload has incomplete URL identity", declared, {
      provider: "github-gh",
      host: declared.host,
    });
  const actual = { ...declared, owner: urlParts[0], repository: urlParts[1] };
  const expected = expectedHost
    ? { ...declared, host: expectedHost.toLowerCase() }
    : declared;
  if (
    !equal(declared.owner, actual.owner) ||
    !equal(declared.repository, actual.repository)
  )
    throw identity("repository payload identity mismatch", declared, actual);
  if (expectedHost && !equal(declared.host, expectedHost))
    throw identity("repository payload host mismatch", expected, declared);
  return declared;
}
