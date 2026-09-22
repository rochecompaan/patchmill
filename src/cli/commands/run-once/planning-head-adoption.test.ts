import assert from "node:assert/strict";
import test from "node:test";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { adoptPlanningPullRequestHead } from "./planning-head-adoption.ts";

const recorded = "a".repeat(40);
const candidate = "b".repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const reference = { targetRepository: repository, number: 188 };

function state(cleanup: "ready" | "worktree-removed" = "ready") {
  return {
    version: 1 as const,
    workflowVersion: "planning-pr-v1" as const,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: false },
    revision: 0,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    phases: [
      {
        kind: "spec" as const,
        status: "pull-request-open" as const,
        base: {
          remote: "origin",
          baseBranch: "main",
          baseOid: recorded,
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace: {
          runId: "123e4567-e89b-42d3-a456-426614174000",
          phase: "spec" as const,
          identity: { branch: "planning/spec", worktreePath: "/workspace" },
          remote: "origin",
          baseBranch: "main",
          baseOid: recorded,
          headOid: recorded,
          cleanup:
            cleanup === "ready"
              ? { state: "ready" as const }
              : { state: "worktree-removed" as const, pushedHeadOid: recorded },
        },
        artifacts: [
          {
            kind: "spec" as const,
            path: "docs/specs/example.md",
            source: "workspace" as const,
            commitOid: recorded,
          },
        ],
        publication: {
          targetRepository: repository,
          headRepository: repository,
          baseBranch: "main",
          headBranch: "planning/spec",
          headOid: recorded,
        },
        pullRequest: {
          reference,
          url: "https://github.com/acme/patchmill/pull/188",
        },
      },
      { kind: "implementation" as const, status: "pending" as const },
    ],
  };
}

test("atomically reanchors all planning head evidence after safe adoption", async () => {
  const initial = state("worktree-removed");
  const result = await adoptPlanningPullRequestHead({
    state: initial,
    phaseIndex: 0,
    validated: {
      summary: {
        number: 188,
        url: "https://github.com/acme/patchmill/pull/188",
        targetRepository: repository,
        headRepository: repository,
        baseBranch: "main",
        headBranch: "planning/spec",
        headSha: candidate,
        body: renderPlanningPullRequestMarker({
          issueNumber: 188,
          phase: "spec",
        }),
        status: "open",
      },
      reference,
      url: "https://github.com/acme/patchmill/pull/188",
    },
    lock: {} as never,
    workspaces: {
      async adoptPlanningHead() {
        return { kind: "adopted" as const, headOid: candidate };
      },
    },
    stateStore: {
      async replace({ next }) {
        return next;
      },
    },
    now: () => new Date("2026-09-22T00:01:00.000Z"),
  });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.adopted, true);
  assert.equal(result.phase.publication.headOid, candidate);
  assert.equal(result.phase.workspace.headOid, candidate);
  assert.equal(result.phase.workspace.cleanup.pushedHeadOid, candidate);
  assert.deepEqual(
    result.phase.artifacts.map((artifact) => artifact.commitOid),
    [candidate],
  );
});

test("retries the durable checkpoint after local adoption succeeded before a store failure", async () => {
  const initial = state();
  let replacements = 0;
  const input = {
    state: initial,
    phaseIndex: 0,
    lock: {} as never,
    validated: {
      summary: {
        number: 188,
        url: "https://github.com/acme/patchmill/pull/188",
        targetRepository: repository,
        headRepository: repository,
        baseBranch: "main",
        headBranch: "planning/spec",
        headSha: candidate,
        body: renderPlanningPullRequestMarker({
          issueNumber: 188,
          phase: "spec",
        }),
        status: "open" as const,
      },
      reference,
      url: "https://github.com/acme/patchmill/pull/188",
    },
    workspaces: {
      async adoptPlanningHead() {
        return { kind: "adopted" as const, headOid: candidate };
      },
    },
  };
  await assert.rejects(
    () =>
      adoptPlanningPullRequestHead({
        ...input,
        stateStore: {
          async replace() {
            replacements += 1;
            throw new Error("store failed");
          },
        },
      }),
    /store failed/,
  );
  assert.equal(replacements, 1);
  const retried = await adoptPlanningPullRequestHead({
    ...input,
    stateStore: {
      async replace({ next }) {
        replacements += 1;
        return next;
      },
    },
  });
  assert.equal(retried.kind, "ready");
  if (retried.kind === "ready")
    assert.equal(retried.phase.publication.headOid, candidate);
  assert.equal(replacements, 2);
});

test("returns typed unsafe evidence without replacing durable state", async () => {
  const initial = state();
  let replacements = 0;
  const result = await adoptPlanningPullRequestHead({
    state: initial,
    phaseIndex: 0,
    lock: {} as never,
    validated: {
      summary: {
        number: 188,
        url: "https://github.com/acme/patchmill/pull/188",
        targetRepository: repository,
        headRepository: repository,
        baseBranch: "main",
        headBranch: "planning/spec",
        headSha: candidate,
        body: renderPlanningPullRequestMarker({
          issueNumber: 188,
          phase: "spec",
        }),
        status: "open",
      },
      reference,
      url: "https://github.com/acme/patchmill/pull/188",
    },
    workspaces: {
      async adoptPlanningHead() {
        return {
          kind: "blocked" as const,
          evidence: {
            failure: "not-descendant" as const,
            recordedHeadOid: recorded,
            hostHeadOid: candidate,
            artifactPaths: ["docs/specs/example.md"],
            unexpectedPaths: [],
            cleanupState: "ready" as const,
          },
        };
      },
    },
    stateStore: {
      async replace() {
        replacements += 1;
        throw new Error("unexpected");
      },
    },
  });
  assert.equal(result.kind, "head-adoption-blocked");
  assert.equal(replacements, 0);
});
