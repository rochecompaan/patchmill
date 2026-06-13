import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { ApprovalRequiredError } from "./approval-gates.ts";
import {
  cleanupLabelsForImplementation,
  cleanupLabelsForPlanReview,
  cleanupLabelsForSpecReview,
  assertExplicitWorkflowState,
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
