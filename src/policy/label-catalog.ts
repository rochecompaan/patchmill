import type { PatchmillConfig } from "../config/types.ts";
import type { LabelDefinition } from "../host/types.ts";
import {
  createWorkflowApprovalPolicy,
  type WorkflowApprovalPolicy,
} from "../workflow/approval-policy.ts";
import { createTriagePolicy, type PatchmillTriagePolicy } from "./triage.ts";

export type PatchmillLabelCatalog = {
  triagePolicy: PatchmillTriagePolicy;
  workflowApprovalPolicy: WorkflowApprovalPolicy;
  labelDefinitions: LabelDefinition[];
};

function dedupeLabelDefinitions(labels: LabelDefinition[]): LabelDefinition[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

export function createPatchmillLabelCatalog(
  config: PatchmillConfig,
): PatchmillLabelCatalog {
  const triagePolicy = createTriagePolicy(config.labels, config.triage);
  const workflowApprovalPolicy = createWorkflowApprovalPolicy(config.workflow);

  return {
    triagePolicy,
    workflowApprovalPolicy,
    labelDefinitions: dedupeLabelDefinitions([
      ...triagePolicy.allowedLabels,
      ...workflowApprovalPolicy.labelDefinitions,
    ]),
  };
}
