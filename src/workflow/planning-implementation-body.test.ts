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
    "```lang~x\nCloses #189\n```",
    "   ```md\nCloses #189",
    "  ~~~md\nCloses #189",
    "> Closes #189",
    "> Example closing syntax:\nCloses #189",
    "  > Example closing syntax:\nCloses #189",
    "    Closes #189",
    "- Closes #189",
    "   - Example closing syntax:\nCloses #189",
    "1. Example closing syntax:\nCloses #189",
    "1) Example closing syntax:\nCloses #189",
    "- Example closing syntax:\nCloses #189",
    "Closes #190",
    "Refs #189",
  ])
    assert.throws(
      () => assertImplementationClosingReference(body, 189),
      (error: unknown) =>
        error instanceof PlanningImplementationBodyError &&
        error.reason === "closing-reference",
    );
  for (const body of ["- - -\nCloses #189", "  ***\nCloses #189"])
    assert.doesNotThrow(() => assertImplementationClosingReference(body, 189));
});
