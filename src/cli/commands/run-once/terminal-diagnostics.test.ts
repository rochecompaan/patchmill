import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticFor } from "./result-diagnostics.ts";
import { formatTerminalResult } from "./terminal-result.ts";

test("renders shared diagnostic sections in stable actionable order", () => {
  const output = formatTerminalResult(
    {
      status: "blocked",
      issueNumber: 242,
      reason: "agent-blocked",
      questions: ["Which API?"],
      diagnostic: diagnosticFor("agent-blocked", {
        issueNumber: 242,
        reportedReason: "\u001b[31munsafe advice\u001b[0m",
        questions: ["Which API?"],
      }),
    },
    { width: 32, color: false },
  );
  const headings = [
    "Reason",
    "Explanation",
    "Details",
    "Recommended action",
    "Safety",
    "Retry",
  ];
  for (const [index, heading] of headings.entries()) {
    assert.ok(output.includes(heading));
    if (index)
      assert.ok(output.indexOf(headings[index - 1]!) < output.indexOf(heading));
  }
  assert.match(output.replace(/\s+/gu, " "), /patchmill run-once --issue 242/u);
  assert.doesNotMatch(output, /\u001b\[/u);
});
