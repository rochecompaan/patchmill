import assert from "node:assert/strict";
import test from "node:test";
import {
  implementationOid as oid,
  publishedImplementationState,
} from "../../../../test-support/run-once/planning-implementation-state-fixture.ts";
import {
  assertPlanningStateReplacement,
  validatePlanningState,
} from "../../../workflow/planning-state.ts";
import { finishPlanningImplementation } from "./planning-finish.ts";
import { durableImplementationResult } from "./planning-runtime-state.ts";

test("a human merge of B completes with historical checks of A, not the merge object", async () => {
  let current = publishedImplementationState();
  const originalReceipt = structuredClone(current.phases[0].implementation);
  const result = await finishPlanningImplementation({
    state: current,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      replace: async ({ next }) => {
        const parsed = validatePlanningState(next);
        assertPlanningStateReplacement(current, parsed);
        current = parsed as typeof current;
        return parsed;
      },
    },
    reconcilePr: async () => ({
      kind: "merged",
      headOid: oid("e"),
      mergeOid: oid("c"),
      mergedBaseOid: oid("d"),
    }),
    git: {
      inspectRemoteHead: async () =>
        assert.fail("a deleted merged branch is not required"),
    },
    workspaces: {
      removeWorktree: async () => ({
        kind: "removed",
        snapshot: {
          state: "branch-only",
          identity: current.phases[0].workspace.identity,
          headOid: oid("b"),
        },
      }),
      removeBranch: async () => {},
    },
    effects: {
      publishCost: async () => {},
      validateVisualEvidence: async () => {},
      postHandoff: async () => {},
      cleanupHook: async () => {},
      ensureDoneLabel: async () => {},
      applyDoneLabels: async () => {},
    },
  });
  assert.equal(result.kind, "complete");
  if (result.kind !== "complete") assert.fail("human merge must complete");
  assert.equal(result.result.checkedHeadOid, oid("b"));
  assert.equal(result.result.observedHeadOid, oid("e"));
  assert.equal(result.result.mergeCommit, oid("c"));
  assert.match(result.result.validation[0]!, /historical/i);
  assert.ok(result.result.validation[0]!.includes(oid("b")));
  assert.match(result.result.reviewSummary!, /historical/i);
  assert.ok(result.result.reviewSummary!.includes(oid("b")));
  assert.deepEqual(current.phases[0].implementation, originalReceipt);
  assert.equal(current.phases[0].observedHeadOid, oid("e"));
});

test("older published receipts use their saved publication head, never a new host observation", () => {
  const phase = publishedImplementationState().phases[0];
  const result = durableImplementationResult({
    ...phase,
    observedHeadOid: oid("e"),
  });
  assert.equal(result.checkedHeadOid, oid("b"));
  assert.equal(result.observedHeadOid, oid("e"));
  assert.match(result.validation[0]!, /historical/i);
});

test("unchanged observed heads keep the original validation and review presentation", () => {
  const phase = publishedImplementationState().phases[0];
  const result = durableImplementationResult(phase);
  assert.equal(result.checkedHeadOid, oid("b"));
  assert.equal(result.observedHeadOid, oid("b"));
  assert.deepEqual(result.validation, ["npm test passed"]);
  assert.equal(result.reviewSummary, "No blocking findings");
});
