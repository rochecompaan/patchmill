import assert from "node:assert/strict";
import test from "node:test";
import {
  assertImplementationClosingReference,
  PlanningImplementationBodyError,
} from "./planning-implementation-body.ts";

test("requires one effective top-level implementation closing reference", () => {
  assert.doesNotThrow(() =>
    assertImplementationClosingReference("Summary\r\n\r\nCloses #189", 189),
  );
  for (const body of [
    "```md\nCloses #189\n```",
    "> Closes #189",
    "    Closes #189",
    "- Closes #189",
    "Closes #190",
    "Refs #189",
  ])
    assert.throws(
      () => assertImplementationClosingReference(body, 189),
      (error: unknown) =>
        error instanceof PlanningImplementationBodyError &&
        error.reason === "closing-reference",
    );
});
