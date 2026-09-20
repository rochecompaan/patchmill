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
  assert.equal(output.match(/Questions/gu)?.length, 1);
  assert.match(output, /Which API\?/u);
  assert.doesNotMatch(output, /\u001b\[/u);
});

test("renders common issue and workspace details only once", () => {
  const branch = "agent/issue-242-plan";
  const worktreePath = ".worktrees/patchmill-issue-242-plan";
  const output = formatTerminalResult(
    {
      status: "stopped",
      issueNumber: 242,
      reason: "plan-only",
      branch,
      worktreePath,
      diagnostic: diagnosticFor("plan-only", {
        issueNumber: 242,
        phase: "plan",
        branch,
        worktreePath,
      }),
    },
    { width: 100, color: false },
  );
  assert.equal(output.match(/#242/gu)?.length, 1);
  assert.equal(output.match(new RegExp(branch, "gu"))?.length, 1);
  assert.equal(output.match(new RegExp(worktreePath, "gu"))?.length, 1);
});

test("renders an error log path only in Run files", () => {
  const logPath = "/tmp/issue-242.jsonl";
  const output = formatTerminalResult(
    {
      status: "error",
      error: "Unexpected failure",
      logPath,
      reason: "unexpected-error",
      diagnostic: diagnosticFor("unexpected-error", {
        error: "Unexpected failure",
        logPath,
      }),
    },
    { width: 100, color: false },
  );
  assert.equal(output.match(/\/tmp\/issue-242\.jsonl/gu)?.length, 1);
  assert.match(output, /Run files/u);
});
