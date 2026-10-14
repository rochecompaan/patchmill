import assert from "node:assert/strict";
import test from "node:test";
import {
  implementationOid as oid,
  publishedImplementationState,
} from "../../test-support/run-once/planning-implementation-state-fixture.ts";
import {
  assertPlanningStateReplacement,
  parsePlanningState,
  serializePlanningState,
  validatePlanningState,
} from "./planning-state.ts";

test("old published state remains readable without inventing a checked revision", () => {
  const state = publishedImplementationState();
  const parsed = parsePlanningState(serializePlanningState(state));
  assert.deepEqual(parsed, state);
  assert.equal(parsed.phases[0].implementation.checkedHeadOid, undefined);
});

test("observed head advancement persists without changing the check receipt", () => {
  const state = publishedImplementationState();
  const next = validatePlanningState({
    ...state,
    revision: 1,
    phases: [
      {
        ...state.phases[0],
        observedHeadOid: oid("e"),
        implementation: {
          ...state.phases[0].implementation,
          checkedHeadOid: oid("b"),
        },
      },
    ],
  });
  const current = validatePlanningState({
    ...state,
    phases: [
      {
        ...state.phases[0],
        implementation: {
          ...state.phases[0].implementation,
          checkedHeadOid: oid("b"),
        },
      },
    ],
  });
  assertPlanningStateReplacement(current, next);
  assert.deepEqual(parsePlanningState(serializePlanningState(next)), next);
  assert.throws(
    () =>
      assertPlanningStateReplacement(current, {
        ...next,
        phases: [
          {
            ...next.phases[0],
            implementation: {
              ...next.phases[0].implementation,
              checkedHeadOid: oid("e"),
            },
          },
        ],
      }),
    /immutable/,
  );
});

test("independent publication validation may stamp only the actual checked head", () => {
  const state = publishedImplementationState();
  const { pullRequest: _pr, finish: _finish, ...phase } = state.phases[0];
  const current = validatePlanningState({
    ...state,
    phases: [{ ...phase, status: "branch-pushed" }],
  });
  const next = validatePlanningState({
    ...state,
    revision: 1,
    phases: [
      {
        ...state.phases[0],
        observedHeadOid: oid("b"),
        implementation: { ...phase.implementation, checkedHeadOid: oid("b") },
      },
    ],
  });
  assert.doesNotThrow(() => assertPlanningStateReplacement(current, next));
  assert.throws(() =>
    assertPlanningStateReplacement(current, {
      ...next,
      phases: [
        {
          ...next.phases[0],
          implementation: { ...phase.implementation, checkedHeadOid: oid("e") },
        },
      ],
    }),
  );
});

test("malformed checked and observed heads cannot be persisted", () => {
  const state = publishedImplementationState();
  for (const patch of [
    { observedHeadOid: "invalid" },
    {
      implementation: {
        ...state.phases[0].implementation,
        checkedHeadOid: "invalid",
      },
    },
  ])
    assert.throws(() =>
      validatePlanningState({
        ...state,
        phases: [{ ...state.phases[0], ...patch }],
      }),
    );
});
