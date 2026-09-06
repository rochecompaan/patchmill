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
  GitHubPullRequestJsonError,
  GitHubPullRequestResponseError,
  type GitHubPullRequestResponseReason,
} from "./github-gh-pull-request-errors.ts";

const response = (reason: GitHubPullRequestResponseReason) =>
  new GitHubPullRequestResponseError(reason, "GitHub response");
function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new GitHubPullRequestJsonError(context, cause);
  }
}

function object(
  value: unknown,
  reason: GitHubPullRequestResponseReason,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw response(reason);
  return value as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  reason: GitHubPullRequestResponseReason,
): string {
  if (typeof value !== "string") throw response(reason);
  return value;
}

function checkedUrl(
  value: string,
  target: RepositoryIdentity,
  number: number | undefined,
  reason: GitHubPullRequestResponseReason,
): number {
  let parsed;
  try {
    parsed = parsePullRequestUrl(value, "pull");
  } catch {
    throw response(reason);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.port ||
    parsed.number > 2_147_483_647
  )
    throw response(reason);
  const actual = {
    ...target,
    host: parsed.hostname,
    owner: parsed.owner,
    repository: parsed.repository,
  };
  if (!sameRepositoryIdentity(target, actual))
    throw new PullRequestIdentityError("pull request URL identity mismatch", {
      expected: target,
      actual,
    });
  if (number !== undefined && parsed.number !== number) throw response(reason);
  return parsed.number;
}

function providerNumber(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 2_147_483_647
  )
    throw response("pull-request-payload");
  return value;
}

type Status =
  | { status: "open" | "closed-unmerged"; mergeCommit?: undefined }
  | { status: "merged"; mergeCommit: string };

function status(value: Record<string, unknown>): Status {
  if (value.state === "OPEN" && value.mergeCommit === null)
    return { status: "open" as const };
  if (value.state === "CLOSED" && value.mergeCommit === null)
    return { status: "closed-unmerged" as const };
  if (
    value.state === "MERGED" &&
    value.mergeCommit &&
    typeof value.mergeCommit === "object"
  ) {
    const oid = (value.mergeCommit as Record<string, unknown>).oid;
    if (typeof oid === "string" && oid)
      return { status: "merged", mergeCommit: oid };
  }
  throw response("pull-request-state");
}

function summary(
  value: unknown,
  target: RepositoryIdentity,
  expected?: number,
): PullRequestSummary {
  const payload = object(value, "pull-request-payload");
  const number = providerNumber(payload.number);
  if (expected !== undefined && number !== expected)
    throw response("pull-request-payload");
  const url = requiredString(payload.url, "pull-request-payload");
  checkedUrl(url, target, number, "pull-request-url");
  const baseBranch = requiredString(
    payload.baseRefName,
    "pull-request-payload",
  );
  const headBranch = requiredString(
    payload.headRefName,
    "pull-request-payload",
  );
  const headSha = requiredString(payload.headRefOid, "pull-request-payload");
  const body = requiredString(payload.body, "pull-request-payload");
  if (!baseBranch || !headBranch || !headSha)
    throw response("pull-request-payload");
  const head = object(
    payload.headRepository,
    "pull-request-payload",
  ).nameWithOwner;
  if (typeof head !== "string") throw response("pull-request-payload");
  const parts = head.split("/");
  if (parts.length !== 2 || parts.some((part) => !part))
    throw response("pull-request-payload");
  const headRepository = { ...target, owner: parts[0]!, repository: parts[1]! };
  if (!sameRepositoryIdentity(headRepository, target))
    throw new PullRequestIdentityError(
      "pull request head is not target repository",
      {
        expected: target,
        actual: headRepository,
      },
    );
  return {
    number,
    url,
    ...status(payload),
    targetRepository: target,
    baseBranch,
    headRepository,
    headBranch,
    headSha,
    body,
  };
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
  normalizedTarget = query.targetRepository,
): readonly PullRequestSummary[] {
  const value = parseJson(stdout, "gh pr list");
  if (!Array.isArray(value)) throw response("pull-request-list");
  if (value.length >= limit)
    throw new IncompletePullRequestSearchError(query, limit);
  return value.map((item) => {
    const parsed = summary(item, normalizedTarget);
    if (
      parsed.baseBranch !== query.baseBranch ||
      parsed.headBranch !== query.headBranch
    )
      throw response("pull-request-list");
    if (!sameRepositoryIdentity(parsed.headRepository, query.headRepository))
      throw new PullRequestIdentityError("listed head repository mismatch", {
        expected: query.headRepository,
        actual: parsed.headRepository,
      });
    return parsed;
  });
}

export function parseCreatedGitHubPullRequest(
  stdout: string,
  target: RepositoryIdentity,
): PullRequestReference {
  const values = stdout.trim().split(/\s+/u).filter(Boolean);
  if (values.length !== 1)
    throw new GitHubPullRequestResponseError(
      "pull-request-create-output",
      "gh pr create",
    );
  try {
    return {
      targetRepository: target,
      number: checkedUrl(
        values[0]!,
        target,
        undefined,
        "pull-request-create-output",
      ),
    };
  } catch (error) {
    if (error instanceof PullRequestIdentityError) throw error;
    throw new GitHubPullRequestResponseError(
      "pull-request-create-output",
      "gh pr create",
    );
  }
}
