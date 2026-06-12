import type { WorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import type { IssueSummary } from "./types.ts";

export class ApprovalRequiredError extends Error {
  readonly name = "ApprovalRequiredError";
  readonly issue: IssueSummary;
  readonly approvalKind: "spec" | "plan";
  readonly missingLabel: string;

  constructor(
    issue: IssueSummary,
    approvalKind: "spec" | "plan",
    missingLabel: string,
  ) {
    super(
      `Issue #${issue.number} requires ${approvalKind} approval label ${missingLabel}`,
    );
    this.issue = issue;
    this.approvalKind = approvalKind;
    this.missingLabel = missingLabel;
  }
}

export function issueMeetsAutomaticApprovals(
  issue: IssueSummary,
  policy: WorkflowApprovalPolicy | undefined,
): boolean {
  if (!policy?.specApproval.required) return true;
  return issue.labels.includes(policy.specApproval.approvedLabel);
}

export function assertExplicitIssueApprovals(
  issue: IssueSummary,
  policy: WorkflowApprovalPolicy | undefined,
): void {
  if (!policy?.specApproval.required) return;
  if (issue.labels.includes(policy.specApproval.approvedLabel)) return;
  throw new ApprovalRequiredError(
    issue,
    "spec",
    policy.specApproval.approvedLabel,
  );
}

export type PlanApprovalGateDecision =
  | { action: "proceed" }
  | { action: "stop-for-plan-only" }
  | {
      action: "stop-for-plan-review";
      reviewLabel: string;
      missingLabel: string;
      staleApprovedLabel?: string;
    };

export function decidePlanApprovalGate(options: {
  labels: string[];
  planOnly: boolean;
  planCreatedThisRun?: boolean;
  policy: WorkflowApprovalPolicy;
}): PlanApprovalGateDecision {
  if (options.planOnly) return { action: "stop-for-plan-only" };
  const approval = options.policy.planApproval;
  if (!approval.required) return { action: "proceed" };
  if (
    !options.planCreatedThisRun &&
    options.labels.includes(approval.approvedLabel)
  ) {
    return { action: "proceed" };
  }
  return {
    action: "stop-for-plan-review",
    reviewLabel: approval.reviewLabel,
    missingLabel: approval.approvedLabel,
    ...(options.planCreatedThisRun &&
    options.labels.includes(approval.approvedLabel)
      ? { staleApprovedLabel: approval.approvedLabel }
      : {}),
  };
}

export function approvedWorkflowReviewLabelsToRemove(
  labels: string[],
  policy: WorkflowApprovalPolicy,
): string[] {
  const remove: string[] = [];
  if (
    labels.includes(policy.planApproval.reviewLabel) &&
    labels.includes(policy.planApproval.approvedLabel)
  ) {
    remove.push(policy.planApproval.reviewLabel);
  }
  return remove;
}
