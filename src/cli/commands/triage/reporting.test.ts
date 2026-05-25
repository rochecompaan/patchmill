import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bucketCounts,
  createObservedChangeEntries,
  createPreviewEntries,
  extractNeedsInfoFollowUps,
} from "./reporting.ts";
import type { IssueSummary, TriagePreview } from "./types.ts";

const stateMap = {
  "ready-for-agent": "agent-ready",
  "needs-info": "needs-info",
  "ready-for-human": "agent-unsuitable",
  wontfix: "agent-unsuitable",
} as const;

function issue(
  number: number,
  labels: string[],
  comments: unknown[] = [],
  state = "open",
): IssueSummary {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    labels,
    state,
    comments,
  };
}

test("createPreviewEntries converts dry-run previews into log entries", () => {
  const previews: TriagePreview[] = [
    {
      issueNumber: 1,
      currentLabels: ["stale-model-label"],
      proposedLabels: ["ready-for-agent", "bug"],
      canonicalBucket: "agent-ready",
      rationale: "Clear enough.",
      wouldComment: "## Agent Brief\nImplement it.",
      wouldClose: false,
      questions: [],
    },
  ];

  assert.deepEqual(
    createPreviewEntries([issue(1, ["needs-triage", "bug"])], previews),
    [
      {
        issueNumber: 1,
        title: "Issue 1",
        previousLabels: ["needs-triage", "bug"],
        finalLabels: ["ready-for-agent", "bug"],
        primaryBucket: "agent-ready",
        rationale: "Clear enough.",
        questions: [],
        comment: "## Agent Brief\nImplement it.",
        wouldClose: false,
        mutationStatus: "preview",
      },
    ],
  );
});

test("createObservedChangeEntries reports labels, comments, state, and bucket", () => {
  const before = [
    issue(1, ["needs-triage", "bug"], [{ author: "bot", body: "old comment" }]),
  ];
  const after = [
    issue(
      1,
      ["ready-for-agent", "bug"],
      [
        { author: "bot", body: "old comment" },
        { author: "bot", body: "## Agent Brief\nImplement CSV export." },
      ],
      "open",
    ),
  ];

  assert.deepEqual(createObservedChangeEntries(before, after, stateMap), [
    {
      issueNumber: 1,
      title: "Issue 1",
      previousLabels: ["needs-triage", "bug"],
      finalLabels: ["ready-for-agent", "bug"],
      primaryBucket: "agent-ready",
      questions: [],
      comment: "## Agent Brief\nImplement CSV export.",
      addedComments: ["## Agent Brief\nImplement CSV export."],
      previousState: "open",
      finalState: "open",
      mutationStatus: "observed",
    },
  ]);
});

test("createObservedChangeEntries throws when an after snapshot is missing", () => {
  assert.throws(
    () =>
      createObservedChangeEntries(
        [issue(1, ["needs-triage"])],
        [issue(2, ["ready-for-agent"])],
        stateMap,
      ),
    /Missing after snapshot for issue #1/,
  );
});

test("extractNeedsInfoFollowUps returns question-like lines", () => {
  assert.deepEqual(
    extractNeedsInfoFollowUps(
      "## Triage Notes\n\n- What browser fails?\n- Please share logs\nPlain sentence",
    ),
    ["What browser fails?", "Please share logs"],
  );
});

test("extractNeedsInfoFollowUps strips ordered markdown list markers", () => {
  assert.deepEqual(
    extractNeedsInfoFollowUps(
      "## Need more info\n\n1. What browser fails?\n2) Please share logs\n3. Attach a screenshot\nPlain sentence",
    ),
    ["What browser fails?", "Please share logs", "Attach a screenshot"],
  );
});

test("extractNeedsInfoFollowUps falls back to full comment", () => {
  assert.deepEqual(extractNeedsInfoFollowUps("Need reporter details."), [
    "Need reporter details.",
  ]);
});

test("bucketCounts counts canonical buckets from log entries", () => {
  assert.deepEqual(
    bucketCounts([
      {
        issueNumber: 1,
        title: "One",
        previousLabels: [],
        finalLabels: ["ready-for-agent"],
        primaryBucket: "agent-ready",
        questions: [],
        comment: null,
        mutationStatus: "observed",
      },
      {
        issueNumber: 2,
        title: "Two",
        previousLabels: [],
        finalLabels: ["needs-info"],
        primaryBucket: "needs-info",
        questions: ["What fails?"],
        comment: "What fails?",
        mutationStatus: "observed",
      },
    ]),
    {
      "agent-ready": 1,
      "needs-info": 1,
      "agent-unsuitable": 0,
    },
  );
});
