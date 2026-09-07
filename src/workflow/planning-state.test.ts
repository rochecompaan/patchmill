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
const gates = { specRequired: true, planRequired: true };

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
