import assert from "node:assert/strict";
import test from "node:test";
import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  type FindPullRequestsQuery,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestInputError,
  GitHubPullRequestJsonError,
} from "./github-gh-pull-request-errors.ts";
import {
  assertGitHubHeadBranch,
  assertPullRequestNumber,
  parseCreatedGitHubPullRequest,
  parseGitHubPullRequest,
  parseGitHubPullRequestExistence,
  parseGitHubPullRequests,
  parseGitHubRemoteRepositorySelector,
  parseGitHubRepositoryIdentity,
} from "./github-gh-pull-request-parsing.ts";

const target: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.com",
  owner: "acme",
  repository: "project",
};
const payload = (overrides: Record<string, unknown> = {}) => ({
  number: 42,
  url: "https://github.com/acme/project/pull/42",
  state: "OPEN",
  mergeCommit: null,
  baseRefName: "main",
  headRefName: "agent/change",
  headRefOid: "abc",
  headRepository: { nameWithOwner: "acme/project" },
  body: "body",
  ...overrides,
});
const query: FindPullRequestsQuery = {
  targetRepository: target,
  baseBranch: "main",
  headRepository: target,
  headBranch: "agent/change",
};

test("parses supported GitHub remotes and provider-normalized repository payloads", () => {
  assert.deepEqual(
    parseGitHubRemoteRepositorySelector(
      "git@github.example.com:Platform/Project.git",
    ),
    { host: "github.example.com", owner: "Platform", repository: "Project" },
  );
  assert.deepEqual(
    parseGitHubRemoteRepositorySelector("https://github.com/acme/project.git"),
    { host: "github.com", owner: "acme", repository: "project" },
  );
  assert.deepEqual(
    parseGitHubRepositoryIdentity(
      JSON.stringify({
        nameWithOwner: "New/Project",
        url: "https://github.example.com/New/Project",
      }),
      "github.example.com",
    ),
    {
      provider: "github-gh",
      host: "github.example.com",
      owner: "New",
      repository: "Project",
    },
  );
  assert.throws(() =>
    parseGitHubRemoteRepositorySelector(
      "https://token@github.com/acme/project/extra",
    ),
  );
});

test("validates deterministic GitHub inputs before command use", () => {
  assert.doesNotThrow(() => assertGitHubHeadBranch("@"));
  for (const branch of [
    "",
    "owner:branch",
    "refs/heads/a",
    "a..b",
    "a b",
    "HEAD",
  ])
    assert.throws(
      () => assertGitHubHeadBranch(branch),
      GitHubPullRequestInputError,
    );
  for (const number of [0, -1, 1.5, 2_147_483_648, NaN])
    assert.throws(
      () => assertPullRequestNumber(number),
      GitHubPullRequestInputError,
    );
});

test("normalizes same-repository pull requests and rejects cross-repository heads", () => {
  assert.equal(
    parseGitHubPullRequest(JSON.stringify(payload()), target, 42).status,
    "open",
  );
  assert.equal(
    parseGitHubPullRequest(
      JSON.stringify(
        payload({ state: "MERGED", mergeCommit: { oid: "merge" } }),
      ),
      target,
    ).mergeCommit,
    "merge",
  );
  assert.throws(
    () =>
      parseGitHubPullRequest(
        JSON.stringify(
          payload({ headRepository: { nameWithOwner: "fork/project" } }),
        ),
        target,
      ),
    PullRequestIdentityError,
  );
  assert.throws(
    () => parseGitHubPullRequest("not-json", target),
    GitHubPullRequestJsonError,
  );
});

test("proves absence only from the exact GraphQL signature and fails closed at the list limit", () => {
  const missing = {
    data: { repository: { nameWithOwner: "acme/project", pullRequest: null } },
    errors: [{ type: "NOT_FOUND", path: ["repository", "pullRequest"] }],
  };
  assert.equal(
    parseGitHubPullRequestExistence(JSON.stringify(missing), target, 42),
    "missing",
  );
  assert.equal(
    parseGitHubPullRequestExistence(
      JSON.stringify({
        ...missing,
        errors: [{ type: "OTHER", path: ["repository", "pullRequest"] }],
      }),
      target,
      42,
    ),
    "provider-error",
  );
  assert.throws(
    () => parseGitHubPullRequests(JSON.stringify([payload()]), query, 1),
    IncompletePullRequestSearchError,
  );
  assert.deepEqual(
    parseCreatedGitHubPullRequest(
      "https://github.com/acme/project/pull/42\n",
      target,
    ),
    { targetRepository: target, number: 42 },
  );
});
