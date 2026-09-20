import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exitCodeForRunOnceResult,
  writeRunOnceResult,
} from "./result-output.ts";
import { summarizeResult } from "./result-summary.ts";
import {
  formatTerminalResult,
  terminalResultSeverity,
} from "./terminal-result.ts";

const cleanupPending = {
  status: "cleanup-pending" as const,
  issue: { number: 243, title: "Cleanup", state: "open" as const, labels: [] },
  phase: "implementation" as const,
  prUrl: "https://github.com/acme/patchmill/pull/243",
  branch: "agent/243",
  worktreePath: ".worktrees/243",
  reason: "ignored-worktree-content" as const,
  ignoredPaths: ["line\nbreak\t\u001b[31m"],
  remediation: ["Inspect and preserve or remove the listed ignored paths."],
  planPath: "docs/plans/issue-243.md",
  commits: ["a".repeat(40)],
  validation: ["npm test"],
};

test("cleanup pending is an exit-zero warning with structured diagnostics", () => {
  const summary = summarizeResult(cleanupPending);
  assert.equal(summary.status, "cleanup-pending");
  assert.equal(summary.reason, "ignored-worktree-content");
  assert.equal(summary.diagnostic?.retry.kind, "after-action");
  assert.equal(exitCodeForRunOnceResult(summary), 0);
  assert.equal(terminalResultSeverity(summary.status), "warning");
});

test("cleanup pending writes warning JSONL and complete terminal sections", async () => {
  const summary = summarizeResult(cleanupPending);
  const dir = await mkdtemp(join(tmpdir(), "patchmill-cleanup-pending-"));
  const path = join(dir, "result.jsonl");
  const redirected: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: { isTTY: false, write: (chunk) => redirected.push(String(chunk)) },
    env: {},
    logPath: path,
    time: new Date("2026-09-15T00:00:00.000Z"),
  });
  assert.equal(redirected.join(""), `${JSON.stringify(summary)}\n`);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    time: "2026-09-15T00:00:00.000Z",
    level: "warning",
    stage: "result",
    message: "final result cleanup-pending",
    data: summary,
  });
  const rendered = formatTerminalResult(summary, { width: 100, color: false });
  for (const section of [
    "Pull request",
    "Issue and workspace",
    "Details",
    "Phase",
    "Reason",
    "Worktree",
    "Inspect and preserve or remove the listed ignored paths.",
    "Validation",
    "Commits",
  ])
    assert.match(rendered, new RegExp(section, "u"));
  assert.match(rendered, /line break/u);
  assert.doesNotMatch(rendered, /\u001b\[31m/u);
});

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
  assert.match(rendered, /line break/u);
  assert.doesNotMatch(rendered, /\u001b\[31m/u);
});
