import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningStateValidationError,
  assertPlanningStateReplacement,
  createPlanningState,
  parsePlanningState,
  serializePlanningState,
  validatePlanningState,
} from "./planning-state.ts";

const oid = (character: string) => character.repeat(40);
const runId = "123e4567-e89b-42d3-a456-426614174000";
const now = "2026-09-08T12:00:00.000Z";
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  artifactCandidates: {
    spec: ["docs/specs/example-issue-188.md"],
    plan: ["docs/plans/example-issue-188.md"],
  },
};
const workspace = (cleanup: unknown = { state: "ready" }) => ({
  runId,
  phase: "spec",
  identity: { branch: "planning/spec", worktreePath: ".worktrees/188-spec" },
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  headOid: oid("b"),
  cleanup,
});
const publication = {
  targetRepository: {
    provider: "github-gh",
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  },
  headRepository: {
    provider: "github-gh",
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  },
  baseBranch: "main",
  headBranch: "planning/spec",
  headOid: oid("b"),
};
const artifact = (source: "remote-base" | "workspace", commitOid: string) => ({
  kind: "spec",
  path: "docs/specs/example-issue-188.md",
  source,
  commitOid,
});
const pullRequest = {
  reference: { targetRepository: publication.targetRepository, number: 188 },
  url: "https://github.com/acme/patchmill/pull/188",
};
function state(phase: object, revision = 0) {
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: false },
    phases: [phase, { kind: "implementation", status: "pending" }],
    revision,
    createdAt: now,
    updatedAt: revision === 0 ? now : "2026-09-08T12:00:01.000Z",
  };
}

test("round trips every durable planning publication checkpoint", () => {
  const documents = [
    { kind: "spec", status: "pending" },
    {
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [],
    },
    {
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [artifact("remote-base", oid("a"))],
    },
    {
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
    },
    {
      kind: "spec",
      status: "branch-pushed",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
    },
    {
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    },
    {
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace({
        state: "worktree-removed",
        pushedHeadOid: oid("b"),
      }),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    },
    {
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    },
    {
      kind: "spec",
      status: "complete",
      base,
      workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
      artifacts: [artifact("remote-base", oid("c"))],
      publication,
      pullRequest,
      completion: {
        kind: "merged-pull-request",
        mergeOid: oid("d"),
        mergedBaseOid: oid("c"),
      },
    },
  ];
  for (const document of documents) {
    const parsed = validatePlanningState(state(document));
    assert.deepEqual(
      parsePlanningState(serializePlanningState(parsed)),
      parsed,
    );
  }
  const direct = validatePlanningState(
    state({
      kind: "spec",
      status: "complete",
      base,
      artifacts: [artifact("remote-base", oid("a"))],
      completion: { kind: "remote-base" },
    }),
  );
  assert.equal(direct.phases[0]!.status, "complete");
});

test("rejects incomplete publication, cleanup, URLs, and merge evidence", () => {
  const cases: ReadonlyArray<
    [string, (phase: Record<string, unknown>) => void]
  > = [
    [
      "partial branch",
      (phase) => {
        phase.artifacts = [];
      },
    ],
    [
      "wrong publication head",
      (phase) => {
        (phase.publication as Record<string, unknown>).headOid = oid("e");
      },
    ],
    [
      "wrong reference target",
      (phase) => {
        (
          (phase.pullRequest as Record<string, unknown>).reference as Record<
            string,
            unknown
          >
        ).targetRepository = {
          ...publication.targetRepository,
          repository: "other",
        };
      },
    ],
    [
      "unsafe URL",
      (phase) => {
        (phase.pullRequest as Record<string, unknown>).url =
          "https://token@example.com/pull/188";
      },
    ],
    [
      "cleanup mismatch",
      (phase) => {
        (phase.workspace as Record<string, unknown>).cleanup = {
          state: "removed",
          pushedHeadOid: oid("e"),
        };
      },
    ],
  ];
  for (const [, mutate] of cases) {
    const phase: Record<string, unknown> = structuredClone({
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    });
    mutate(phase);
    assert.throws(
      () => validatePlanningState(state(phase)),
      PlanningStateValidationError,
    );
  }
  const merged = {
    kind: "spec",
    status: "complete",
    base,
    workspace: workspace({ state: "ready" }),
    artifacts: [artifact("workspace", oid("b"))],
    publication,
    pullRequest,
    completion: { kind: "merged-pull-request", mergeOid: oid("d") },
  };
  assert.throws(
    () => validatePlanningState(state(merged)),
    PlanningStateValidationError,
  );
});

test("allows pending phases to advance into workspace and remote-base completion", () => {
  const pending = validatePlanningState(
    state({ kind: "spec", status: "pending" }),
  );
  const ready = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: workspace(),
        artifacts: [],
      },
      1,
    ),
  );
  const complete = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "complete",
        base,
        artifacts: [artifact("remote-base", oid("a"))],
        completion: { kind: "remote-base" },
      },
      1,
    ),
  );
  assert.doesNotThrow(() => assertPlanningStateReplacement(pending, ready));
  assert.doesNotThrow(() => assertPlanningStateReplacement(pending, complete));
});

test("allows only one durable publication edge at a time", () => {
  const ready = validatePlanningState(
    state({
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [],
    }),
  );
  const artifactReady = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: { ...workspace(), headOid: oid("c") },
        artifacts: [artifact("workspace", oid("c"))],
      },
      1,
    ),
  );
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(ready, artifactReady),
  );
  const rewritten = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: { ...workspace(), headOid: oid("d") },
        artifacts: [],
      },
      1,
    ),
  );
  assert.throws(
    () => assertPlanningStateReplacement(ready, rewritten),
    PlanningStateValidationError,
  );
  const rewrittenArtifact = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: { ...workspace(), headOid: oid("d") },
        artifacts: [artifact("workspace", oid("d"))],
      },
      2,
    ),
  );
  assert.throws(
    () => assertPlanningStateReplacement(artifactReady, rewrittenArtifact),
    PlanningStateValidationError,
  );
  const pushed = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "branch-pushed",
        base,
        workspace: { ...workspace(), headOid: oid("c") },
        artifacts: [artifact("workspace", oid("c"))],
        publication: { ...publication, headOid: oid("c") },
      },
      2,
    ),
  );
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(artifactReady, pushed),
  );
  const open = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "pull-request-open",
        base,
        workspace: { ...workspace(), headOid: oid("c") },
        artifacts: [artifact("workspace", oid("c"))],
        publication: { ...publication, headOid: oid("c") },
        pullRequest,
      },
      3,
    ),
  );
  assert.doesNotThrow(() => assertPlanningStateReplacement(pushed, open));
  const removed = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "pull-request-open",
        base,
        workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
        artifacts: [artifact("workspace", oid("b"))],
        publication,
        pullRequest,
      },
      4,
    ),
  );
  assert.throws(
    () => assertPlanningStateReplacement(open, removed),
    PlanningStateValidationError,
  );
});

test("creates strict pending state", () => {
  const created = createPlanningState({
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: false },
    runId,
    now,
  });
  assert.deepEqual(created.phases, [
    { kind: "spec", status: "pending" },
    { kind: "implementation", status: "pending" },
  ]);
});
