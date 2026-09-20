import test from "node:test";
import assert from "node:assert/strict";
import { summarizeErrorResult, summarizeResult } from "./result-summary.ts";
import { runOnceFailure } from "./result-diagnostics.ts";

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

test("summaries retain catalog-owned planning blocker reasons", () => {
  const issue = {
    number: 189,
    title: "Planning",
    body: "",
    labels: [],
    state: "open" as const,
  };
  const failures = [
    runOnceFailure("planning-pull-request-missing", {
      issueNumber: 189,
      status: "blocked",
      phase: "plan",
      pullRequestReference: "#12",
    }),
    runOnceFailure("ambiguous-base-artifact", {
      issueNumber: 189,
      status: "blocked",
      phase: "spec",
      artifactKind: "spec",
      baseOid: "abc123",
      candidates: ["docs/specs/a.md", "docs/specs/b.md"],
    }),
    runOnceFailure("planning-identity-changed", {
      issueNumber: 189,
      status: "blocked",
      expectedIdentity: ["title=Planning"],
      observedIdentity: ["title=Changed"],
    }),
  ] as const;
  for (const failure of failures) {
    const summary = summarizeResult({
      status: "blocked",
      issue,
      reason: failure.reason,
      publicFailure: failure,
      questions: [],
      commits: [],
      validation: [],
    });
    assert.equal(summary.reason, failure.reason);
    assert.equal(summary.diagnostic.summary.length > 0, true);
  }
});

test("summarizeErrorResult preserves aggregate causes and resolved log path", () => {
  const summary = summarizeErrorResult(
    new AggregateError(
      [new Error("observer failed"), new Error("cleanup failed")],
      "Pi run failed",
    ),
    "/repo/.patchmill/runs/issue-174/run.jsonl",
  );
  assert.equal(summary.reason, "unexpected-error");
  assert.equal(
    summary.diagnostic?.details.find((entry) => entry.key === "error")?.value,
    "Pi run failed",
  );
  assert.deepEqual(summary.causes, ["observer failed", "cleanup failed"]);
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
  const stopped = summarizeResult({
    status: "stopped",
    issue,
    reason: "plan-only",
    publicFailure: runOnceFailure("plan-only", {
      issueNumber: 189,
      status: "stopped",
      phase: "implementation",
      branch: "agent/issue-189-implementation",
      worktreePath: ".worktrees/issue-189-implementation",
      nextPhase: "implementation",
    }),
    nextPhase: "implementation",
    specPath: "docs/specs/issue-189.md",
    planPath: "docs/plans/issue-189.md",
    branch: "agent/issue-189-implementation",
    worktreePath: ".worktrees/issue-189-implementation",
  });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.diagnostic?.retry.kind, "retry-now");
  assert.equal(
    stopped.diagnostic?.actions[0]?.command,
    "patchmill run-once --issue 189",
  );
});
