import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import {
  ApprovalRequiredError,
  cleanupLabelsForImplementation,
  cleanupLabelsForPlanReview,
  cleanupLabelsForSpecReview,
  assertExplicitWorkflowState,
  decidePlanApprovalGate,
  resolveWorkflowState,
} from "./workflow-state.ts";

const ready = DEFAULT_PATCHMILL_CONFIG.labels.ready;
const policy = createWorkflowApprovalPolicy({
  specApproval: {
    required: true,
    reviewLabel: "spec-review",
    approvedLabel: "spec-approved",
  },
  planApproval: {
    required: true,
    reviewLabel: "plan-review",
    approvedLabel: "plan-approved",
  },
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

test("resolveWorkflowState treats agent-ready as actionable", () => {
  assert.deepEqual(
    resolveWorkflowState([ready], { readyLabel: ready, policy }),
    {
      kind: "agent-ready",
    },
  );
});

test("resolveWorkflowState treats spec-approved as actionable even with spec-review", () => {
  assert.deepEqual(
    resolveWorkflowState(["spec-review", "spec-approved"], {
      readyLabel: ready,
      policy,
    }),
    { kind: "spec-approved" },
  );
});

test("resolveWorkflowState treats plan-approved as stronger than other workflow labels", () => {
  assert.deepEqual(
    resolveWorkflowState(
      [ready, "spec-approved", "plan-review", "plan-approved"],
      {
        readyLabel: ready,
        policy,
      },
    ),
    { kind: "plan-approved" },
  );
});

test("resolveWorkflowState treats review-only labels as waiting", () => {
  assert.deepEqual(
    resolveWorkflowState(["spec-review"], { readyLabel: ready, policy }),
    { kind: "waiting-spec-review", missingLabel: "spec-approved" },
  );
  assert.deepEqual(
    resolveWorkflowState(["plan-review"], { readyLabel: ready, policy }),
    { kind: "waiting-plan-review", missingLabel: "plan-approved" },
  );
});

test("assertExplicitWorkflowState returns actionable state for explicit issues", () => {
  assert.deepEqual(
    assertExplicitWorkflowState(["plan-review", "plan-approved"], {
      readyLabel: ready,
      policy,
      issue: {
        number: 12,
        title: "Issue 12",
        body: "",
        labels: [],
        state: "open",
      },
    }),
    { kind: "plan-approved" },
  );
});

test("assertExplicitWorkflowState throws approval-required for waiting spec review", () => {
  assert.throws(
    () =>
      assertExplicitWorkflowState(["spec-review"], {
        readyLabel: ready,
        policy,
        issue: {
          number: 7,
          title: "Issue 7",
          body: "",
          labels: [],
          state: "open",
        },
      }),
    (error: unknown) => {
      assert(error instanceof ApprovalRequiredError);
      assert.equal(error.approvalKind, "spec");
      assert.equal(error.missingLabel, "spec-approved");
      return true;
    },
  );
});

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

test("cleanupLabelsForSpecReview removes agent-ready and stale later approvals", () => {
  assert.deepEqual(
    cleanupLabelsForSpecReview(
      [ready, "spec-approved", "plan-review", "plan-approved", "bug"],
      {
        readyLabel: ready,
        policy,
      },
    ),
    ["bug", "spec-review"],
  );
});

test("cleanupLabelsForPlanReview removes ready and all spec labels", () => {
  assert.deepEqual(
    cleanupLabelsForPlanReview(
      [ready, "spec-review", "spec-approved", "plan-approved", "bug"],
      {
        readyLabel: ready,
        policy,
      },
    ),
    ["bug", "plan-review"],
  );
});

test("cleanupLabelsForImplementation removes all workflow review and approval labels", () => {
  assert.deepEqual(
    cleanupLabelsForImplementation(
      [
        ready,
        "spec-review",
        "spec-approved",
        "plan-review",
        "plan-approved",
        "bug",
      ],
      { readyLabel: ready, policy },
    ),
    ["bug"],
  );
});
