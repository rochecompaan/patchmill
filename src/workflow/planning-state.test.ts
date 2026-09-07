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

const runId = "123e4567-e89b-42d3-a456-426614174000";
const now = "2026-09-07T12:00:00.000Z";
const oid = "a".repeat(40);
const gates = { specRequired: true, planRequired: true };

function pullRequest(headBranch: string, headOid: string) {
  return {
    reference: {
      targetRepository: {
        provider: "github-gh",
        host: "github.com",
        owner: "example",
        repository: "patchmill",
      },
      number: 1,
    },
    baseBranch: "main",
    headBranch,
    headOid,
  };
}

function mergedState(
  cleanup:
    | { state: "ready" }
    | { state: "worktree-removed"; pushedHeadOid: string }
    | { state: "removed"; pushedHeadOid: string },
): unknown {
  const base = {
    remote: "origin",
    baseBranch: "main",
    baseOid: oid,
    artifactCandidates: { spec: [], plan: [] },
  };
  const branch = "agent/issue-187-implementation";
  const workspace = {
    runId,
    phase: "implementation",
    identity: {
      branch,
      worktreePath: ".worktrees/issue-187-implementation",
    },
    remote: "origin",
    baseBranch: "main",
    baseOid: oid,
    headOid: oid,
    cleanup,
  };
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 187,
    issueTitle: "Example",
    gates: { specRequired: false, planRequired: false },
    phases: [
      {
        kind: "implementation",
        status: "complete",
        base,
        workspace,
        artifacts: [
          {
            kind: "spec",
            path: "docs/specs/example-issue-187-spec.md",
            commitOid: oid,
            source: "workspace",
          },
          {
            kind: "plan",
            path: "docs/plans/example-issue-187-plan.md",
            commitOid: oid,
            source: "workspace",
          },
        ],
        pullRequest: pullRequest(branch, oid),
        completion: { kind: "merged-pull-request", mergeOid: "b".repeat(40) },
      },
    ],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function completeState(): unknown {
  const base = {
    remote: "origin",
    baseBranch: "main",
    baseOid: oid,
    artifactCandidates: {
      spec: ["docs/specs/example-issue-187-spec.md"],
      plan: ["docs/plans/example-issue-187-plan.md"],
    },
  };
  const workspace = {
    runId,
    phase: "implementation",
    identity: {
      branch: "agent/issue-187-implementation",
      worktreePath: ".worktrees/issue-187-implementation",
    },
    remote: "origin",
    baseBranch: "main",
    baseOid: oid,
    headOid: oid,
    cleanup: { state: "ready" },
  };
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 187,
    issueTitle: "Example",
    gates,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    phases: [
      {
        kind: "spec",
        status: "complete",
        base,
        artifacts: [
          {
            kind: "spec",
            path: base.artifactCandidates.spec[0],
            commitOid: oid,
            source: "remote-base",
          },
        ],
        completion: { kind: "remote-base" },
      },
      {
        kind: "plan",
        status: "complete",
        base,
        artifacts: [
          {
            kind: "plan",
            path: base.artifactCandidates.plan[0],
            commitOid: oid,
            source: "remote-base",
          },
        ],
        completion: { kind: "remote-base" },
      },
      { kind: "implementation", status: "workspace-ready", base, workspace },
    ],
  };
}
test("creates and round-trips strict initial planning state", () => {
  const state = createPlanningState({
    issueNumber: 187,
    issueTitle: "Example",
    gates,
    runId,
    now,
  });
  assert.equal(state.revision, 0);
  assert.equal(state.createdAt, now);
  assert.equal(state.updatedAt, now);
  assert.deepEqual(state.phases, [
    { kind: "spec", status: "pending" },
    { kind: "plan", status: "pending" },
    { kind: "implementation", status: "pending" },
  ]);
  assert.deepEqual(parsePlanningState(serializePlanningState(state)), state);
});
test("rejects unknown and contradictory persisted state", () => {
  const state = createPlanningState({
    issueNumber: 187,
    issueTitle: "Example",
    gates,
    runId,
    now,
  });
  assert.throws(
    () => validatePlanningState({ ...state, extra: true }),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === "unknown-key" &&
      error.path === "$.extra",
  );
  assert.throws(
    () =>
      validatePlanningState({ ...state, phases: [...state.phases].reverse() }),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === "phase-sequence" &&
      error.path === "$.phases",
  );
  assert.throws(
    () => parsePlanningState("{"),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === "invalid-json",
  );
});
test("accepts complete prefix then one active and rejects evidence contradictions", () => {
  const state = completeState() as { phases: Array<Record<string, unknown>> };
  assert.doesNotThrow(() => validatePlanningState(state));
  const activeThenComplete = structuredClone(state);
  activeThenComplete.phases[0] = {
    kind: "spec",
    status: "workspace-ready",
    base: activeThenComplete.phases[0]!.base,
    workspace: {
      ...(activeThenComplete.phases[2]!.workspace as Record<string, unknown>),
      phase: "spec",
      identity: {
        branch: "agent/issue-187-spec",
        worktreePath: ".worktrees/issue-187-spec",
      },
    },
  };
  assert.throws(
    () => validatePlanningState(activeThenComplete),
    /progress-order/,
  );
  const wrongCandidate = structuredClone(state);
  (
    wrongCandidate.phases[0]!.artifacts as Array<Record<string, unknown>>
  )[0]!.path = "docs/specs/other.md";
  assert.throws(
    () => validatePlanningState(wrongCandidate),
    /remote-artifact-mismatch/,
  );
  const wrongCleanup = structuredClone(state);
  (
    (wrongCleanup.phases[2]!.workspace as Record<string, unknown>)
      .cleanup as Record<string, unknown>
  ).state = "worktree-removed";
  (
    (wrongCleanup.phases[2]!.workspace as Record<string, unknown>)
      .cleanup as Record<string, unknown>
  ).pushedHeadOid = "b".repeat(40);
  assert.throws(
    () => validatePlanningState(wrongCleanup),
    /(?:cleanup-head-mismatch|invalid-cleanup-progress)/,
  );
});
test("accepts both idempotent merged-workspace cleanup transitions", () => {
  const ready = validatePlanningState(mergedState({ state: "ready" }));
  const worktreeRemoved = validatePlanningState({
    ...mergedState({ state: "worktree-removed", pushedHeadOid: oid }),
    revision: 1,
    updatedAt: "2026-09-07T12:00:01.000Z",
  });
  const removed = validatePlanningState({
    ...mergedState({ state: "removed", pushedHeadOid: oid }),
    revision: 2,
    updatedAt: "2026-09-07T12:00:02.000Z",
  });
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(ready, worktreeRemoved),
  );
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(worktreeRemoved, removed),
  );
  assert.throws(
    () =>
      assertPlanningStateReplacement(ready, {
        ...removed,
        revision: 1,
        updatedAt: "2026-09-07T12:00:01.000Z",
      }),
    /cleanup-transition/,
  );
});

test("forward transitions preserve carried workspace and pull request evidence", () => {
  const initial = completeState() as {
    phases: Array<Record<string, unknown>>;
  };
  const ready = validatePlanningState({
    ...initial,
    phases: [
      initial.phases[0],
      initial.phases[1],
      {
        ...initial.phases[2],
        status: "workspace-ready",
      },
    ],
  });
  const workspace = ready.phases[2]!;
  assert.equal(workspace.status, "workspace-ready");
  const open = validatePlanningState({
    ...ready,
    revision: 1,
    updatedAt: "2026-09-07T12:00:01.000Z",
    phases: [
      ready.phases[0],
      ready.phases[1],
      {
        ...workspace,
        status: "pull-request-open",
        artifacts: [],
        pullRequest: pullRequest(workspace.workspace.identity.branch, oid),
      },
    ],
  });
  assert.doesNotThrow(() => assertPlanningStateReplacement(ready, open));
  const completed = validatePlanningState({
    ...open,
    revision: 2,
    updatedAt: "2026-09-07T12:00:02.000Z",
    phases: [
      open.phases[0],
      open.phases[1],
      {
        ...open.phases[2],
        status: "complete",
        completion: {
          kind: "merged-pull-request",
          mergeOid: "b".repeat(40),
        },
      },
    ],
  });
  assert.doesNotThrow(() => assertPlanningStateReplacement(open, completed));

  const changedPullRequest = structuredClone(completed);
  const phase = changedPullRequest.phases[2]!;
  assert.ok("pullRequest" in phase);
  phase.pullRequest.reference.number = 2;
  assert.throws(
    () => assertPlanningStateReplacement(open, changedPullRequest),
    /immutable-evidence/,
  );
});

test("rejects equivalent workspace paths across phases", () => {
  const state = completeState() as {
    phases: Array<Record<string, unknown>>;
  };
  const base = state.phases[0]!.base;
  const merged = (
    kind: "spec" | "plan",
    branch: string,
    worktreePath: string,
  ) => ({
    kind,
    status: "complete",
    base,
    workspace: {
      runId,
      phase: kind,
      identity: { branch, worktreePath },
      remote: "origin",
      baseBranch: "main",
      baseOid: oid,
      headOid: oid,
      cleanup: { state: "ready" },
    },
    artifacts: [
      {
        kind,
        path: `docs/${kind}s/example-issue-187-${kind}.md`,
        commitOid: oid,
        source: "workspace",
      },
    ],
    pullRequest: pullRequest(branch, oid),
    completion: { kind: "merged-pull-request", mergeOid: "b".repeat(40) },
  });
  state.phases = [
    merged("spec", "agent/spec", ".worktrees\\x\\..\\topic"),
    merged("plan", "agent/plan", ".worktrees/topic"),
    { kind: "implementation", status: "pending" },
  ];
  assert.throws(
    () => validatePlanningState(state),
    /duplicate-workspace-identity/,
  );
});

test("requires immutable identity and exactly one revision step", () => {
  const state = createPlanningState({
    issueNumber: 187,
    issueTitle: "Example",
    gates,
    runId,
    now,
  });
  const next = { ...state, revision: 1, updatedAt: "2026-09-07T12:00:01.000Z" };
  assert.doesNotThrow(() => assertPlanningStateReplacement(state, next));
  assert.throws(
    () =>
      assertPlanningStateReplacement(state, {
        ...next,
        runId: "123e4567-e89b-42d3-a456-426614174001",
      }),
    /immutable/,
  );
  assert.throws(
    () => assertPlanningStateReplacement(state, { ...next, revision: 2 }),
    /revision/,
  );
});
