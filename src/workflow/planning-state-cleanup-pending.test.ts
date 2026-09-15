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

const implementationState = (cleanup: unknown, finish: unknown) => ({
  version: 1,
  workflowVersion: "planning-pr-v1",
  runId: "123e4567-e89b-42d3-a456-426614174000",
  issueNumber: 243,
  issueTitle: "Cleanup",
  gates: { specRequired: false, planRequired: false },
  phases: [
    {
      ...phase(cleanup),
      kind: "implementation",
      artifacts: [
        ...phase(cleanup).artifacts,
        {
          kind: "plan",
          path: "docs/plans/issue.md",
          commitOid: oid("b"),
          source: "workspace",
        },
      ],
      workspace: {
        ...workspace(cleanup),
        phase: "implementation",
        identity: {
          branch: "planning/implementation",
          worktreePath: ".worktrees/243-implementation",
        },
      },
      publication: {
        ...phase(cleanup).publication,
        headBranch: "planning/implementation",
      },
      pullRequest: {
        reference: {
          targetRepository: phase(cleanup).publication.targetRepository,
          number: 244,
        },
        url: "https://github.com/acme/patchmill/pull/244",
      },
      implementation: {
        status: "pr-created",
        prUrl: "https://github.com/acme/patchmill/pull/244",
        branch: "planning/implementation",
        commits: [oid("b")],
        validation: ["npm test"],
        visualEvidence: [],
      },
      finish,
    },
  ],
  revision: 0,
  createdAt: now,
  updatedAt: now,
});

test("persists raw cleanup-pending ignored paths and permits their refresh", () => {
  const current = validatePlanningState(
    state({
      state: "cleanup-pending",
      reason: "ignored-worktree-content",
      ignoredPaths: [".env", "build/output\nname.bin", "safe\\..\\artifact"],
    }),
  );
  assert.deepEqual(current.phases[0]?.workspace?.cleanup, {
    state: "cleanup-pending",
    reason: "ignored-worktree-content",
    ignoredPaths: [".env", "build/output\nname.bin", "safe\\..\\artifact"],
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

test("rejects implementation cleanup pending before its cleanup hook", () => {
  assert.throws(
    () =>
      validatePlanningState(
        implementationState(
          {
            state: "cleanup-pending",
            reason: "ignored-worktree-content",
            ignoredPaths: [".env"],
          },
          {},
        ),
      ),
    PlanningStateValidationError,
  );
});

test("rejects implementation done-label checkpoints before cleanup is removed", () => {
  assert.throws(
    () =>
      validatePlanningState(
        implementationState(
          {
            state: "cleanup-pending",
            reason: "ignored-worktree-content",
            ignoredPaths: [".env"],
          },
          {
            costPublicationCompleted: true,
            visualEvidenceValidated: true,
            handoffCommentPosted: true,
            cleanupHookCompleted: true,
            doneLabelEnsured: true,
          },
        ),
      ),
    PlanningStateValidationError,
  );
});

test("rejects unsafe and empty cleanup-pending inventories", () => {
  for (const ignoredPaths of [
    [],
    ["../outside"],
    ["/outside"],
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
