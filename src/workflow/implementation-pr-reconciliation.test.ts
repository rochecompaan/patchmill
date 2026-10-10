import assert from "node:assert/strict";
import test from "node:test";
import type {
  PullRequestHost,
  PullRequestSummary,
} from "../host/pull-requests.ts";
import {
  findOwnedImplementationPullRequest,
  reconcileImplementationPullRequest,
  type ImplementationPrEvidence,
} from "./implementation-pr-reconciliation.ts";

const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "test",
  repository: "repo",
};
const evidence: ImplementationPrEvidence = {
  reference: { targetRepository: repository, number: 17 },
  url: "https://github.com/test/repo/pull/17",
  publication: {
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "main",
    headBranch: "agent/issue-226",
    headOid: "b".repeat(40),
  },
  ownershipMarkerRequired: true,
};
const summary: PullRequestSummary = {
  number: 17,
  url: evidence.url,
  targetRepository: repository,
  headRepository: repository,
  baseBranch: "main",
  headBranch: "agent/issue-226",
  headSha: "b".repeat(40),
  body: "Closes #226\n<!-- patchmill:planning-pr-v1 issue=226 phase=implementation -->",
  status: "open",
};
function host(pulls: PullRequestSummary[]): PullRequestHost {
  return {
    id: "github-gh",
    resolveTargetRepositoryIdentity: async () => repository,
    resolveRemoteRepositoryIdentity: async () => repository,
    getPullRequest: async () => pulls[0],
    findPullRequests: async () => pulls,
    createPullRequest: async () =>
      assert.fail("reconciliation must not publish"),
    readPullRequestBody: async () => summary.body,
    updatePullRequestBody: async () =>
      assert.fail("reconciliation must not mutate host"),
  };
}

test("an exact open implementation PR remains unfinished without a base fetch", async () => {
  const result = await reconcileImplementationPullRequest({
    host: host([summary]),
    issueNumber: 226,
    evidence,
    fetchBase: async () => assert.fail("an open PR cannot prove landing"),
    git: {
      assertAncestor: async () => assert.fail("no merge proof for open PR"),
    },
  });
  assert.deepEqual(result, { kind: "open" });
});

test("merged implementation requires ancestry against the freshly pinned target", async () => {
  const merged: PullRequestSummary = {
    ...summary,
    status: "merged",
    mergeCommit: "c".repeat(40),
  };
  const proofs: unknown[] = [];
  const result = await reconcileImplementationPullRequest({
    host: host([merged]),
    issueNumber: 226,
    evidence,
    fetchBase: async () => ({ baseOid: "d".repeat(40) }),
    git: {
      assertAncestor: async (input) => {
        proofs.push(input);
      },
    },
  });
  assert.deepEqual(proofs, [
    { ancestorOid: "c".repeat(40), descendantOid: "d".repeat(40) },
  ]);
  assert.deepEqual(result, {
    kind: "merged",
    mergeOid: "c".repeat(40),
    mergedBaseOid: "d".repeat(40),
  });
});

test("conflicting publication identity cannot authorize landing", async () => {
  for (const changed of [
    { ...summary, baseBranch: "other" },
    { ...summary, headSha: "e".repeat(40) },
    { ...summary, body: "Closes #227" },
    { ...summary, number: 18 },
    { ...summary, status: "closed-unmerged" as const },
  ]) {
    const result = await reconcileImplementationPullRequest({
      host: host([changed]),
      issueNumber: 226,
      evidence,
      fetchBase: async () => assert.fail("invalid identity must not fetch"),
      git: {
        assertAncestor: async () =>
          assert.fail("invalid identity must not prove merge"),
      },
    });
    assert.equal(result.kind, "blocked");
  }
});

test("publication-crash discovery preserves one owned PR and rejects ambiguity", async () => {
  const found = await findOwnedImplementationPullRequest({
    host: host([summary]),
    issueNumber: 226,
    evidence,
  });
  assert.deepEqual(found, evidence);
  await assert.rejects(
    findOwnedImplementationPullRequest({
      host: host([
        summary,
        { ...summary, number: 18, url: "https://github.com/test/repo/pull/18" },
      ]),
      issueNumber: 226,
      evidence,
    }),
    /ambiguous/iu,
  );
  assert.equal(
    await findOwnedImplementationPullRequest({
      host: host([]),
      issueNumber: 226,
      evidence,
    }),
    undefined,
  );
});
