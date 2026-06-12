import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../config/defaults.ts";
import { createTriagePolicy } from "../policy/triage.ts";
import { createWorkflowApprovalPolicy } from "./approval-policy.ts";

const projectPolicy = DEFAULT_PATCHMILL_CONFIG.projectPolicy;

test("createWorkflowApprovalPolicy defaults both gates to not required", () => {
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    { ...projectPolicy, planRequiresApproval: false },
  );

  assert.equal(policy.specApproval.required, false);
  assert.equal(policy.specApproval.reviewLabel, "spec-review");
  assert.equal(policy.specApproval.approvedLabel, "spec-approved");
  assert.equal(policy.planApproval.required, false);
  assert.equal(policy.planApproval.reviewLabel, "plan-review");
  assert.equal(policy.planApproval.approvedLabel, "plan-approved");
});

test("createWorkflowApprovalPolicy treats projectPolicy.planRequiresApproval as plan alias", () => {
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    { ...projectPolicy, planRequiresApproval: true },
  );

  assert.equal(policy.planApproval.required, true);
});

test("createWorkflowApprovalPolicy lets workflow.planApproval.required override the alias", () => {
  const policy = createWorkflowApprovalPolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.workflow,
      planApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
        required: false,
      },
    },
    { ...projectPolicy, planRequiresApproval: true },
  );

  assert.equal(policy.planApproval.required, false);
});

test("createWorkflowApprovalPolicy exposes workflow label definitions outside triage labels", () => {
  const triagePolicy = createTriagePolicy(
    DEFAULT_PATCHMILL_CONFIG.labels,
    DEFAULT_PATCHMILL_CONFIG.triage,
  );
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    projectPolicy,
  );

  assert.deepEqual(
    policy.labelDefinitions.map((label) => label.name),
    ["spec-review", "spec-approved", "plan-review", "plan-approved"],
  );
  assert.equal(
    triagePolicy.allowedLabels.some((label) => label.name === "spec-review"),
    false,
  );
});
