import assert from "node:assert/strict";
import test from "node:test";
import { publishPlanningPhase } from "./planning-phase-publisher.ts";

const oid = "a".repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const state = {
  version: 1 as const,
  workflowVersion: "planning-pr-v1" as const,
  runId: "123e4567-e89b-42d3-a456-426614174000",
  issueNumber: 188,
  issueTitle: "Example",
  gates: { specRequired: true, planRequired: false },
  revision: 1,
  createdAt: "2026-09-08T12:00:00.000Z",
  updatedAt: "2026-09-08T12:00:01.000Z",
  phases: [
    {
      kind: "spec" as const,
      status: "branch-pushed" as const,
      base: {
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        artifactCandidates: { spec: [], plan: [] },
      },
      workspace: {
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "spec" as const,
        identity: { branch: "planning/spec", worktreePath: "/repo/worktree" },
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        headOid: oid,
        cleanup: { state: "ready" as const },
      },
      artifacts: [
        {
          kind: "spec" as const,
          path: "docs/specs/example.md",
          commitOid: oid,
          source: "workspace" as const,
        },
      ],
      publication: {
        targetRepository: repository,
        headRepository: repository,
        baseBranch: "main",
        headBranch: "planning/spec",
        headOid: oid,
      },
    },
    { kind: "implementation" as const, status: "pending" as const },
  ],
};
test("returns ambiguous discovery without creating a replacement pull request", async () => {
  const result = await publishPlanningPhase({
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace() {
        throw new Error("unexpected");
      },
    },
    host: {
      id: "github-gh",
      async resolveTargetRepositoryIdentity() {
        return repository;
      },
      async resolveRemoteRepositoryIdentity() {
        return repository;
      },
      async createPullRequest() {
        throw new Error("unexpected");
      },
      async findPullRequests() {
        return [{}, {}] as never;
      },
      async getPullRequest() {
        throw new Error("unexpected");
      },
      async readPullRequestBody() {
        return "";
      },
      async updatePullRequestBody() {},
    },
    git: {
      async verifyWorkspace() {},
      async inspectRemoteHead() {
        return { state: "present" as const, headOid: oid };
      },
      async ensureRemoteHead() {
        return { pushed: false, headOid: oid };
      },
    },
    workspaces: {} as never,
  });
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.pullRequests.length, 2);
});
