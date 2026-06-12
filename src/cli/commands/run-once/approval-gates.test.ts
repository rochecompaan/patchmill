import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import {
  ApprovalRequiredError,
  approvedWorkflowReviewLabelsToRemove,
  assertExplicitIssueApprovals,
  decidePlanApprovalGate,
  issueMeetsAutomaticApprovals,
} from "./approval-gates.ts";
import type { IssueSummary } from "./types.ts";

function approvalPolicy(overrides = {}) {
  return createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
      ...overrides,
    },
  });
}

function issue(labels: string[]): IssueSummary {
  return { number: 7, title: "Issue", body: "Body", labels, state: "open" };
}

test("issueMeetsAutomaticApprovals accepts missing spec approval when the gate is disabled", () => {
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
  );

  assert.equal(
    issueMeetsAutomaticApprovals(issue(["agent-ready"]), policy),
    true,
  );
});

test("issueMeetsAutomaticApprovals filters missing spec approval when required", () => {
  const policy = approvalPolicy();

  assert.equal(
    issueMeetsAutomaticApprovals(issue(["agent-ready"]), policy),
    false,
  );
  assert.equal(
    issueMeetsAutomaticApprovals(
      issue(["agent-ready", "spec-approved"]),
      policy,
    ),
    true,
  );
});

test("assertExplicitIssueApprovals throws a typed missing-spec approval error", () => {
  const policy = approvalPolicy({ approvedLabel: "spec-ok" });

  assert.throws(
    () => assertExplicitIssueApprovals(issue(["agent-ready"]), policy),
    (error: unknown) => {
      assert(error instanceof ApprovalRequiredError);
      assert.equal(error.approvalKind, "spec");
      assert.equal(error.missingLabel, "spec-ok");
      assert.equal(error.issue.number, 7);
      return true;
    },
  );
});

function planApprovalPolicy(
  required: boolean,
  approvedLabel = "plan-approved",
) {
  return createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required,
      approvedLabel,
    },
  });
}

test("decidePlanApprovalGate proceeds when plan approval is disabled", () => {
  const decision = decidePlanApprovalGate({
    labels: ["agent-ready"],
    planOnly: false,
    policy: planApprovalPolicy(false),
  });

  assert.deepEqual(decision, { action: "proceed" });
});

test("decidePlanApprovalGate stops for review when plan approval is required and missing", () => {
  const decision = decidePlanApprovalGate({
    labels: ["in-progress"],
    planOnly: false,
    policy: planApprovalPolicy(true),
  });

  assert.deepEqual(decision, {
    action: "stop-for-plan-review",
    reviewLabel: "plan-review",
    missingLabel: "plan-approved",
  });
});

test("decidePlanApprovalGate proceeds when the approved plan label is present", () => {
  const decision = decidePlanApprovalGate({
    labels: ["in-progress", "plan-approved"],
    planOnly: false,
    policy: planApprovalPolicy(true),
  });

  assert.deepEqual(decision, { action: "proceed" });
});

test("decidePlanApprovalGate ignores stale approval on a newly-created plan", () => {
  const decision = decidePlanApprovalGate({
    labels: ["in-progress", "plan-approved"],
    planOnly: false,
    planCreatedThisRun: true,
    policy: planApprovalPolicy(true),
  });

  assert.deepEqual(decision, {
    action: "stop-for-plan-review",
    reviewLabel: "plan-review",
    missingLabel: "plan-approved",
    staleApprovedLabel: "plan-approved",
  });
});

test("decidePlanApprovalGate stops for plan-only without workflow review labels", () => {
  const decision = decidePlanApprovalGate({
    labels: ["in-progress"],
    planOnly: true,
    policy: planApprovalPolicy(false),
  });

  assert.deepEqual(decision, { action: "stop-for-plan-only" });
});

test("approvedWorkflowReviewLabelsToRemove clears active plan review after approval", () => {
  const labels = approvedWorkflowReviewLabelsToRemove(
    ["agent-ready", "plan-review", "plan-approved"],
    planApprovalPolicy(true),
  );

  assert.deepEqual(labels, ["plan-review"]);
});
