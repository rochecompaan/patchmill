import assert from "node:assert/strict";
import test from "node:test";
import { reconcileLegacyImplementationPr } from "./legacy-pr-reconciliation.ts";
import type {
  PullRequestHost,
  PullRequestSummary,
} from "../../../host/pull-requests.ts";
import type { AgentIssueRunState } from "./types.ts";
const repository = {
  provider: "github-gh" as const,
  host: "github.test",
  owner: "acme",
  repository: "repo",
};
const branch = "agent/issue-226-legacy",
  oid = "b".repeat(40),
  url = "https://github.test/acme/repo/pull/17";
const state: AgentIssueRunState = {
  issueNumber: 226,
  title: "Legacy",
  status: "finished",
  implementationStatus: "pr-created",
  prUrl: url,
  branch,
  worktreePath: ".worktrees/legacy",
  commits: [oid],
  validation: ["npm test"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const pull: PullRequestSummary = {
  number: 17,
  url,
  targetRepository: repository,
  headRepository: repository,
  baseBranch: "main",
  headBranch: branch,
  headSha: oid,
  body: "Closes #226",
  status: "open",
};
function input(summary: PullRequestSummary = pull) {
  return {
    state,
    issueNumber: 226,
    baseBranch: "main",
    host: {
      resolveTargetRepositoryIdentity: async () => repository,
      resolveRemoteRepositoryIdentity: async () => repository,
      getPullRequest: async () => summary,
    } as PullRequestHost,
    remote: "origin",
    fetchBase: async () => ({ baseOid: "d".repeat(40) }),
    git: { assertAncestor: async () => {} },
  };
}
test("older legacy PR needs exact URL, branch, issue and saved head proof before adoption", async () => {
  const result = await reconcileLegacyImplementationPr(input());
  assert.equal(result.kind, "open");
  assert.equal(result.evidence.ownershipMarkerRequired, false);
  for (const invalid of [
    { ...pull, headSha: "c".repeat(40) },
    { ...pull, headBranch: "agent/issue-227" },
    { ...pull, body: "Closes #227" },
  ]) {
    assert.equal(
      (await reconcileLegacyImplementationPr(input(invalid))).kind,
      "blocked",
    );
  }
});
test("only host merge proof authorizes legacy completion and retains the saved PR", async () => {
  const result = await reconcileLegacyImplementationPr(
    input({ ...pull, status: "merged", mergeCommit: "c".repeat(40) }),
  );
  assert.equal(result.kind, "merged");
  assert.equal(result.evidence.url, url);
  if (result.kind === "merged") assert.equal(result.mergeOid, "c".repeat(40));
});
test("malformed saved PR evidence cannot fall back to older receipt adoption", async () => {
  const value = input();
  value.state = { ...state, implementationPr: null as never };
  await assert.rejects(
    reconcileLegacyImplementationPr(value),
    /invalid.*PR evidence/iu,
  );
});

test("saved direct-land receipt cannot authorize completion without a PR", async () => {
  const value = input();
  value.state = { ...state, implementationStatus: "merged", prUrl: undefined };
  assert.equal((await reconcileLegacyImplementationPr(value)).kind, "blocked");
});
