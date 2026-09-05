import assert from "node:assert/strict";
import test from "node:test";
import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  PullRequestNotFoundError,
  sameRepositoryIdentity,
  type CreatePullRequestInput,
  type FindPullRequestsQuery,
  type PullRequestHost,
  type PullRequestReference,
  type PullRequestSummary,
  type RepositoryIdentity,
} from "./pull-requests.ts";

const githubRepository: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.com",
  owner: "rochecompaan",
  repository: "patchmill",
};

test("repository identity comparison normalizes host, owner, and repository case", () => {
  assert.equal(
    sameRepositoryIdentity(githubRepository, {
      provider: "github-gh",
      host: "GITHUB.COM",
      owner: "RocheCompaan",
      repository: "Patchmill",
    }),
    true,
  );
});

test("repository identity comparison requires the same provider", () => {
  assert.equal(
    sameRepositoryIdentity(githubRepository, {
      ...githubRepository,
      provider: "forgejo-tea",
    }),
    false,
  );
});

test("incomplete search error keeps the exact query and provider limit", () => {
  const query: FindPullRequestsQuery = {
    targetRepository: githubRepository,
    baseBranch: "main",
    headRepository: githubRepository,
    headBranch: "agent/issue-184-foundations-spec",
  };
  const error = new IncompletePullRequestSearchError(query, 100);

  assert.equal(error.name, "IncompletePullRequestSearchError");
  assert.deepEqual(error.query, query);
  assert.equal(error.limit, 100);
});

test("not found error keeps the exact pull request reference", () => {
  const reference = {
    targetRepository: githubRepository,
    number: 404,
  };
  const error = new PullRequestNotFoundError(reference);

  assert.equal(error.name, "PullRequestNotFoundError");
  assert.deepEqual(error.reference, reference);
});

test("identity error keeps expected and partial actual identity", () => {
  const error = new PullRequestIdentityError("repository mismatch", {
    expected: githubRepository,
    actual: { host: "forge.example.test" },
  });

  assert.equal(error.name, "PullRequestIdentityError");
  assert.equal(error.reason, "repository mismatch");
  assert.deepEqual(error.expected, githubRepository);
  assert.deepEqual(error.actual, { host: "forge.example.test" });
});

const openPullRequest = {
  number: 12,
  url: "https://github.com/rochecompaan/patchmill/pull/12",
  status: "open",
  targetRepository: githubRepository,
  baseBranch: "main",
  headRepository: githubRepository,
  headBranch: "agent/issue-184-foundations-spec",
  headSha: "abc123",
  body: "Refs #184",
} satisfies PullRequestSummary;

function fakePullRequestHost(summary: PullRequestSummary): PullRequestHost {
  let body = summary.body;
  return {
    id: "github-gh",
    resolveTargetRepositoryIdentity: async () => githubRepository,
    resolveRemoteRepositoryIdentity: async () => githubRepository,
    createPullRequest: async (_input: CreatePullRequestInput) => summary,
    findPullRequests: async (_query: FindPullRequestsQuery) => [summary],
    getPullRequest: async (_reference: PullRequestReference) => summary,
    readPullRequestBody: async (_reference: PullRequestReference) => body,
    updatePullRequestBody: async (
      _reference: PullRequestReference,
      nextBody: string,
    ) => {
      body = nextBody;
    },
  };
}

test("a fake host satisfies the same contract as production adapters", async () => {
  const host = fakePullRequestHost(openPullRequest);
  const reference = {
    targetRepository: githubRepository,
    number: openPullRequest.number,
  };
  const query: FindPullRequestsQuery = {
    targetRepository: githubRepository,
    baseBranch: "main",
    headRepository: githubRepository,
    headBranch: openPullRequest.headBranch,
  };

  assert.deepEqual(await host.findPullRequests(query), [openPullRequest]);
  assert.deepEqual(await host.getPullRequest(reference), openPullRequest);
  await host.updatePullRequestBody(reference, "updated body");
  assert.equal(await host.readPullRequestBody(reference), "updated body");
});
