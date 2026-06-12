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
