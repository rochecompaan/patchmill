import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningStateValidationError,
  assertPlanningStateReplacement,
  validatePlanningState,
} from "./planning-state.ts";

const oid = (character: string) => character.repeat(40);
const now = "2026-09-15T00:00:00.000Z";
const workspace = (cleanup: unknown) => ({
  runId: "123e4567-e89b-42d3-a456-426614174000",
  phase: "spec",
  identity: { branch: "planning/spec", worktreePath: ".worktrees/243-spec" },
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  headOid: oid("b"),
  cleanup,
});
const phase = (cleanup: unknown) => ({
  kind: "spec",
  status: "pull-request-open",
  base: {
    remote: "origin",
    baseBranch: "main",
    baseOid: oid("a"),
    artifactCandidates: { spec: ["docs/specs/issue.md"], plan: [] },
  },
  workspace: workspace(cleanup),
  artifacts: [
    {
      kind: "spec",
      path: "docs/specs/issue.md",
      commitOid: oid("b"),
      source: "workspace",
    },
  ],
  publication: {
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
  },
  pullRequest: {
    reference: {
      targetRepository: {
        provider: "github-gh",
        host: "github.com",
        owner: "acme",
        repository: "patchmill",
      },
      number: 243,
    },
    url: "https://github.com/acme/patchmill/pull/243",
  },
});
const state = (cleanup: unknown, revision = 0) => ({
  version: 1,
  workflowVersion: "planning-pr-v1",
  runId: "123e4567-e89b-42d3-a456-426614174000",
  issueNumber: 243,
  issueTitle: "Cleanup",
  gates: { specRequired: true, planRequired: false },
  phases: [phase(cleanup), { kind: "implementation", status: "pending" }],
  revision,
  createdAt: now,
  updatedAt: revision === 0 ? now : "2026-09-15T00:00:01.000Z",
});

test("persists raw cleanup-pending ignored paths and permits their refresh", () => {
  const current = validatePlanningState(
    state({
      state: "cleanup-pending",
      reason: "ignored-worktree-content",
      ignoredPaths: [".env", "build/output\nname.bin"],
    }),
  );
  assert.deepEqual(current.phases[0]?.workspace?.cleanup, {
    state: "cleanup-pending",
    reason: "ignored-worktree-content",
    ignoredPaths: [".env", "build/output\nname.bin"],
  });
  const next = validatePlanningState(
    state(
      {
        state: "cleanup-pending",
        reason: "ignored-worktree-content",
        ignoredPaths: [".env"],
      },
      1,
    ),
  );
  assert.doesNotThrow(() => assertPlanningStateReplacement(current, next));
});

test("rejects unsafe and empty cleanup-pending inventories", () => {
  for (const ignoredPaths of [
    [],
    ["../outside"],
    ["\\\\server\\share"],
    [".env", ".env"],
  ])
    assert.throws(
      () =>
        validatePlanningState(
          state({
            state: "cleanup-pending",
            reason: "ignored-worktree-content",
            ignoredPaths,
          }),
        ),
      PlanningStateValidationError,
    );
});
