import test from "node:test";
import assert from "node:assert/strict";
import { summarizeErrorResult, summarizeResult } from "./result-summary.ts";

test("summaries preserve the established PR machine shape", () => {
  assert.deepEqual(
    summarizeResult({
      status: "pr-created",
      issue: {
        number: 174,
        title: "Title",
        body: "",
        labels: [],
        state: "open",
      },
      specPath: "docs/specs/result-design.md",
      planPath: "docs/plans/result-plan.md",
      branch: "agent/issue-174-readable-result",
      prUrl: "https://example.test/patchmill/pulls/174",
      worktreePath: ".worktrees/patchmill-issue-174-readable-result",
      commits: ["abc123", "def456"],
      validation: ["npm test passed", "npm run lint passed"],
      reviewSummary: "All findings resolved.",
      landingDecision: "PR required for CLI output change.",
      visualEvidence: [
        {
          screenshotPath: "docs/reference-screenshots/result.png",
          caption: "Readable final result",
          referencePaths: ["docs/reference-screenshots/before.png"],
          url: "https://example.test/evidence/174",
        },
      ],
      logPath: "/repo/.patchmill/runs/issue-174/run.jsonl",
      piSessionPath: "/repo/.patchmill/runs/issue-174/run-pi-sessions",
    }),
    {
      status: "pr-created",
      issueNumber: 174,
      specPath: "docs/specs/result-design.md",
      planPath: "docs/plans/result-plan.md",
      branch: "agent/issue-174-readable-result",
      prUrl: "https://example.test/patchmill/pulls/174",
      worktreePath: ".worktrees/patchmill-issue-174-readable-result",
      commits: ["abc123", "def456"],
      validation: ["npm test passed", "npm run lint passed"],
      reviewSummary: "All findings resolved.",
      landingDecision: "PR required for CLI output change.",
      visualEvidence: [
        {
          screenshotPath: "docs/reference-screenshots/result.png",
          caption: "Readable final result",
          referencePaths: ["docs/reference-screenshots/before.png"],
          url: "https://example.test/evidence/174",
        },
      ],
      logPath: "/repo/.patchmill/runs/issue-174/run.jsonl",
      piSessionPath: "/repo/.patchmill/runs/issue-174/run-pi-sessions",
    },
  );
});

test("summarizeErrorResult preserves aggregate causes and resolved log path", () => {
  assert.deepEqual(
    summarizeErrorResult(
      new AggregateError(
        [new Error("observer failed"), new Error("cleanup failed")],
        "Pi run failed",
      ),
      "/repo/.patchmill/runs/issue-174/run.jsonl",
    ),
    {
      status: "error",
      error: "Pi run failed",
      causes: ["observer failed", "cleanup failed"],
      logPath: "/repo/.patchmill/runs/issue-174/run.jsonl",
    },
  );
});

test("summarizes planning review and explicit stops without leaking the issue", () => {
  const issue = {
    number: 189,
    title: "Title",
    body: "",
    labels: [],
    state: "open" as const,
  };
  assert.deepEqual(
    summarizeResult({
      status: "review-pending",
      issue,
      phase: "spec",
      prUrl: "https://example.test/owner/repo/pull/12",
    }),
    {
      status: "review-pending",
      issueNumber: 189,
      phase: "spec",
      prUrl: "https://example.test/owner/repo/pull/12",
    },
  );
  assert.deepEqual(
    summarizeResult({
      status: "stopped",
      issue,
      reason: "plan-only",
      nextPhase: "implementation",
      specPath: "docs/specs/issue-189.md",
      planPath: "docs/plans/issue-189.md",
      branch: "agent/issue-189-implementation",
      worktreePath: ".worktrees/issue-189-implementation",
    }),
    {
      status: "stopped",
      issueNumber: 189,
      reason: "plan-only",
      nextPhase: "implementation",
      specPath: "docs/specs/issue-189.md",
      planPath: "docs/plans/issue-189.md",
      branch: "agent/issue-189-implementation",
      worktreePath: ".worktrees/issue-189-implementation",
    },
  );
});
