import assert from "node:assert/strict";
import test from "node:test";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import {
  assertPlanningImplementationBase,
  PlanningImplementationBaseError,
} from "./planning-implementation-base.ts";

const oid = (character: string) => character.repeat(40);
const specPath = "docs/specs/example-issue-260.md";
const planPath = "docs/plans/example-issue-260.md";
const olderBase = oid("a");
const originalPlanBase = oid("b");
const forgeMerge = oid("c");
const newestMergedBase = oid("d");
const implementationOid = oid("e");

function state(completion: "merged" | "remote" = "merged") {
  const spec = {
    kind: "spec",
    status: "complete",
    base: {
      remote: "origin",
      baseBranch: "main",
      baseOid: olderBase,
      artifactCandidates: { spec: [specPath], plan: [] },
    },
    artifacts: [
      {
        kind: "spec",
        path: specPath,
        source: "remote-base",
        commitOid: olderBase,
      },
    ],
    completion: { kind: "remote-base" },
  };
  const plan = {
    kind: "plan",
    status: "complete",
    base: {
      remote: "origin",
      baseBranch: "main",
      baseOid: originalPlanBase,
      artifactCandidates: { spec: [], plan: [planPath] },
    },
    artifacts: [
      {
        kind: "plan",
        path: planPath,
        source: "remote-base",
        commitOid: newestMergedBase,
      },
    ],
    completion:
      completion === "merged"
        ? {
            kind: "merged-pull-request",
            mergeOid: forgeMerge,
            mergedBaseOid: newestMergedBase,
          }
        : { kind: "remote-base" },
  };
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    issueNumber: 260,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: true },
    revision: 0,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    phases: [spec, plan, { kind: "implementation", status: "pending" }],
  } as never;
}
function base(
  overrides: Partial<{ spec: readonly string[]; plan: readonly string[] }> = {},
) {
  return {
    remote: "origin",
    baseBranch: "main",
    baseOid: implementationOid,
    artifactCandidates: { spec: [specPath], plan: [planPath], ...overrides },
  };
}

test("uses only the newest merged effective anchor while retaining all artifact proof", async () => {
  const ancestorCalls: unknown[] = [];
  const regularCalls: unknown[] = [];
  await assertPlanningImplementationBase({
    state: state(),
    phaseIndex: 2,
    base: base(),
    git: {
      async assertAncestor(value) {
        ancestorCalls.push(value);
      },
      async assertRegularFiles(value) {
        regularCalls.push(value);
      },
    },
  });
  assert.deepEqual(ancestorCalls, [
    { ancestorOid: newestMergedBase, descendantOid: implementationOid },
  ]);
  assert.deepEqual(regularCalls, [
    { commitOid: implementationOid, paths: [specPath, planPath] },
  ]);
  assert.equal(JSON.stringify(ancestorCalls).includes(olderBase), false);
  assert.equal(JSON.stringify(ancestorCalls).includes(originalPlanBase), false);
  assert.equal(JSON.stringify(ancestorCalls).includes(forgeMerge), false);
});

test("uses the newest remote-base anchor and rejects any prior artifact candidate failure", async () => {
  const calls: unknown[] = [];
  await assertPlanningImplementationBase({
    state: state("remote"),
    phaseIndex: 2,
    base: base(),
    git: {
      async assertAncestor(value) {
        calls.push(value);
      },
      async assertRegularFiles() {},
    },
  });
  assert.deepEqual(calls, [
    { ancestorOid: originalPlanBase, descendantOid: implementationOid },
  ]);
  for (const [candidates, reason] of [
    [{ spec: [], plan: [planPath] }, "prior-artifact-missing"],
    [
      { spec: [specPath, "docs/specs/copy.md"], plan: [planPath] },
      "prior-artifact-ambiguous",
    ],
    [
      { spec: [specPath], plan: ["docs/plans/renamed.md"] },
      "prior-artifact-mismatch",
    ],
  ] as const) {
    await assert.rejects(
      assertPlanningImplementationBase({
        state: state(),
        phaseIndex: 2,
        base: base(candidates),
        git: {
          async assertAncestor() {
            assert.fail("must not inspect ancestry");
          },
          async assertRegularFiles() {
            assert.fail("must not inspect tree");
          },
        },
      }),
      (error) =>
        error instanceof PlanningImplementationBaseError &&
        error.reason === reason,
    );
  }
});

test("preserves non-regular and command errors from the current-base tree proof", async () => {
  for (const error of [
    new PlanningPublicationGitError("tree", "non-regular-file"),
    new PlanningPublicationGitError("tree", "command-failed"),
  ]) {
    await assert.rejects(
      assertPlanningImplementationBase({
        state: state(),
        phaseIndex: 2,
        base: base(),
        git: {
          async assertAncestor() {},
          async assertRegularFiles() {
            throw error;
          },
        },
      }),
      (received) => received === error,
    );
  }
});
