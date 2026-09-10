import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactPath,
  requiredImplementationFinishContext,
} from "./planning-runtime-state.ts";

const state = {
  phases: [
    {
      kind: "spec",
      status: "complete",
      artifacts: [{ kind: "spec", path: "docs/specs/issue.md" }],
    },
    {
      kind: "implementation",
      status: "pull-request-open",
      artifacts: [{ kind: "plan", path: "docs/plans/issue.md" }],
      implementation: {},
      pullRequest: {},
      workspace: {},
    },
  ],
} as never;

test("selects one durable planning artifact and validated implementation finish phase", () => {
  assert.equal(artifactPath(state, "plan"), "docs/plans/issue.md");
  assert.equal(requiredImplementationFinishContext(state, 1), state.phases[1]);
});

test("rejects missing artifacts and unvalidated finish phases", () => {
  assert.throws(() => artifactPath(state, "planx" as never));
  assert.throws(() => requiredImplementationFinishContext(state, 0));
});
