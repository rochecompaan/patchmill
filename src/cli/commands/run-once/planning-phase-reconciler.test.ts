import assert from "node:assert/strict";
import test from "node:test";
import { PullRequestNotFoundError } from "../../../host/pull-requests.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { reconcilePlanningPhase } from "./planning-phase-reconciler.ts";

const oid = "a".repeat(40);
const state = {
  version: 1 as const,
  workflowVersion: "planning-pr-v1" as const,
  runId: "123e4567-e89b-42d3-a456-426614174000",
  issueNumber: 188,
  issueTitle: "Example",
  gates: { specRequired: true, planRequired: false },
  revision: 0,
  createdAt: "2026-09-08T12:00:00.000Z",
  updatedAt: "2026-09-08T12:00:00.000Z",
  phases: [
    {
      kind: "spec" as const,
      status: "complete" as const,
      base: {
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        artifactCandidates: { spec: ["docs/specs/example.md"], plan: [] },
      },
      artifacts: [
        {
          kind: "spec" as const,
          path: "docs/specs/example.md",
          source: "remote-base" as const,
          commitOid: oid,
        },
      ],
      completion: { kind: "remote-base" as const },
    },
    { kind: "implementation" as const, status: "pending" as const },
  ],
};
test("uses the branch discovery read-back for cleanup and classification", async () => {
  const repository = {
    provider: "github-gh" as const,
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  };
  const published = {
    ...state,
    phases: [
      {
        kind: "spec" as const,
        status: "branch-pushed" as const,
        base: {
          ...state.phases[0]!.base,
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace: {
          runId: state.runId,
          phase: "spec" as const,
          identity: { branch: "planning/spec", worktreePath: "/workspace" },
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
            source: "workspace" as const,
            commitOid: oid,
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
  const summary = {
    number: 188,
    url: "https://github.com/acme/patchmill/pull/188",
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "main",
    headBranch: "planning/spec",
    headSha: oid,
    body: renderPlanningPullRequestMarker({ issueNumber: 188, phase: "spec" }),
    status: "open" as const,
  };
  let getCalls = 0;
  const result = await reconcilePlanningPhase({
    state: published,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace({ next }) {
        return next;
      },
    },
    host: {
      async findPullRequests() {
        return [summary];
      },
      async getPullRequest() {
        getCalls += 1;
        return summary;
      },
    } as never,
    remoteBase: {} as never,
    git: {
      async inspectRemoteHead() {
        return { state: "present" as const, headOid: oid };
      },
    } as never,
    workspaces: { async removeWorktree() {}, async removeBranch() {} } as never,
  });
  assert.equal(result.outcome.kind, "review-pending");
  assert.equal(getCalls, 1);
});
test("maps only typed saved-reference absence to missing without cleanup", async () => {
  const repository = {
    provider: "github-gh" as const,
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  };
  const reference = { targetRepository: repository, number: 188 };
  const saved = {
    ...state,
    phases: [
      {
        kind: "spec" as const,
        status: "pull-request-open" as const,
        base: {
          ...state.phases[0]!.base,
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace: {
          runId: state.runId,
          phase: "spec" as const,
          identity: { branch: "planning/spec", worktreePath: "/workspace" },
          remote: "origin",
          baseBranch: "main",
          baseOid: oid,
          headOid: oid,
          cleanup: { state: "removed" as const, pushedHeadOid: oid },
        },
        artifacts: [
          {
            kind: "spec" as const,
            path: "docs/specs/example.md",
            source: "workspace" as const,
            commitOid: oid,
          },
        ],
        publication: {
          targetRepository: repository,
          headRepository: repository,
          baseBranch: "main",
          headBranch: "planning/spec",
          headOid: oid,
        },
        pullRequest: {
          reference,
          url: "https://github.com/acme/patchmill/pull/188",
        },
      },
      { kind: "implementation" as const, status: "pending" as const },
    ],
  };
  const bytes = JSON.stringify(saved);
  const missing = await reconcilePlanningPhase({
    state: saved,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace() {
        throw new Error("unexpected");
      },
    },
    host: {
      async getPullRequest() {
        throw new PullRequestNotFoundError(reference);
      },
    } as never,
    remoteBase: {} as never,
    git: {} as never,
    workspaces: {} as never,
  });
  assert.equal(missing.outcome.kind, "missing");
  assert.equal(JSON.stringify(saved), bytes);
  await assert.rejects(
    () =>
      reconcilePlanningPhase({
        state: saved,
        phaseIndex: 0,
        lock: {} as never,
        stateStore: {} as never,
        host: {
          async getPullRequest() {
            throw new Error("transport");
          },
        } as never,
        remoteBase: {} as never,
        git: {} as never,
        workspaces: {} as never,
      }),
    /transport/,
  );
  assert.equal(JSON.stringify(saved), bytes);
});
test("returns remote-base completion without host or Git effects", async () => {
  const result = await reconcilePlanningPhase({
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {} as never,
    host: {} as never,
    remoteBase: {} as never,
    git: {} as never,
    workspaces: {} as never,
  });
  assert.equal(result.outcome.kind, "satisfied-by-base");
});
