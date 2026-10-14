import assert from "node:assert/strict";
import test from "node:test";
import {
  implementationOid as oid,
  publishedImplementationState,
} from "../../test-support/run-once/planning-implementation-state-fixture.ts";
import { invalidateImplementationChecks } from "../cli/commands/run-once/planning-implementation-revalidation.ts";
import {
  assertPlanningStateReplacement,
  parsePlanningState,
  serializePlanningState,
  validatePlanningState,
} from "./planning-state.ts";

test("invalidating removed-worktree checks preserves the receipt and truthful recovery state", () => {
  const fixture = publishedImplementationState();
  const published = fixture.phases[0];
  const finish = {
    costPublicationCompleted: true,
    visualEvidenceValidated: true,
    handoffCommentPosted: true,
    cleanupHookCompleted: true,
  };
  const current = validatePlanningState({
    ...fixture,
    phases: [
      {
        ...published,
        finish,
        workspace: {
          ...published.workspace,
          cleanup: { state: "removed", pushedHeadOid: oid("b") },
        },
      },
    ],
  });
  const phase = current.phases[0];
  if (phase?.kind !== "implementation" || phase.status !== "pull-request-open")
    assert.fail();
  const pending = invalidateImplementationChecks(phase);
  assert.equal(pending.status, "revalidation-pending");
  assert.deepEqual(pending.workspace, phase.workspace);
  assert.deepEqual(pending.revalidation.publication, phase.publication);
  assert.deepEqual(pending.revalidation.pullRequest, phase.pullRequest);
  assert.deepEqual(pending.revalidation.implementation, phase.implementation);
  assert.deepEqual(pending.revalidation.finish, finish);
  const next = validatePlanningState({
    ...current,
    revision: 1,
    phases: [pending],
  });
  assertPlanningStateReplacement(current, next);
  assert.deepEqual(parsePlanningState(serializePlanningState(next)), next);
  for (const patch of [
    {
      ...pending,
      workspace: {
        ...pending.workspace,
        headOid: oid("e"),
        cleanup: { state: "ready" },
      },
    },
    {
      ...pending,
      revalidation: {
        ...pending.revalidation,
        pullRequest: {
          ...phase.pullRequest,
          url: "https://github.com/test/repo/pull/18",
        },
      },
    },
    {
      ...pending,
      revalidation: {
        ...pending.revalidation,
        implementation: { ...phase.implementation, validation: ["invented"] },
      },
    },
  ])
    assert.throws(() =>
      assertPlanningStateReplacement(current, { ...next, phases: [patch] }),
    );
});

test("prepared retries retain old PR evidence until the same PR is freshly validated", () => {
  const fixture = publishedImplementationState();
  const pending = invalidateImplementationChecks(fixture.phases[0]);
  assert.ok(
    pending.revalidation,
    "the old PR receipt must survive preparation",
  );
  const current = validatePlanningState({ ...fixture, phases: [pending] });
  const ready = {
    ...pending,
    status: "workspace-ready",
    workspace: {
      ...pending.workspace,
      headOid: oid("e"),
      cleanup: { state: "ready" },
    },
  };
  const next = validatePlanningState({
    ...current,
    revision: 1,
    phases: [ready],
  });
  assertPlanningStateReplacement(current, next);
  assert.deepEqual(parsePlanningState(serializePlanningState(next)), next);
  assert.throws(() =>
    assertPlanningStateReplacement(current, {
      ...next,
      phases: [{ ...ready, revalidation: undefined }],
    }),
  );
});
