import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../config/defaults.ts";
import { createPatchmillLabelCatalog } from "./label-catalog.ts";

test("createPatchmillLabelCatalog returns every Patchmill-owned label definition", () => {
  const catalog = createPatchmillLabelCatalog({
    ...DEFAULT_PATCHMILL_CONFIG,
    labels: {
      ...DEFAULT_PATCHMILL_CONFIG.labels,
      ready: "ready-for-agent",
      types: ["defect"],
      priorities: ["priority:urgent"],
    },
    workflow: {
      specApproval: {
        required: true,
        reviewLabel: "awaiting-spec-review",
        approvedLabel: "spec-reviewed",
      },
      planApproval: {
        required: true,
        reviewLabel: "awaiting-plan-review",
        approvedLabel: "plan-reviewed",
      },
    },
  });

  assert.deepEqual(
    catalog.labelDefinitions.map((label) => label.name),
    [
      "ready-for-agent",
      "needs-info",
      "agent-unsuitable",
      "in-progress",
      "agent-done",
      "blocked",
      "defect",
      "priority:urgent",
      "awaiting-spec-review",
      "spec-reviewed",
      "awaiting-plan-review",
      "plan-reviewed",
    ],
  );
  assert.equal(catalog.triagePolicy.labels.ready, "ready-for-agent");
  assert.equal(catalog.workflowApprovalPolicy.planApproval.required, true);
});
