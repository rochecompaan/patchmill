import assert from "node:assert/strict";
import test from "node:test";
import { formatPlanningCleanupPath } from "./planning-cleanup-pending.ts";

test("cleanup path diagnostics escape terminal control characters", () => {
  const path = formatPlanningCleanupPath("line\nbreak\t\u001b[31m\u007f\u0080");
  assert.equal(path, '"line\\nbreak\\t\\u001b[31m\\u007f\\u0080"');
  assert.doesNotMatch(path, /\n|\t|\u001b/u);
});
