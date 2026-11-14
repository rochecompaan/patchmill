import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardIssue,
  boardObservation,
  boardPull,
} from "../../test-support/board-fixture.ts";
import {
  projectBoardIssue,
  associatePullRequests,
} from "./board-projection.ts";
import type { WorkflowStatus } from "../kernel/workflow-state.ts";
import type { IssueSummary } from "./api-types.ts";

const prs = (branch: string) =>
  associatePullRequests({
    issue: 9,
    candidates: [boardPull(branch)],
    observed: null,
    pushRepository: "owner/repo",
    baseBranch: "main",
  }).pullRequests;
const input = (
  roles: WorkflowStatus[] = [],
  run = boardObservation(),
  pullRequests: IssueSummary["pullRequests"] = [],
) => ({ issue: boardIssue(), roles, run, pullRequests, documentLinks: [] });

test("each current workflow input selects its board column", () => {
  const cases = [
    [input(), "triage"],
    [input(["needsInfo"]), "triage"],
    [input(["ready"]), "ready"],
    [input(["inProgress"]), "planning"],
    [
      input([], boardObservation({ live: true, state: "deriving" })),
      "planning",
    ],
    [
      input([], boardObservation({ live: true, state: "planning" })),
      "planning",
    ],
    [input([], boardObservation(), prs("agent/issue-9--spec")), "review"],
    [input([], boardObservation(), prs("agent/issue-9--plan")), "review"],
    [
      input([], boardObservation({ live: true, state: "implementation" })),
      "implementing",
    ],
    [input(["done"]), "code"],
    [input([], boardObservation(), prs("agent/issue-9-title")), "code"],
    [input([], boardObservation({ state: "blocked", live: true })), "blocked"],
    [
      input([], boardObservation({ state: "ended", outcomeRole: "needsInfo" })),
      "blocked",
    ],
    [
      input([], boardObservation({ state: "ended", phase: "implementation" })),
      "triage",
    ],
  ] as const;
  for (const [value, want] of cases) {
    assert.equal(projectBoardIssue(value)?.column, want);
    assert.equal(projectBoardIssue({ ...value, roles: ["unsuitable"] }), null);
    assert.equal(
      projectBoardIssue({
        ...value,
        run: { ...value.run, outcomeRole: "needsInfo" },
      })?.column,
      "blocked",
    );
  }
});

test("furthest step wins adjacent conflicts and unsuitable excludes blocked live issues", () => {
  const cases = [
    [input(["needsInfo", "ready"]), "ready"],
    [input(["ready", "inProgress"]), "planning"],
    [
      input(["inProgress"], boardObservation(), prs("agent/issue-9--spec")),
      "review",
    ],
    [
      input(
        [],
        boardObservation({ live: true, state: "implementation" }),
        prs("agent/issue-9--plan"),
      ),
      "implementing",
    ],
    [
      input(
        ["done"],
        boardObservation({ live: true, state: "implementation" }),
      ),
      "code",
    ],
    [
      input(["done"], boardObservation({ state: "blocked", live: true })),
      "blocked",
    ],
  ] as const;
  for (const [value, want] of cases)
    assert.equal(projectBoardIssue(value)?.column, want);
  assert.equal(
    projectBoardIssue(
      input(
        ["done", "unsuitable"],
        boardObservation({ state: "blocked", live: true }),
      ),
    ),
    null,
  );
});

test("PR association rejects foreign heads, wrong bases, and neighboring issue numbers", () => {
  const valid = boardPull();
  const result = associatePullRequests({
    issue: 9,
    candidates: [
      valid,
      valid,
      boardPull("agent/issue-90-title", { number: 43 }),
      boardPull("agent/issue-9--plan", {
        number: 44,
        headRepository: "foreign/repo",
      }),
      boardPull("agent/issue-9-title", { number: 45, baseBranch: "release" }),
    ],
    observed: boardPull("agent/issue-9-title", { number: 46 }),
    pushRepository: "OWNER/repo",
    baseBranch: "main",
  });
  assert.deepEqual(
    result.pullRequests.map((p) => [p.number, p.kind]),
    [[42, "spec"]],
  );
  assert.deepEqual(result.branches, ["agent/issue-9--spec"]);
  const historical = associatePullRequests({
    issue: 9,
    candidates: [],
    observed: boardPull(undefined, { state: "merged" }),
    pushRepository: "owner/repo",
    baseBranch: "main",
  });
  assert.equal(
    projectBoardIssue(input([], boardObservation(), historical.pullRequests))
      ?.column,
    "triage",
  );
});

test("current Ready resets historical done and inProgress without live-phase or PR evidence", () => {
  for (const outcomeRole of ["done", "inProgress"] as const) {
    const summary = projectBoardIssue(
      input(
        ["ready"],
        boardObservation({ state: "ended", outcomeRole, stage: "plan" }),
      ),
    )!;
    assert.equal(summary.column, "ready");
    assert.equal(summary.status, "none");
    assert.equal(summary.phase, null);
  }
});

test("board JSON redacts private summaries and incomplete attempts explain their state", () => {
  const summary = projectBoardIssue(
    input(
      [],
      boardObservation({
        state: "ended",
        outcomeRole: "needsInfo",
        summary: "/private/run token-secret",
      }),
    ),
  )!;
  assert.equal(summary.blockedReason, "The run needs attention.");
  assert.doesNotMatch(JSON.stringify(summary), /private|token-secret/);
  assert.equal(
    projectBoardIssue(input([], boardObservation({ incomplete: true })))
      ?.blockedReason,
    "Run ended before recording a result.",
  );
});
