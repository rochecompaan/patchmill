import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  formatTerminalResult,
  terminalResultSeverity,
} from "./terminal-result.ts";
import type { RunOnceResultSummary } from "./result-summary.ts";

const summary: RunOnceResultSummary = {
  status: "pr-created",
  issueNumber: 174,
  specPath: "docs/specs/a-very-long-result-design-document.md",
  planPath: "docs/plans/a-very-long-result-plan.md",
  branch: "agent/issue-174-readable-terminal-result",
  prUrl: "https://example.test/patchmill/pulls/174",
  worktreePath: ".worktrees/patchmill-issue-174-readable-terminal-result",
  commits: ["abc123", "def456"],
  validation: ["npm test passed", "npm run lint passed"],
  reviewSummary:
    "A long review summary remains readable in a narrow terminal without losing any words.",
  landingDecision: "PR required for a user-visible CLI output contract change.",
  visualEvidence: [
    {
      screenshotPath: "docs/reference-screenshots/result.png",
      caption: "Readable final result",
      referencePaths: ["docs/reference-screenshots/before.png"],
      url: "https://example.test/evidence/174",
    },
  ],
  logPath: "/tmp/run.jsonl",
  piSessionPath: "/tmp/run-pi-sessions",
};

test("renders ordered sections, vertical arrays, and header metrics", () => {
  const output = formatTerminalResult(summary, {
    width: 100,
    color: false,
    stepNumber: 11,
    totalOutputTokens: 56_000,
    elapsedSeconds: 15_602,
  });
  for (const heading of [
    "Pull request",
    "Issue and workspace",
    "Artifacts",
    "Validation (2)",
    "Review",
    "Landing decision",
    "Commits (2)",
    "Visual evidence (1)",
    "Run files",
  ])
    assert.ok(output.indexOf(heading) > -1);
  assert.match(
    output,
    /^11 {2}Final result: ✓ PR created\n {4}56\.0k tokens · elapsed 4h20m02s/mu,
  );
  assert.match(output, /^ {2}✓ npm test passed$/mu);
  assert.match(output, /^ {2}• abc123$/mu);
  assert.match(output, /^ {2}• def456$/mu);
});

test("wraps narrow output without truncating dynamic values", () => {
  const output = formatTerminalResult(summary, { width: 24, color: false });
  for (const line of output.split("\n"))
    assert.ok(visibleWidth(line) <= 24, `${visibleWidth(line)} > 24: ${line}`);
  assert.match(output, /Branch:\n/);
  assert.doesNotMatch(output, /…|\.\.\./u);
  assert.ok(
    output
      .replaceAll(/\s+/gu, "")
      .includes("https://example.test/patchmill/pulls/174"),
  );
});

test("sanitizes hostile strings and styles only renderer output", () => {
  const hostile: RunOnceResultSummary = {
    status: "error",
    error: "\u001b[31mred\u001b[0m\nInjected heading\u0007",
    causes: ["\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007"],
  };
  const plain = formatTerminalResult(hostile, { width: 32, color: false });
  const colored = formatTerminalResult(hostile, { width: 32, color: true });
  assert.doesNotMatch(plain, /\u001b|\u0007|^Injected heading$/mu);
  assert.match(plain, /Injected heading/u);
  assert.equal(stripTerminalSequences(colored), plain);
  assert.match(
    colored,
    /\u001b\[1m\u001b\[31mFinal result: ✗ Error\u001b\[0m/u,
  );
  assert.match(colored, /\u001b\[31m✗/u);
  for (const line of colored.split("\n")) assert.ok(visibleWidth(line) <= 32);
});

test("maps every status to its visible severity marker and label", () => {
  const cases: Array<[RunOnceResultSummary, string]> = [
    [{ status: "no-issue" }, "✓ No eligible issue"],
    [
      { status: "dry-run", issueNumber: 1, title: "Issue", transition: "plan" },
      "✓ Dry run",
    ],
    [
      { status: "spec-created", issueNumber: 1, specPath: "spec.md" },
      "✓ Specification created",
    ],
    [
      { status: "spec-found", issueNumber: 1, specPath: "spec.md" },
      "✓ Specification found",
    ],
    [
      { status: "plan-created", issueNumber: 1, planPath: "plan.md" },
      "✓ Implementation plan created",
    ],
    [
      { status: "plan-found", issueNumber: 1, planPath: "plan.md" },
      "✓ Implementation plan found",
    ],
    [summary, "✓ PR created"],
    [
      {
        status: "merged",
        issueNumber: 1,
        planPath: "plan.md",
        branch: "branch",
        mergeCommit: "abc",
        worktreePath: "worktree",
        commits: [],
        validation: [],
      },
      "✓ Merged",
    ],
    [
      {
        status: "approval-required",
        issueNumber: 1,
        approvalKind: "spec",
        missingLabel: "spec-approved",
      },
      "! Approval required",
    ],
    [
      {
        status: "development-environment-not-ready",
        issueNumber: 1,
        planPath: "plan.md",
        reason: "not ready",
        evidence: [],
        remediation: [],
      },
      "! Development environment not ready",
    ],
    [
      { status: "blocked", issueNumber: 1, reason: "blocked", questions: [] },
      "✗ Blocked",
    ],
    [{ status: "error", error: "failed" }, "✗ Error"],
  ];
  for (const [result, header] of cases)
    assert.match(
      formatTerminalResult(result, { width: 100, color: false }),
      new RegExp(`Final result: ${header}`, "u"),
    );
  assert.equal(terminalResultSeverity("pr-created"), "success");
  assert.equal(terminalResultSeverity("approval-required"), "warning");
  assert.equal(terminalResultSeverity("blocked"), "failure");
});

test("renders each status with its relevant semantic sections", () => {
  const cases: Array<[RunOnceResultSummary, string[]]> = [
    [{ status: "no-issue" }, []],
    [
      { status: "dry-run", issueNumber: 1, title: "Issue", transition: "plan" },
      ["Issue and workspace", "Transition"],
    ],
    [
      { status: "spec-created", issueNumber: 1, specPath: "spec.md" },
      ["Issue and workspace", "Artifacts"],
    ],
    [
      { status: "spec-found", issueNumber: 1, specPath: "spec.md" },
      ["Issue and workspace", "Artifacts"],
    ],
    [
      { status: "plan-created", issueNumber: 1, planPath: "plan.md" },
      ["Issue and workspace", "Artifacts"],
    ],
    [
      { status: "plan-found", issueNumber: 1, planPath: "plan.md" },
      ["Issue and workspace", "Artifacts"],
    ],
    [summary, ["Pull request", "Validation (2)", "Review", "Run files"]],
    [
      {
        status: "merged",
        issueNumber: 1,
        planPath: "plan.md",
        branch: "branch",
        mergeCommit: "abc",
        worktreePath: "worktree",
        commits: [],
        validation: [],
        landingDecision: "landed",
      },
      ["Issue and workspace", "Artifacts", "Landing decision"],
    ],
    [
      {
        status: "approval-required",
        issueNumber: 1,
        approvalKind: "spec",
        missingLabel: "spec-approved",
      },
      ["Issue and workspace", "Approval"],
    ],
    [
      {
        status: "development-environment-not-ready",
        issueNumber: 1,
        planPath: "plan.md",
        reason: "not ready",
        evidence: ["evidence"],
        remediation: ["retry"],
      },
      ["Issue and workspace", "Artifacts", "Environment readiness"],
    ],
    [
      {
        status: "blocked",
        issueNumber: 1,
        reason: "blocked",
        questions: ["what now?"],
      },
      ["Issue and workspace", "Failure", "Questions (1)"],
    ],
    [{ status: "error", error: "failed", causes: ["cause"] }, ["Failure"]],
  ];
  for (const [result, headings] of cases) {
    const output = formatTerminalResult(result, { width: 100, color: false });
    for (const heading of headings) assert.ok(output.includes(heading));
    if (result.status === "no-issue") assert.doesNotMatch(output, /\n\n/u);
  }
});

test("keeps every line within every positive width and resets styled lines", () => {
  for (let width = 1; width <= 32; width += 1) {
    const plain = formatTerminalResult(summary, { width, color: false });
    const colored = formatTerminalResult(summary, { width, color: true });
    for (const line of plain.split("\n"))
      assert.ok(
        visibleWidth(line) <= width,
        `${visibleWidth(line)} > ${width}`,
      );
    assert.ok(
      plain
        .replaceAll(/\s+/gu, "")
        .includes("https://example.test/patchmill/pulls/174"),
    );
    for (const line of colored.split("\n")) {
      assert.ok(
        visibleWidth(line) <= width,
        `${visibleWidth(line)} > ${width}`,
      );
      if (line.includes("\u001b[")) assert.ok(line.endsWith("\u001b[0m"));
    }
    assert.equal(stripTerminalSequences(colored), plain);
  }
});

test("omits optional empty sections", () => {
  const output = formatTerminalResult(
    { status: "no-issue" },
    { width: 80, color: false },
  );
  assert.doesNotMatch(output, /\n\n\n|\(0\)|Artifacts|Run files/u);
});
