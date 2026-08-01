import assert from "node:assert/strict";
import test from "node:test";
import { appendPiErrorCause, formatErrorWithCauses } from "./pi-errors.ts";

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

test("appendPiErrorCause preserves aggregate causes with reporting failure", () => {
  const original = new AggregateError(
    [new Error("observation: malformed json"), new Error("runner: pi failed")],
    "pi prompt failed",
  );

  assert.deepEqual(
    formatErrorWithCauses(
      appendPiErrorCause(
        original,
        "error reporting",
        new Error("log write failed"),
      ),
    ),
    {
      message: "pi prompt failed",
      causes: [
        "observation: malformed json",
        "runner: pi failed",
        "error reporting: log write failed",
      ],
    },
  );
});
