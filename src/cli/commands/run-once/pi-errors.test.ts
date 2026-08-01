import assert from "node:assert/strict";
import test from "node:test";
import { formatErrorWithCauses } from "./pi-errors.ts";

test("formatErrorWithCauses preserves every aggregate terminal cause", () => {
  const formatted = formatErrorWithCauses(
    new AggregateError(
      [
        new Error("observation: malformed json"),
        new Error("runner: pi failed"),
      ],
      "pi prompt failed",
    ),
  );

  assert.deepEqual(formatted, {
    message: "pi prompt failed",
    causes: ["observation: malformed json", "runner: pi failed"],
  });
});
