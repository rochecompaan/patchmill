import test from "node:test";
import assert from "node:assert/strict";
import { selectIssue } from "./selection.ts";
import type { IssueSummary } from "./types.ts";

function issue(number: number, labels: string[], state = "open"): IssueSummary {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    labels,
    state,
  };
}

test("selectIssue chooses the highest-priority agent-ready issue", () => {
  const selected = selectIssue([
    issue(8, ["agent-ready", "priority:medium"]),
    issue(3, ["agent-ready", "priority:critical"]),
    issue(2, ["agent-ready", "priority:high"]),
    issue(1, ["agent-ready"]),
  ], { readyLabel: "agent-ready" });

  assert.equal(selected?.number, 3);
});

test("selectIssue breaks ties by lowest issue number within a priority bucket", () => {
  const selected = selectIssue([
    issue(12, ["agent-ready", "priority:high"]),
    issue(4, ["agent-ready", "priority:high"]),
    issue(9, ["agent-ready", "priority:high"]),
  ], { readyLabel: "agent-ready" });

  assert.equal(selected?.number, 4);
});

test("selectIssue treats multiple priority labels as the highest priority present", () => {
  const selected = selectIssue([
    issue(7, ["agent-ready", "priority:low", "priority:critical"]),
    issue(2, ["agent-ready", "priority:high"]),
  ], { readyLabel: "agent-ready" });

  assert.equal(selected?.number, 7);
});

test("selectIssue ignores issues with non-ready triage or protection labels", () => {
  const selected = selectIssue([
    issue(1, ["agent-ready", "priority:critical", "needs-info"]),
    issue(2, ["agent-ready", "priority:critical", "agent-unsuitable"]),
    issue(3, ["agent-ready", "priority:critical", "in-progress"]),
    issue(4, ["agent-ready", "priority:critical", "agent-done"]),
    issue(5, ["agent-ready", "priority:high"]),
  ], { readyLabel: "agent-ready" });

  assert.equal(selected?.number, 5);
});

test("selectIssue returns no issue when no open agent-ready issue exists", () => {
  const selected = selectIssue([
    issue(1, ["priority:critical"]),
    issue(2, ["agent-ready"], "closed"),
    issue(3, ["needs-info"]),
  ], { readyLabel: "agent-ready" });

  assert.equal(selected, undefined);
});

test("selectIssue accepts an explicit open agent-ready issue", () => {
  const selected = selectIssue([
    issue(5, ["agent-ready"]),
    issue(6, ["agent-ready", "priority:critical"]),
  ], { readyLabel: "agent-ready", issueNumber: 5 });

  assert.equal(selected?.number, 5);
});

test("selectIssue rejects an explicit open issue without agent-ready", () => {
  assert.throws(
    () => selectIssue([
      issue(5, ["priority:critical"]),
      issue(6, ["agent-ready", "priority:low"]),
    ], { readyLabel: "agent-ready", issueNumber: 5 }),
    /Issue #5 is open but not labeled agent-ready/,
  );
});

test("selectIssue rejects an explicit open issue that is in progress", () => {
  assert.throws(
    () => selectIssue([
      issue(7, ["agent-ready", "priority:critical", "in-progress"]),
      issue(8, ["agent-ready"]),
    ], { readyLabel: "agent-ready", issueNumber: 7 }),
    /Issue #7 is open but not eligible because it has in-progress/,
  );
});

test("selectIssue rejects an explicit open issue that is already done", () => {
  assert.throws(
    () => selectIssue([
      issue(9, ["agent-ready", "priority:critical", "agent-done"]),
      issue(10, ["agent-ready"]),
    ], { readyLabel: "agent-ready", issueNumber: 9 }),
    /Issue #9 is open but not eligible because it has agent-done/,
  );
});

test("selectIssue returns no issue when the explicit issue is not open", () => {
  const selected = selectIssue([
    issue(9, ["agent-ready"], "closed"),
    issue(10, ["agent-ready"]),
  ], { readyLabel: "agent-ready", issueNumber: 9 });

  assert.equal(selected, undefined);
});
