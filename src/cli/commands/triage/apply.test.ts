import test from "node:test";
import assert from "node:assert/strict";
import { createStaticCommandRunner } from "./command.ts";
import {
  ApplyDecisionError,
  applyDecisions,
  buildNeedsInfoComment,
  createLogEntries,
} from "./apply.ts";
import type { IssueSummary, TriageDecision } from "./types.ts";

const issues: IssueSummary[] = [
  {
    number: 1,
    title: "Missing info",
    body: "Broken",
    labels: ["bug"],
    state: "open",
  },
  {
    number: 2,
    title: "Easy",
    body: "Clear",
    labels: ["enhancement"],
    state: "open",
  },
];

const needsInfo: TriageDecision = {
  issueNumber: 1,
  primaryBucket: "needs-info",
  labels: ["bug", "needs-info", "priority:medium"],
  confidence: "medium",
  rationale: "Missing exact reproduction details.",
  questions: ["Which screen fails?", "What exact steps reproduce it?"],
  comment: null,
};

const easy: TriageDecision = {
  issueNumber: 2,
  primaryBucket: "agent-ready",
  labels: ["enhancement", "agent-ready", "priority:medium"],
  confidence: "high",
  rationale: "Clear localized change.",
  questions: [],
  comment: "Automated triage marked this as easy.",
};

const humanDecision: TriageDecision = {
  issueNumber: 2,
  primaryBucket: "needs-info",
  labels: ["enhancement", "needs-info", "priority:medium"],
  confidence: "high",
  rationale:
    "Expected report behavior is ambiguous and needs product direction.",
  questions: [
    {
      question: "Which report columns are required?",
      recommendedAnswer:
        "Include the same columns visible in the dashboard first, then add extra fields in a follow-up issue.",
    },
    {
      question: "Who should be able to export the report?",
      recommendedAnswer:
        "Allow admins and managers only, matching existing dashboard export permissions.",
    },
  ],
  comment: null,
};

test("buildNeedsInfoComment formats actionable numbered questions", () => {
  const comment = buildNeedsInfoComment(needsInfo);

  assert.match(comment, /Automated triage needs more information/);
  assert.match(comment, /1\. Which screen fails\?/);
  assert.match(comment, /2\. What exact steps reproduce it\?/);
});

test("buildNeedsInfoComment formats rationale, questions, and recommended answers", () => {
  const comment = buildNeedsInfoComment(humanDecision);

  assert.match(comment, /Automated triage needs more information/);
  assert.match(comment, /Rationale:\nExpected report behavior is ambiguous/);
  assert.match(comment, /Follow-up questions and recommended answers:/);
  assert.match(comment, /1\. Which report columns are required\?/);
  assert.match(
    comment,
    /Recommended answer: Include the same columns visible in the dashboard first/,
  );
  assert.match(comment, /2\. Who should be able to export the report\?/);
  assert.match(comment, /Recommended answer: Allow admins and managers only/);
});

test("createLogEntries records planned dry-run entries with previous labels and mutation status", () => {
  const entries = createLogEntries(issues, [needsInfo, easy], "planned");

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    issueNumber: 1,
    title: "Missing info",
    previousLabels: ["bug"],
    finalLabels: ["bug", "needs-info", "priority:medium"],
    primaryBucket: "needs-info",
    confidence: "medium",
    rationale: "Missing exact reproduction details.",
    questions: ["Which screen fails?", "What exact steps reproduce it?"],
    comment: buildNeedsInfoComment(needsInfo),
    mutationStatus: "planned",
  });
  assert.equal(entries[1].mutationStatus, "planned");
  assert.equal(entries[1].comment, "Automated triage marked this as easy.");
});

test("createLogEntries records generated comments for needs-info entries with recommended answers", () => {
  const entries = createLogEntries(issues, [humanDecision], "planned");

  assert.equal(entries[0].comment, buildNeedsInfoComment(humanDecision));
});

test("createLogEntries records optional errors on failed entries", () => {
  const entries = createLogEntries(
    issues,
    [easy],
    "applied",
    new Map([[2, "tea comment failed"]]),
  );

  assert.equal(entries[0].mutationStatus, "failed");
  assert.equal(entries[0].error, "tea comment failed");
});

test("applyDecisions applies issue labels and comments for needs-info and discretionary comments", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  await applyDecisions(runner, "/repo", issues, [needsInfo, easy]);

  const commands = runner.calls.map(
    (call) => `${call.command} ${call.args.join(" ")}`,
  );
  assert.ok(commands.some((command) => command.includes("issues edit 1")));
  assert.ok(commands.some((command) => command.includes("issues edit 2")));
  assert.ok(
    commands.some((command) =>
      command.includes(
        "comment 1 --repo /repo -- Automated triage needs more information",
      ),
    ),
  );
  assert.ok(
    commands.some((command) => command.includes("1. Which screen fails?")),
  );
  assert.ok(
    commands.some((command) =>
      command.includes("2. What exact steps reproduce it?"),
    ),
  );
  assert.ok(
    commands.some((command) =>
      command.includes(
        "comment 2 --repo /repo -- Automated triage marked this as easy.",
      ),
    ),
  );
});

test("applyDecisions applies generated needs-info comments with recommended answers", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  await applyDecisions(runner, "/repo", issues, [humanDecision]);

  const commands = runner.calls.map(
    (call) => `${call.command} ${call.args.join(" ")}`,
  );
  assert.ok(commands.some((command) => command.includes("issues edit 2")));
  assert.ok(
    commands.some((command) =>
      command.includes(
        "comment 2 --repo /repo -- Automated triage needs more information",
      ),
    ),
  );
  assert.ok(commands.some((command) => command.includes("Rationale:")));
  assert.ok(
    commands.some((command) =>
      command.includes("1. Which report columns are required?"),
    ),
  );
  assert.ok(
    commands.some((command) =>
      command.includes(
        "Recommended answer: Include the same columns visible in the dashboard first",
      ),
    ),
  );
});

test("applyDecisions wraps label failures with issue context and stops before comments or later issues", async () => {
  const runner = createStaticCommandRunner([
    { code: 1, stdout: "", stderr: "labels exploded" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  await assert.rejects(
    () => applyDecisions(runner, "/repo", issues, [needsInfo, easy]),
    (error) => {
      assert.ok(error instanceof ApplyDecisionError);
      assert.equal(error.issueNumber, 1);
      assert.equal(error.operation, "labels");
      assert.match(error.message, /issue #1/);
      assert.match(error.message, /labels/);
      assert.match(error.message, /labels exploded/);
      return true;
    },
  );

  assert.equal(runner.calls.length, 1);
  assert.deepEqual(runner.calls[0]?.args.slice(0, 3), ["issues", "edit", "1"]);
});

test("applyDecisions wraps comment failures after label edits", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 1, stdout: "", stderr: "comment exploded" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  await assert.rejects(
    () => applyDecisions(runner, "/repo", issues, [easy, needsInfo]),
    (error) => {
      assert.ok(error instanceof ApplyDecisionError);
      assert.equal(error.issueNumber, 2);
      assert.equal(error.operation, "comment");
      assert.match(error.message, /issue #2/);
      assert.match(error.message, /comment/);
      assert.match(error.message, /comment exploded/);
      return true;
    },
  );

  assert.equal(runner.calls.length, 2);
  assert.deepEqual(runner.calls[0]?.args.slice(0, 3), ["issues", "edit", "2"]);
  assert.deepEqual(runner.calls[1]?.args.slice(0, 2), ["comment", "2"]);
});
