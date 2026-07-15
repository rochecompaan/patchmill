import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDirectLandAllowed,
  effectiveCheckpoints,
  lifecycleLabels,
  nextLabels,
  successfulImplementationFromState,
  workflowTransition,
} from "./pipeline-lifecycle.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";

test("nextLabels removes old labels and appends new labels once", () => {
  assert.deepEqual(
    nextLabels(["agent:ready", "x"], ["agent:ready"], ["agent:done"]),
    ["x", "agent:done"],
  );
});

test("workflowTransition describes approval transitions", async () => {
  const config = await makeConfig();
  assert.equal(
    workflowTransition({ kind: "agent-ready" }, config),
    "agent-ready -> agent-done",
  );
});

test("effectiveCheckpoints drops resume-only side-effect checkpoints for fresh runs", () => {
  assert.deepEqual(effectiveCheckpoints({ claimed: true }), undefined);
  assert.deepEqual(effectiveCheckpoints({ claimed: true }, true), {
    claimed: true,
  });
});

test("lifecycleLabels resolves configured labels", async () => {
  const config = await makeConfig();
  assert.equal(lifecycleLabels(config).ready, "agent-ready");
});

test("successfulImplementationFromState reconstructs saved pr-created result", () => {
  assert.deepEqual(
    successfulImplementationFromState({
      implementationStatus: "pr-created",
      branch: "b",
      prUrl: "https://example/pr/1",
      commits: ["abc"],
      validation: ["npm test"],
    }),
    {
      status: "pr-created",
      branch: "b",
      prUrl: "https://example/pr/1",
      commits: ["abc"],
      validation: ["npm test"],
      reviewSummary: undefined,
      landingDecision: undefined,
      visualEvidence: undefined,
    },
  );
});

test("assertDirectLandAllowed rejects merged when direct land is disabled", async () => {
  const config = await makeConfig({ allowDirectLand: false });
  assert.throws(() =>
    assertDirectLandAllowed(
      {
        status: "merged",
        branch: "b",
        mergeCommit: "abc",
        commits: ["abc"],
        validation: [],
      },
      config,
      "test",
    ),
  );
});
