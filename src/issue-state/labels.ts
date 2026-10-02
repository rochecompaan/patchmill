import type { IssueHostProvider } from "../host/types.ts";
import type { PatchmillTriagePolicy } from "../policy/triage.ts";
import type { WorkflowApprovalPolicy } from "../workflow/approval-policy.ts";
import type {
  IssueStateProvider,
  IssueStateTransition,
  IssueWorkflowRole,
} from "./types.ts";
import { uniqueWorkflowRoles } from "./roles.ts";

export type LabelIssueStateOptions = {
  triagePolicy: PatchmillTriagePolicy;
  approvalPolicy: WorkflowApprovalPolicy;
};

type RoleLabelEntry = {
  role: IssueWorkflowRole;
  label: string;
};

function roleLabelEntries(options: LabelIssueStateOptions): RoleLabelEntry[] {
  return [
    { role: "agent-ready", label: options.triagePolicy.labels.ready },
    { role: "needs-info", label: options.triagePolicy.labels.needsInfo },
    { role: "agent-unsuitable", label: options.triagePolicy.labels.unsuitable },
    { role: "blocked", label: options.triagePolicy.labels.blocked },
    { role: "in-progress", label: options.triagePolicy.labels.inProgress },
    { role: "agent-done", label: options.triagePolicy.labels.done },
    {
      role: "spec-review",
      label: options.approvalPolicy.specApproval.reviewLabel,
    },
    {
      role: "spec-approved",
      label: options.approvalPolicy.specApproval.approvedLabel,
    },
    {
      role: "plan-review",
      label: options.approvalPolicy.planApproval.reviewLabel,
    },
    {
      role: "plan-approved",
      label: options.approvalPolicy.planApproval.approvedLabel,
    },
  ];
}

export function workflowRolesFromLabels(
  labels: readonly string[],
  options: LabelIssueStateOptions,
): IssueWorkflowRole[] {
  const labelSet = new Set(labels);
  return uniqueWorkflowRoles(
    roleLabelEntries(options).flatMap((entry) =>
      labelSet.has(entry.label) ? [entry.role] : [],
    ),
  );
}

function uniquePreserved(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function planLabelChange(
  issueNumber: number,
  oldLabels: string[],
  newLabels: string[],
) {
  const oldSet = new Set(oldLabels);
  const newSet = new Set(newLabels);
  return {
    issueNumber,
    oldLabels: [...oldLabels].sort((a, b) => a.localeCompare(b)),
    newLabels: [...newLabels].sort((a, b) => a.localeCompare(b)),
    addLabels: uniquePreserved(newLabels.filter((label) => !oldSet.has(label))),
    removeLabels: uniquePreserved(
      oldLabels.filter((label) => !newSet.has(label)),
    ),
  };
}

function labelsForRoles(
  roles: readonly IssueWorkflowRole[],
  options: LabelIssueStateOptions,
): string[] {
  const rolesSet = new Set(roles);
  return roleLabelEntries(options).flatMap((entry) =>
    rolesSet.has(entry.role) ? [entry.label] : [],
  );
}

export function labelsAfterWorkflowRoleTransition(
  labels: readonly string[],
  roles: readonly IssueWorkflowRole[],
  options: LabelIssueStateOptions,
): string[] {
  const patchmillLabels = new Set(
    roleLabelEntries(options).map((entry) => entry.label),
  );
  return uniquePreserved([
    ...labels.filter((label) => !patchmillLabels.has(label)),
    ...labelsForRoles(roles, options),
  ]);
}

export function createLabelIssueStateProvider(
  host: Pick<IssueHostProvider, "applyLabels">,
  options: LabelIssueStateOptions,
): IssueStateProvider {
  return {
    resolveRoles(issue) {
      return { roles: workflowRolesFromLabels(issue.labels, options) };
    },
    async setRoles(transition: IssueStateTransition) {
      const oldLabels = transition.issue.labels;
      const newLabels = labelsAfterWorkflowRoleTransition(
        oldLabels,
        transition.roles,
        options,
      );
      await host.applyLabels(
        planLabelChange(transition.issue.number, oldLabels, newLabels),
      );
    },
  };
}
