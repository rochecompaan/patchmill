import type { PatchmillConfig } from "./types.ts";
import {
  configError,
  hasEntries,
  readOptionalBoolean,
  readOptionalSection,
  readOptionalString,
} from "./parse-helpers.ts";

const WORKFLOW_APPROVAL_KEYS = ["specApproval", "planApproval"] as const;
const WORKFLOW_APPROVAL_LABEL_KEYS = ["reviewLabel", "approvedLabel"] as const;

type WorkflowApprovalKey = (typeof WORKFLOW_APPROVAL_KEYS)[number];
type WorkflowApprovalLabelKey = (typeof WORKFLOW_APPROVAL_LABEL_KEYS)[number];

type WorkflowApprovalConfig = PatchmillConfig["workflow"][WorkflowApprovalKey];

export type PartialWorkflowApprovalConfig = Partial<WorkflowApprovalConfig>;

export type PartialWorkflowConfig = Partial<{
  specApproval: PartialWorkflowApprovalConfig;
  planApproval: PartialWorkflowApprovalConfig;
}>;

function workflowLabelEntries(workflow: PatchmillConfig["workflow"]): Array<{
  path: `workflow.${WorkflowApprovalKey}.${WorkflowApprovalLabelKey}`;
  value: string;
}> {
  return WORKFLOW_APPROVAL_KEYS.flatMap((approvalKey) =>
    WORKFLOW_APPROVAL_LABEL_KEYS.map((labelKey) => ({
      path: `workflow.${approvalKey}.${labelKey}` as const,
      value: workflow[approvalKey][labelKey],
    })),
  );
}

function labelOwners(labels: PatchmillConfig["labels"]): Map<string, string> {
  const owners = new Map<string, string>();
  const add = (label: string, owner: string) => {
    if (!owners.has(label)) owners.set(label, owner);
  };

  add(labels.ready, "labels.ready");
  add(labels.needsInfo, "labels.needsInfo");
  add(labels.unsuitable, "labels.unsuitable");
  add(labels.inProgress, 'labels["in-progress"]');
  add(labels.done, "labels.done");
  add(labels.blocked, "labels.blocked");
  labels.types.forEach((label, index) => add(label, `labels.types[${index}]`));
  labels.priorities.forEach((label, index) =>
    add(label, `labels.priorities[${index}]`),
  );

  return owners;
}

function assertDistinctWorkflowApprovalLabels(
  workflow: PatchmillConfig["workflow"],
): void {
  const seen = new Map<string, string>();
  for (const entry of workflowLabelEntries(workflow)) {
    const existingPath = seen.get(entry.value);
    if (existingPath) {
      throw new Error(
        `Invalid patchmill.config.json: ${entry.path} must differ from ${existingPath}`,
      );
    }
    seen.set(entry.value, entry.path);
  }
}

function assertWorkflowApprovalLabelsDoNotReuseOwnedLabels(
  workflow: PatchmillConfig["workflow"],
  labels: PatchmillConfig["labels"],
): void {
  const owners = labelOwners(labels);
  for (const entry of workflowLabelEntries(workflow)) {
    const owner = owners.get(entry.value);
    if (!owner) continue;
    throw new Error(
      `Invalid patchmill.config.json: ${entry.path} must not reuse ${owner}`,
    );
  }
}

export function validateWorkflowConfig(
  workflow: PatchmillConfig["workflow"],
  labels: PatchmillConfig["labels"],
): PatchmillConfig["workflow"] {
  assertDistinctWorkflowApprovalLabels(workflow);
  assertWorkflowApprovalLabelsDoNotReuseOwnedLabels(workflow, labels);
  return workflow;
}

function cloneWorkflowApprovalConfig(
  approval: WorkflowApprovalConfig,
): WorkflowApprovalConfig {
  return {
    required: approval.required,
    reviewLabel: approval.reviewLabel,
    approvedLabel: approval.approvedLabel,
  };
}

function mergeWorkflowApprovalConfig(
  base: WorkflowApprovalConfig,
  update: PartialWorkflowApprovalConfig | undefined,
  requiredAlias?: boolean,
): WorkflowApprovalConfig {
  return {
    required: update?.required ?? requiredAlias ?? base.required,
    reviewLabel: update?.reviewLabel ?? base.reviewLabel,
    approvedLabel: update?.approvedLabel ?? base.approvedLabel,
  };
}

export function cloneWorkflowConfig(
  workflow: PatchmillConfig["workflow"],
): PatchmillConfig["workflow"] {
  return {
    specApproval: cloneWorkflowApprovalConfig(workflow.specApproval),
    planApproval: cloneWorkflowApprovalConfig(workflow.planApproval),
  };
}

export function mergeWorkflowConfig(
  base: PatchmillConfig["workflow"],
  update: PartialWorkflowConfig | undefined,
  options: {
    labels: PatchmillConfig["labels"];
    planRequiresApprovalAlias?: boolean;
  },
): PatchmillConfig["workflow"] {
  const workflow = {
    specApproval: mergeWorkflowApprovalConfig(
      base.specApproval,
      update?.specApproval,
    ),
    planApproval: mergeWorkflowApprovalConfig(
      base.planApproval,
      update?.planApproval,
      update?.planApproval?.required === undefined
        ? options.planRequiresApprovalAlias
        : undefined,
    ),
  };

  return validateWorkflowConfig(workflow, options.labels);
}

function readWorkflowApprovalConfig(
  source: Record<string, unknown>,
  key: WorkflowApprovalKey,
): PartialWorkflowApprovalConfig | undefined {
  const value = readOptionalSection(source, key);
  if (!value) return undefined;

  const parsed: PartialWorkflowApprovalConfig = {};
  const required = readOptionalBoolean(
    value,
    "required",
    `workflow.${key}.required`,
  );
  const reviewLabel = readOptionalString(
    value,
    "reviewLabel",
    `workflow.${key}.reviewLabel`,
  );
  const approvedLabel = readOptionalString(
    value,
    "approvedLabel",
    `workflow.${key}.approvedLabel`,
  );

  if (required !== undefined) parsed.required = required;
  if (reviewLabel !== undefined) parsed.reviewLabel = reviewLabel;
  if (approvedLabel !== undefined) parsed.approvedLabel = approvedLabel;

  for (const entry of Object.keys(value)) {
    if (!["required", "reviewLabel", "approvedLabel"].includes(entry)) {
      throw configError(
        `workflow.${key}.${entry}`,
        "a supported workflow approval setting",
        value[entry],
      );
    }
  }

  return hasEntries(parsed) ? parsed : undefined;
}

export function readWorkflowConfig(
  source: Record<string, unknown>,
): PartialWorkflowConfig | undefined {
  const value = source.workflow;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw configError("workflow", "an object", value);
  }

  const parsed: PartialWorkflowConfig = {};
  const specApproval = readWorkflowApprovalConfig(value, "specApproval");
  const planApproval = readWorkflowApprovalConfig(value, "planApproval");
  if (specApproval !== undefined) parsed.specApproval = specApproval;
  if (planApproval !== undefined) parsed.planApproval = planApproval;

  for (const entry of Object.keys(value)) {
    if (!WORKFLOW_APPROVAL_KEYS.includes(entry as WorkflowApprovalKey)) {
      throw configError(
        `workflow.${entry}`,
        "a supported workflow setting",
        value[entry],
      );
    }
  }

  return hasEntries(parsed) ? parsed : undefined;
}
