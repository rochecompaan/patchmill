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

function separateMergedHeads() {
  const fixture = publishedImplementationState();
  return validatePlanningState({
    ...fixture,
    phases: [
      {
        ...fixture.phases[0],
        workspace: { ...fixture.phases[0].workspace, headOid: oid("e") },
        observedHeadOid: oid("f"),
        merge: {
          mergeOid: oid("c"),
          mergedBaseOid: oid("d"),
          workspaceHeadOid: oid("e"),
        },
      },
    ],
  });
}

test("a verified workspace inclusion round-trips separately from checked and observed heads", () => {
  const state = separateMergedHeads();
  assert.deepEqual(parsePlanningState(serializePlanningState(state)), state);
});

test("distinct prepared and observed heads require exact, valid workspace inclusion evidence", () => {
  const state = separateMergedHeads();
  const phase = state.phases[0];
  if (phase?.kind !== "implementation" || phase.status !== "pull-request-open")
    assert.fail();
  for (const workspaceHeadOid of [undefined, "invalid", oid("d")])
    assert.throws(() =>
      validatePlanningState({
        ...state,
        phases: [{ ...phase, merge: { ...phase.merge, workspaceHeadOid } }],
      }),
    );
  assert.throws(() =>
    validatePlanningState({
      ...state,
      phases: [{ ...phase, observedHeadOid: undefined }],
    }),
  );
  assert.throws(() =>
    assertPlanningStateReplacement(state, {
      ...state,
      revision: state.revision + 1,
      phases: [
        { ...phase, merge: { ...phase.merge, mergedBaseOid: oid("f") } },
      ],
    }),
  );
});
