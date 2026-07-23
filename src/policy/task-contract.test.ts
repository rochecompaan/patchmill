import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileIssueTodoTitlePattern,
  compilePlanTaskHeadingPattern,
  DEFAULT_PI_TASK_CONTRACT,
  issueTodoStatusDone,
  renderIssueTodoTags,
  renderIssueTodoTitleGlob,
  renderIssueTodoTitlePattern,
  todoTitlePatternIncludesIssueNumber,
} from "./task-contract.ts";

function plainGroups(
  groups: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return groups ? Object.fromEntries(Object.entries(groups)) : undefined;
}

test("DEFAULT_PI_TASK_CONTRACT preserves the current Pi task conventions", () => {
  assert.deepEqual(DEFAULT_PI_TASK_CONTRACT, {
    todoRoot: ".pi/todos",
    todoTitlePattern: "issue-<number>-task-<two-digit-number>-<slug>",
    todoTags: ["agent-issue", "issue-<number>"],
    planTodoBodyRequirements: [
      "purpose",
      "the source plan checklist item",
      "checkpoint details",
      "any last error or validation notes known at planning time",
    ],
    implementationTodoBodyRequirements: [
      "purpose",
      "the source plan checklist item",
      "checkpoint details",
      "the latest last error or validation notes",
    ],
    doneStatuses: ["closed", "completed", "complete", "done"],
    planTaskHeadingPattern: "## Task <number>: <label>",
    openTaskTodosBlockFinalHandoff: true,
  });
});

test("task contract helpers render and compile default issue todo patterns", () => {
  assert.equal(
    renderIssueTodoTitlePattern(DEFAULT_PI_TASK_CONTRACT, 42),
    "issue-42-task-<two-digit-number>-<slug>",
  );
  assert.deepEqual(renderIssueTodoTags(DEFAULT_PI_TASK_CONTRACT, 42), [
    "agent-issue",
    "issue-42",
  ]);
  assert.equal(
    todoTitlePatternIncludesIssueNumber(DEFAULT_PI_TASK_CONTRACT),
    true,
  );
  assert.equal(
    renderIssueTodoTitleGlob(DEFAULT_PI_TASK_CONTRACT, 42),
    "issue-42-task-*",
  );

  const pattern = compileIssueTodoTitlePattern(DEFAULT_PI_TASK_CONTRACT, 42);
  const match = "issue-42-task-07-dashboard-wiring".match(pattern);
  assert.deepEqual(match?.slice(1), ["07", "dashboard-wiring"]);
  assert.deepEqual(plainGroups(match?.groups), {
    taskNumber: "07",
    taskSlug: "dashboard-wiring",
  });
  assert.equal(
    issueTodoStatusDone(DEFAULT_PI_TASK_CONTRACT, "completed"),
    true,
  );
  assert.equal(issueTodoStatusDone(DEFAULT_PI_TASK_CONTRACT, "open"), false);
  assert.equal(
    issueTodoStatusDone(DEFAULT_PI_TASK_CONTRACT, " Complete "),
    true,
  );
  assert.equal(issueTodoStatusDone(DEFAULT_PI_TASK_CONTRACT, "DONE"), true);
});

test("task contract helpers compile default and custom plan heading patterns", () => {
  const defaultMatches = [
    ..."## Task 1: Date Range Model\n### Task 2: Dashboard Wiring".matchAll(
      compilePlanTaskHeadingPattern(DEFAULT_PI_TASK_CONTRACT),
    ),
  ].map((match) => match.slice(1));
  assert.deepEqual(defaultMatches, [
    ["1", "Date Range Model"],
    ["2", "Dashboard Wiring"],
  ]);
  const defaultGroups = [
    ..."## Task 1: Date Range Model\n### Task 2: Dashboard Wiring".matchAll(
      compilePlanTaskHeadingPattern(DEFAULT_PI_TASK_CONTRACT),
    ),
  ].map((match) => plainGroups(match.groups));
  assert.deepEqual(defaultGroups, [
    { taskNumber: "1", taskLabel: "Date Range Model" },
    { taskNumber: "2", taskLabel: "Dashboard Wiring" },
  ]);

  const defaultCompatibilityMatches = [
    ..."####   Task   3  :   Validation Sweep".matchAll(
      compilePlanTaskHeadingPattern(DEFAULT_PI_TASK_CONTRACT),
    ),
  ].map((match) => match.slice(1));
  assert.deepEqual(defaultCompatibilityMatches, [["3", "Validation Sweep"]]);

  const customContract = {
    ...DEFAULT_PI_TASK_CONTRACT,
    planTaskHeadingPattern: "### Step <number> - <label>",
  };
  const customMatches = [
    ..."### Step 2 - Dashboard Wiring\n#### Step 10 - Final Verification".matchAll(
      compilePlanTaskHeadingPattern(customContract),
    ),
  ].map((match) => match.slice(1));
  assert.deepEqual(customMatches, [
    ["2", "Dashboard Wiring"],
    ["10", "Final Verification"],
  ]);
  const customGroups = [
    ..."### Step 2 - Dashboard Wiring\n#### Step 10 - Final Verification".matchAll(
      compilePlanTaskHeadingPattern(customContract),
    ),
  ].map((match) => plainGroups(match.groups));
  assert.deepEqual(customGroups, [
    { taskNumber: "2", taskLabel: "Dashboard Wiring" },
    { taskNumber: "10", taskLabel: "Final Verification" },
  ]);
});

test("task contract helpers preserve named captures for reordered placeholders", () => {
  const todoPattern = compileIssueTodoTitlePattern(
    {
      ...DEFAULT_PI_TASK_CONTRACT,
      todoTitlePattern: "issue-<number>-<slug>-task-<two-digit-number>",
    },
    42,
  );
  assert.deepEqual(
    plainGroups("issue-42-dashboard-wiring-task-07".match(todoPattern)?.groups),
    {
      taskNumber: "07",
      taskSlug: "dashboard-wiring",
    },
  );

  const headingPattern = compilePlanTaskHeadingPattern({
    ...DEFAULT_PI_TASK_CONTRACT,
    planTaskHeadingPattern: "### <label> as step <number>",
  });
  const [headingMatch] = [
    ..."### Dashboard Wiring as step 2".matchAll(headingPattern),
  ];
  assert.deepEqual(plainGroups(headingMatch?.groups), {
    taskLabel: "Dashboard Wiring",
    taskNumber: "2",
  });
});

test("task contract helpers detect whether todo titles identify the issue number", () => {
  assert.equal(
    todoTitlePatternIncludesIssueNumber({
      ...DEFAULT_PI_TASK_CONTRACT,
      todoTitlePattern: "task-<two-digit-number>-<slug>",
    }),
    false,
  );
  assert.equal(
    todoTitlePatternIncludesIssueNumber({
      ...DEFAULT_PI_TASK_CONTRACT,
      todoTitlePattern: "work-<issue-number>-step-<two-digit-number>-<slug>",
    }),
    true,
  );
});
