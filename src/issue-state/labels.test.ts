import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LABEL_CATALOG } from "../cli/commands/triage/labels.ts";
import type { LabelChangePlan } from "../issue/types.ts";
import {
  createLabelIssueStateProvider,
  workflowRolesFromLabels,
} from "./labels.ts";

const options = {
  triagePolicy: DEFAULT_LABEL_CATALOG.triagePolicy,
  approvalPolicy: DEFAULT_LABEL_CATALOG.workflowApprovalPolicy,
};

test("workflowRolesFromLabels maps labels without applying precedence", () => {
  assert.deepEqual(
    workflowRolesFromLabels(
      ["plan-approved", "spec-review", "agent-ready"],
      options,
    ),
    ["agent-ready", "spec-review", "plan-approved"],
  );
});

test("label issue-state provider preserves non-Patchmill labels", async () => {
  let applied: LabelChangePlan | undefined;
  const provider = createLabelIssueStateProvider(
    { applyLabels: async (change) => void (applied = change) },
    options,
  );

  await provider.setRoles({
    issue: {
      number: 10,
      title: "Example",
      body: "",
      labels: ["bug", "agent-ready"],
      state: "open",
    },
    roles: ["in-progress"],
  });

  assert.deepEqual(applied?.newLabels, ["bug", "in-progress"]);
  assert.deepEqual(applied?.removeLabels, ["agent-ready"]);
  assert.deepEqual(applied?.addLabels, ["in-progress"]);
});

test("label issue-state provider maps approval labels to roles", () => {
  assert.deepEqual(
    workflowRolesFromLabels(["spec-approved", "plan-approved"], options),
    ["spec-approved", "plan-approved"],
  );
});
