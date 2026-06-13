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

export type ActionableWorkflowState =
  | { kind: "agent-ready" }
  | { kind: "spec-approved" }
  | { kind: "plan-approved" };

export type WaitingWorkflowState =
  | { kind: "waiting-spec-review"; missingLabel: string }
  | { kind: "waiting-plan-review"; missingLabel: string };

export type RunOnceWorkflowState =
  | ActionableWorkflowState
  | WaitingWorkflowState
  | { kind: "not-actionable" };

export type WorkflowStateOptions = {
  readyLabel: string;
  policy: WorkflowApprovalPolicy;
};

export type PlanApprovalGateDecision =
  | { action: "proceed" }
  | { action: "stop-for-plan-only" }
  | {
      action: "stop-for-plan-review";
      reviewLabel: string;
      missingLabel: string;
      staleApprovedLabel?: string;
    };

function has(labels: string[], label: string): boolean {
  return labels.includes(label);
}

function removeLabels(labels: string[], remove: string[]): string[] {
  const removed = new Set(remove);
  return labels.filter((label) => !removed.has(label));
}

function addLabel(labels: string[], label: string): string[] {
  return labels.includes(label) ? labels : [...labels, label];
}

export function resolveWorkflowState(
  labels: string[],
  options: WorkflowStateOptions,
): RunOnceWorkflowState {
  const { readyLabel, policy } = options;
  const { specApproval, planApproval } = policy;

  if (has(labels, planApproval.approvedLabel)) return { kind: "plan-approved" };
  if (has(labels, specApproval.approvedLabel)) return { kind: "spec-approved" };
  if (has(labels, readyLabel)) return { kind: "agent-ready" };
  if (has(labels, specApproval.reviewLabel)) {
    return {
      kind: "waiting-spec-review",
      missingLabel: specApproval.approvedLabel,
    };
  }
  if (has(labels, planApproval.reviewLabel)) {
    return {
      kind: "waiting-plan-review",
      missingLabel: planApproval.approvedLabel,
    };
  }

  return { kind: "not-actionable" };
}

export function isActionableWorkflowState(
  state: RunOnceWorkflowState,
): state is ActionableWorkflowState {
  return (
    state.kind === "agent-ready" ||
    state.kind === "spec-approved" ||
    state.kind === "plan-approved"
  );
}

export function assertExplicitWorkflowState(
  labels: string[],
  options: WorkflowStateOptions & { issue: IssueSummary },
): ActionableWorkflowState {
  const state = resolveWorkflowState(labels, options);
  if (isActionableWorkflowState(state)) return state;

  if (state.kind === "waiting-spec-review") {
    throw new ApprovalRequiredError(options.issue, "spec", state.missingLabel);
  }
  if (state.kind === "waiting-plan-review") {
    throw new ApprovalRequiredError(options.issue, "plan", state.missingLabel);
  }

  throw new Error(
    `Issue #${options.issue.number} is open but not labeled ${options.readyLabel}, ${options.policy.specApproval.approvedLabel}, or ${options.policy.planApproval.approvedLabel}`,
  );
}

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

export function cleanupLabelsForSpecReview(
  labels: string[],
  options: WorkflowStateOptions,
): string[] {
  return addLabel(
    removeLabels(labels, [
      options.readyLabel,
      options.policy.specApproval.approvedLabel,
      options.policy.planApproval.reviewLabel,
      options.policy.planApproval.approvedLabel,
    ]),
    options.policy.specApproval.reviewLabel,
  );
}

export function cleanupLabelsForPlanReview(
  labels: string[],
  options: WorkflowStateOptions,
): string[] {
  return addLabel(
    removeLabels(labels, [
      options.readyLabel,
      options.policy.specApproval.reviewLabel,
      options.policy.specApproval.approvedLabel,
      options.policy.planApproval.approvedLabel,
    ]),
    options.policy.planApproval.reviewLabel,
  );
}

export function cleanupLabelsForImplementation(
  labels: string[],
  options: WorkflowStateOptions,
): string[] {
  return removeLabels(labels, [
    options.readyLabel,
    options.policy.specApproval.reviewLabel,
    options.policy.specApproval.approvedLabel,
    options.policy.planApproval.reviewLabel,
    options.policy.planApproval.approvedLabel,
  ]);
}
