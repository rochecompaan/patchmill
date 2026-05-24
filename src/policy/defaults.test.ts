import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "./defaults.ts";
import { assertNoLegacyProjectText } from "../../test-support/legacy-project-text.ts";

test("DEFAULT_PATCHMILL_POLICY stays generic", () => {
  assert.equal(DEFAULT_PATCHMILL_POLICY.projectName, undefined);
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.contextFileNames, ["AGENTS.md"]);
  assert.equal(
    DEFAULT_PATCHMILL_POLICY.toolchainInstruction,
    "Use the repository's documented development toolchain.",
  );
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.validation.rules, []);
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.validation.forbiddenSubstitutions, []);
  assert.equal(DEFAULT_PATCHMILL_POLICY.directLand.targetBranch, "main");
  assert.equal(
    DEFAULT_PATCHMILL_POLICY.directLand.policyText,
    "Apply the repository's configured landing policy for the target branch.",
  );
  assert.equal(
    DEFAULT_PATCHMILL_POLICY.visualEvidence.policyText,
    "Capture the visual evidence required by the repository whenever visible UI changes.",
  );
  assert.deepEqual(DEFAULT_PATCHMILL_POLICY.visualEvidence.prEvidenceExample, {
    screenshotPath: ".tmp/issue-42-after.png",
    caption: "Visible UI state after the change",
  });
  assert.equal(
    DEFAULT_PATCHMILL_POLICY.hostToolingInstruction,
    "Use the repository's configured host tooling for issue and pull-request actions.",
  );
  assert.equal(DEFAULT_PATCHMILL_POLICY.pi.todoWorkflowInstruction, "");
  assert.equal(
    DEFAULT_PATCHMILL_POLICY.pi.subagentWorkflowInstruction,
    "Use the repository's documented Pi subagent workflow for implementation and review.",
  );
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
