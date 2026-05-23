import assert from "node:assert/strict";
import { test } from "node:test";
import { CROPRUN_COMPAT_POLICY, DEFAULT_PATCHMILL_POLICY } from "./defaults.ts";

test("CROPRUN_COMPAT_POLICY preserves the current Croprun prompt policy", () => {
  assert.equal(CROPRUN_COMPAT_POLICY.projectName, "Croprun");
  assert.deepEqual(CROPRUN_COMPAT_POLICY.contextFileNames, ["AGENTS.md"]);
  assert.equal(
    CROPRUN_COMPAT_POLICY.toolchainInstruction,
    "Use the devenv-managed project toolchain. If the shell is not already active, enter it with `devenv shell` or prefix one-off commands with `devenv shell <command>`.",
  );
  assert.deepEqual(CROPRUN_COMPAT_POLICY.validation.rules, [
    { category: "Server-side changes", commands: ["just test"] },
    { category: "Playwright/browser flows", commands: ["just playwright-test"] },
    { category: "Mobile unit changes", commands: ["just mobile-test"] },
    { category: "Android instrumentation/device behavior", commands: ["just mobile-instrumentation-test"] },
  ]);
  assert.deepEqual(CROPRUN_COMPAT_POLICY.validation.forbiddenSubstitutions, [
    "Do not run host `go test` as a substitute.",
    "Do not run host `playwright test` as a substitute.",
    "Do not use ad-hoc servers as a substitute.",
    "Do not run direct `kubectl exec` as a substitute.",
  ]);
  assert.equal(CROPRUN_COMPAT_POLICY.directLand.targetBranch, "main");
  assert.match(CROPRUN_COMPAT_POLICY.directLand.policyText, /Default to direct squash-landing on `<target-branch>`/);
  assert.match(CROPRUN_COMPAT_POLICY.directLand.policyText, /Simple bug fix means:/);
  assert.match(CROPRUN_COMPAT_POLICY.directLand.policyText, /Mechanical change means:/);
  assert.match(
    CROPRUN_COMPAT_POLICY.directLand.policyText,
    /Human-review-required exclusions — create a PR instead of landing directly if any are true:/,
  );
  assert.match(
    CROPRUN_COMPAT_POLICY.directLand.policyText,
    /Do not create a PR or post the issue handoff comment yourself; the runner will comment after it parses the final response/,
  );
  assert.match(CROPRUN_COMPAT_POLICY.directLand.policyText, /Update local `<target-branch>` from the `<remote>` remote/);
  assert.match(CROPRUN_COMPAT_POLICY.directLand.policyText, /"branch": "<implementation-branch>"/);
  assert.match(CROPRUN_COMPAT_POLICY.directLand.policyText, /Successful final response for human-review PR fallback:/);
  assert.equal(CROPRUN_COMPAT_POLICY.visualEvidence.webScreenshotSkill, "capturing-proof-screenshots");
  assert.equal(CROPRUN_COMPAT_POLICY.visualEvidence.mobileScreenshotSkill, "mobile-app-screenshots");
  assert.deepEqual(CROPRUN_COMPAT_POLICY.visualEvidence.referenceScreenshotPaths, [
    "docs/reference-screenshots/web/",
    "docs/reference-screenshots/mobile/",
  ]);
  assert.match(
    CROPRUN_COMPAT_POLICY.visualEvidence.policyText,
    /Do not upload visual evidence to Forgejo yourself; the orchestrator handles the upload after parsing your final JSON/,
  );
  assert.match(
    CROPRUN_COMPAT_POLICY.visualEvidence.policyText,
    /A worktree-local screenshot path alone is not sufficient PR evidence/,
  );
  assert.doesNotMatch(
    CROPRUN_COMPAT_POLICY.visualEvidence.policyText,
    /If visuals intentionally change, update the relevant committed reference screenshots/,
  );
  assert.doesNotMatch(
    CROPRUN_COMPAT_POLICY.visualEvidence.policyText,
    /Ask the fresh reviewer to compare after-change screenshots against the issue requirements, relevant reference screenshots, and existing Croprun styling/,
  );
  assert.doesNotMatch(
    CROPRUN_COMPAT_POLICY.visualEvidence.policyText,
    /The reviewer summary must state whether screenshot review passed when visual changes exist/,
  );
  assert.match(
    CROPRUN_COMPAT_POLICY.visualEvidence.reviewerExpectations?.join("\n") ?? "",
    /The reviewer summary must state whether screenshot review passed when visual changes exist/,
  );
  assert.equal(
    CROPRUN_COMPAT_POLICY.hostToolingInstruction,
    "Use Forgejo `tea` for repository-hosting actions. Do not use `gh`.",
  );
  assert.match(CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction, /Read existing todos tagged `agent-issue` and `issue-<n>`/);
  assert.match(CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction, /Create one todo for each actionable task in the implementation plan/);
  assert.match(CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction, /issue-<n>-task-<two-digit-number>-<slug>/);
  assert.match(CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction, /Each task todo body must include: purpose, the source plan checklist item, checkpoint details/);
  assert.match(CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction, /Do not create a single broad implementation todo/);
  assert.match(CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction, /Claim or update the current task todo before doing work on that task/);
  assert.match(
    CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction,
    /Mark a task todo complete only after code, tests, review, fixes, and verification for that task are done/,
  );
  assert.match(
    CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction,
    /Keep review tracking and final handoff tracking separate from implementation task todos/,
  );
  assert.match(CROPRUN_COMPAT_POLICY.pi.todoWorkflowInstruction, /Do not commit `\.pi\/todos`/);
  assert.match(CROPRUN_COMPAT_POLICY.pi.subagentWorkflowInstruction, /superpowers:subagent-driven-development/);
  assert.equal(CROPRUN_COMPAT_POLICY.planRequiresApproval, false);
});

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
  assert.equal(
    DEFAULT_PATCHMILL_POLICY.pi.todoWorkflowInstruction,
    "Use the Pi `todo` tool to track plan and implementation tasks. Do not commit `.pi/todos` or todo files.",
  );
  assert.equal(
    DEFAULT_PATCHMILL_POLICY.pi.subagentWorkflowInstruction,
    "Use the repository's documented Pi subagent workflow for implementation and review.",
  );
  assert.equal(DEFAULT_PATCHMILL_POLICY.planRequiresApproval, false);
  assert.doesNotMatch(
    JSON.stringify(DEFAULT_PATCHMILL_POLICY),
    /Croprun|devenv|Tilt|Just|Forgejo|tea|capturing-proof-screenshots|mobile-app-screenshots|reference-screenshots|kubectl exec/i,
  );
});
