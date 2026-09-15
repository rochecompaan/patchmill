import assert from "node:assert/strict";
import test from "node:test";
import { exitCodeForRunOnceResult } from "./result-output.ts";
import { summarizeResult } from "./result-summary.ts";
import {
  formatTerminalResult,
  terminalResultSeverity,
} from "./terminal-result.ts";

test("cleanup pending is an exit-zero warning with escaped terminal paths", () => {
  const summary = summarizeResult({
    status: "cleanup-pending",
    issue: { number: 243, title: "Cleanup", state: "open", labels: [] },
    phase: "implementation",
    prUrl: "https://github.com/acme/patchmill/pull/243",
    branch: "agent/243",
    worktreePath: ".worktrees/243",
    reason: "ignored-worktree-content",
    ignoredPaths: ["line\nbreak\t\u001b[31m"],
    remediation: ["Inspect and preserve or remove the listed ignored paths."],
    planPath: "docs/plans/issue-243.md",
    commits: ["a".repeat(40)],
    validation: ["npm test"],
  });
  assert.equal(summary.status, "cleanup-pending");
  assert.equal(exitCodeForRunOnceResult(summary), 0);
  assert.equal(terminalResultSeverity(summary.status), "warning");
  const rendered = formatTerminalResult(summary, { width: 100, color: false });
  assert.match(rendered, /Final result: ! Cleanup pending/u);
  assert.match(rendered, /line\\nbreak\\t\\u001b/u);
  assert.doesNotMatch(rendered, /\u001b\[31m/u);
});
