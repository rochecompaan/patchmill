import test from "node:test";
import assert from "node:assert/strict";
import {
  blockerComment,
  handoffComment,
  questionText,
  rejectionMessage,
  startedComment,
  unexpectedFailureComment,
  unexpectedFailureCommentKey,
} from "./pipeline-comments.ts";
import { issue } from "../../../../test-support/run-once/issue-fixtures.ts";

test("startedComment includes issue number", () => {
  assert.match(startedComment(issue(7, [])), /issue #7/);
});

test("handoffComment includes pr details and validation", () => {
  assert.match(
    handoffComment(
      "docs/plans/p.md",
      {
        status: "pr-created",
        prUrl: "https://example/pr/1",
        branch: "b",
        commits: [],
        validation: ["npm test"],
      },
      "main",
    ),
    /PR: https:\/\/example\/pr\/1/,
  );
});

test("blocker comments render questions", () => {
  assert.equal(
    questionText({ question: "Need input?", recommendedAnswer: "Yes" }),
    "- Need input?\n  Recommended: Yes",
  );
  assert.match(
    blockerComment({
      status: "blocked",
      reason: "blocked",
      questions: ["What next?"],
      commits: [],
      validation: [],
    }),
    /Questions:/,
  );
});

test("selection rejection and unexpected failure text is deterministic", () => {
  assert.equal(rejectionMessage("blocking-labels"), "blocking labels");
  assert.equal(
    unexpectedFailureCommentKey("planning"),
    "unexpected-failure:planning",
  );
  assert.match(unexpectedFailureComment("boom", "in-progress"), /boom/);
});
