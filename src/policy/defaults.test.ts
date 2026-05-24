import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "./defaults.ts";
import { assertNoLegacyProjectText } from "../../test-support/legacy-project-text.ts";

test("DEFAULT_PATCHMILL_POLICY stays generic", () => {
  assert.equal(DEFAULT_PATCHMILL_POLICY.projectName, undefined);
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.contextFileNames, ["AGENTS.md"]);
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.validation.rules, []);
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.validation.forbiddenSubstitutions, []);
  assert.equal(DEFAULT_PATCHMILL_POLICY.directLand.targetBranch, "main");
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.visualEvidence.prEvidenceExample, {
    screenshotPath: ".tmp/issue-42-after.png",
    caption: "Visible UI state after the change",
  });
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.pi.taskContract, {
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
    doneStatuses: ["closed", "completed", "done"],
    planTaskHeadingPattern: "## Task <number>: <label>",
    openTaskTodosBlockFinalHandoff: true,
  });
  assert.equal(DEFAULT_PATCHMILL_POLICY.planRequiresApproval, false);
});

test("DEFAULT_PATCHMILL_POLICY contains only generic policy text", () => {
  const text = JSON.stringify(DEFAULT_PATCHMILL_POLICY);
  assertNoLegacyProjectText(text);
});
