import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import {
  ApprovalRequiredError,
  assertExplicitIssueApprovals,
  issueMeetsAutomaticApprovals,
} from "./approval-gates.ts";
import type { IssueSummary } from "./types.ts";

function approvalPolicy(overrides = {}) {
  return createWorkflowApprovalPolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.workflow,
      specApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
        required: true,
        ...overrides,
      },
    },
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
  );
}

function issue(labels: string[]): IssueSummary {
  return { number: 7, title: "Issue", body: "Body", labels, state: "open" };
}

test("issueMeetsAutomaticApprovals accepts missing spec approval when the gate is disabled", () => {
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
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
