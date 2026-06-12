import type { PatchmillWorkflowConfig } from "../config/types.ts";
import type { LabelDefinition } from "../host/types.ts";

export type WorkflowApprovalKind = "spec" | "plan";

export type WorkflowApprovalStagePolicy = {
  kind: WorkflowApprovalKind;
  required: boolean;
  reviewLabel: string;
  approvedLabel: string;
};

export type WorkflowApprovalPolicy = {
  specApproval: WorkflowApprovalStagePolicy;
  planApproval: WorkflowApprovalStagePolicy;
  labelDefinitions: LabelDefinition[];
};

function workflowLabelDefinition(
  name: string,
  color: string,
  description: string,
): LabelDefinition {
  return { name, color, description };
}

function dedupeLabelDefinitions(labels: LabelDefinition[]): LabelDefinition[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

export function createWorkflowApprovalPolicy(
  workflow: PatchmillWorkflowConfig,
): WorkflowApprovalPolicy {
  const specApproval: WorkflowApprovalStagePolicy = {
    kind: "spec",
    required: workflow.specApproval.required,
    reviewLabel: workflow.specApproval.reviewLabel,
    approvedLabel: workflow.specApproval.approvedLabel,
  };
  const planApproval: WorkflowApprovalStagePolicy = {
    kind: "plan",
    required: workflow.planApproval.required,
    reviewLabel: workflow.planApproval.reviewLabel,
    approvedLabel: workflow.planApproval.approvedLabel,
  };

  return {
    specApproval,
    planApproval,
    labelDefinitions: dedupeLabelDefinitions([
      workflowLabelDefinition(
        specApproval.reviewLabel,
        "#5319e7",
        "Awaiting specification review",
      ),
      workflowLabelDefinition(
        specApproval.approvedLabel,
        "#0e8a16",
        "Specification approved for automation",
      ),
      workflowLabelDefinition(
        planApproval.reviewLabel,
        "#5319e7",
        "Awaiting implementation plan review",
      ),
      workflowLabelDefinition(
        planApproval.approvedLabel,
        "#0e8a16",
        "Implementation plan approved for automation",
      ),
    ]),
  };
}
