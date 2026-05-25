import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { validateTriageDocument } from "./validation.ts";
import type { IssueSummary, RawTriageDocument } from "./types.ts";

const issues: IssueSummary[] = [
  {
    number: 1,
    title: "Easy bug",
    body: "Steps and expected behavior",
    labels: ["bug"],
    state: "open",
  },
  {
    number: 2,
    title: "Ambiguous feature",
    body: "Make reports better",
    labels: ["enhancement"],
    state: "open",
  },
];

function doc(decision: Record<string, unknown>): RawTriageDocument {
  return { decisions: [decision] };
}

test("validateTriageDocument accepts an agent-ready issue", () => {
  const decisions = validateTriageDocument(
    doc({
      issueNumber: 1,
      primaryBucket: "agent-ready",
      labels: ["bug", "agent-ready", "priority:medium"],
      confidence: "high",
      rationale: "Clear localized bug with full reproduction details.",
      questions: [],
      comment: null,
    }),
    [issues[0]],
  );

  assert.equal(decisions[0].primaryBucket, "agent-ready");
});

test("validateTriageDocument rejects agent-ready on needs-info", () => {
  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 1,
          primaryBucket: "needs-info",
          labels: ["bug", "needs-info", "agent-ready"],
          confidence: "medium",
          rationale: "Missing exact screen.",
          questions: ["Which screen shows the failure?"],
          comment: null,
        }),
        [issues[0]],
      ),
    /agent-ready is only allowed for the agent-ready bucket/,
  );
});

test("validateTriageDocument requires questions for needs-info", () => {
  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 1,
          primaryBucket: "needs-info",
          labels: ["bug", "needs-info"],
          confidence: "medium",
          rationale: "Missing reproduction steps.",
          questions: [],
          comment: null,
        }),
        [issues[0]],
      ),
    /needs-info requires at least one question/,
  );
});

test("validateTriageDocument accepts recommended answers for needs-info decision questions", () => {
  const decisions = validateTriageDocument(
    doc({
      issueNumber: 2,
      primaryBucket: "needs-info",
      labels: ["enhancement", "needs-info", "priority:medium"],
      confidence: "high",
      rationale: "Feature behavior is ambiguous and needs product direction.",
      questions: [
        {
          question: "What report behavior should be implemented?",
          recommendedAnswer:
            "Start with CSV export matching the visible dashboard columns.",
        },
      ],
      comment: null,
    }),
    [issues[1]],
  );

  assert.deepEqual(decisions[0].questions, [
    {
      question: "What report behavior should be implemented?",
      recommendedAnswer:
        "Start with CSV export matching the visible dashboard columns.",
    },
  ]);
});

test("validateTriageDocument accepts configured bucket labels while keeping default statuses", () => {
  const decisions = validateTriageDocument(
    doc({
      issueNumber: 1,
      primaryBucket: "agent-ready",
      labels: ["bug", "ready-for-bots", "priority:medium"],
      confidence: "high",
      rationale: "Clear work.",
      questions: [],
      comment: null,
    }),
    [issues[0]],
    createTriagePolicy({
      ...DEFAULT_PATCHMILL_CONFIG.labels,
      ready: "ready-for-bots",
      needsInfo: "needs-clarification",
      unsuitable: "manual-only",
    }),
  );

  assert.deepEqual(decisions[0], {
    issueNumber: 1,
    primaryBucket: "agent-ready",
    labels: ["bug", "ready-for-bots", "priority:medium"],
    confidence: "high",
    rationale: "Clear work.",
    questions: [],
    comment: null,
  });
});

test("validateTriageDocument rejects unknown labels", () => {
  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 1,
          primaryBucket: "agent-ready",
          labels: ["agent-ready", "custom-label"],
          confidence: "high",
          rationale: "Clear work.",
          questions: [],
          comment: null,
        }),
        [issues[0]],
      ),
    /Unknown label custom-label/,
  );
});

test("validateTriageDocument rejects the default status name when a custom ready label is configured", () => {
  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 1,
          primaryBucket: "agent-ready",
          labels: ["bug", "agent-ready", "priority:medium"],
          confidence: "high",
          rationale: "Clear work.",
          questions: [],
          comment: null,
        }),
        [issues[0]],
        createTriagePolicy({
          ...DEFAULT_PATCHMILL_CONFIG.labels,
          ready: "ready-for-bots",
        }),
      ),
    /Unknown label agent-ready/,
  );
});

test("validateTriageDocument rejects in-progress in triage output", () => {
  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 1,
          primaryBucket: "agent-ready",
          labels: ["bug", "agent-ready", "in-progress"],
          confidence: "high",
          rationale: "Clear work.",
          questions: [],
          comment: null,
        }),
        [issues[0]],
      ),
    /in-progress.*not allowed in triage decisions|Unknown label in-progress/,
  );
});

test("validateTriageDocument rejects removed area, risk, and size labels", () => {
  for (const removedLabel of ["area:mobile", "risk:low", "size:small"]) {
    assert.throws(
      () =>
        validateTriageDocument(
          doc({
            issueNumber: 1,
            primaryBucket: "agent-ready",
            labels: ["bug", "agent-ready", removedLabel],
            confidence: "high",
            rationale: "Clear work.",
            questions: [],
            comment: null,
          }),
          [issues[0]],
        ),
      new RegExp(`Unknown label ${removedLabel}`),
    );
  }
});

test("validateTriageDocument rejects removed triage labels", () => {
  for (const removedLabel of [
    "agent-easy",
    "agent-mechanical",
    "agent-needs-human-decision",
    "agent-needs-info",
    "agent-needs-plan",
    "needs-plan",
  ]) {
    assert.throws(
      () =>
        validateTriageDocument(
          doc({
            issueNumber: 1,
            primaryBucket: "agent-ready",
            labels: ["bug", "agent-ready", removedLabel],
            confidence: "high",
            rationale: "Clear work.",
            questions: [],
            comment: null,
          }),
          [issues[0]],
        ),
      new RegExp(`Unknown label ${removedLabel}`),
    );
  }
});

test("validateTriageDocument routes ambiguity to needs-info", () => {
  const decisions = validateTriageDocument(
    doc({
      issueNumber: 2,
      primaryBucket: "needs-info",
      labels: ["enhancement", "needs-info", "priority:medium"],
      confidence: "high",
      rationale: "Feature behavior is ambiguous and needs product direction.",
      questions: [
        {
          question: "What report behavior should be implemented?",
          recommendedAnswer:
            "Start with CSV export matching the visible dashboard columns.",
        },
      ],
      comment: null,
    }),
    [issues[1]],
  );

  assert.deepEqual(decisions[0].questions, [
    {
      question: "What report behavior should be implemented?",
      recommendedAnswer:
        "Start with CSV export matching the visible dashboard columns.",
    },
  ]);
});

test("validateTriageDocument rejects removed primary buckets", () => {
  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 2,
          primaryBucket: "agent-needs-human-decision",
          labels: [
            "enhancement",
            "agent-needs-human-decision",
            "priority:medium",
          ],
          confidence: "high",
          rationale:
            "Feature behavior is ambiguous and needs product direction.",
          questions: [],
          comment: null,
        }),
        [issues[1]],
      ),
    /Invalid primaryBucket agent-needs-human-decision/,
  );

  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 2,
          primaryBucket: "needs-plan",
          labels: ["enhancement", "needs-plan", "priority:medium"],
          confidence: "high",
          rationale: "Clear work that will still go through normal planning.",
          questions: [],
          comment: null,
        }),
        [issues[1]],
      ),
    /Invalid primaryBucket needs-plan/,
  );
});

test("validateTriageDocument accepts plain string needs-info questions", () => {
  const decisions = validateTriageDocument(
    doc({
      issueNumber: 2,
      primaryBucket: "needs-info",
      labels: ["enhancement", "needs-info", "priority:medium"],
      confidence: "high",
      rationale: "Feature behavior is ambiguous and needs product direction.",
      questions: ["What report behavior should be implemented?"],
      comment: null,
    }),
    [issues[1]],
  );

  assert.deepEqual(decisions[0].questions, [
    "What report behavior should be implemented?",
  ]);
});

test("validateTriageDocument rejects needs-info question objects without recommended answers", () => {
  assert.throws(
    () =>
      validateTriageDocument(
        doc({
          issueNumber: 2,
          primaryBucket: "needs-info",
          labels: ["enhancement", "needs-info", "priority:medium"],
          confidence: "high",
          rationale:
            "Feature behavior is ambiguous and needs product direction.",
          questions: [
            {
              question: "What report behavior should be implemented?",
              recommendedAnswer: "",
            },
          ],
          comment: null,
        }),
        [issues[1]],
      ),
    /recommendedAnswer must be a non-empty string/,
  );
});

test("validateTriageDocument requires one decision per selected issue", () => {
  assert.throws(
    () => validateTriageDocument({ decisions: [] }, issues),
    /Expected 2 decisions but received 0/,
  );
});
