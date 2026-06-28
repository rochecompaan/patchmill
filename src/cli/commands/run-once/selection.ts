import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import type {
  IssueSelectionDiagnostics,
  IssueSelectionOptions,
  IssueSelectionRejection,
  IssueSelectionRejectionReason,
  IssueSummary,
} from "./types.ts";
import {
  assertExplicitWorkflowState,
  isActionableWorkflowState,
  resolveWorkflowState,
} from "./workflow-state.ts";

const DEFAULT_TRIAGE_POLICY = createTriagePolicy(
  DEFAULT_PATCHMILL_CONFIG.labels,
);

type ResolvedIssueSelectionOptions = {
  issueNumber?: number;
  readyLabel: IssueSelectionOptions["readyLabel"];
  approvalPolicy: IssueSelectionOptions["approvalPolicy"];
  priorityLabels: readonly string[];
  excludedLabels: Set<string>;
};

function defaultExcludedLabels(options: IssueSelectionOptions): string[] {
  return [
    ...(options.triagePolicy ?? DEFAULT_TRIAGE_POLICY).runOnceSelection
      .excludedLabels,
  ];
}

function resolveSelectionOptions(
  options: IssueSelectionOptions,
): ResolvedIssueSelectionOptions {
  const triagePolicy = options.triagePolicy ?? DEFAULT_TRIAGE_POLICY;

  return {
    issueNumber: options.issueNumber,
    readyLabel: options.readyLabel,
    approvalPolicy: options.approvalPolicy,
    priorityLabels:
      options.priorityLabels ?? triagePolicy.runOnceSelection.priorityOrder,
    excludedLabels: new Set([
      ...defaultExcludedLabels(options),
      ...(options.excludedLabels ?? []),
    ]),
  };
}

function priorityRank(
  labels: string[],
  priorityLabels: readonly string[],
): number {
  for (const [index, label] of priorityLabels.entries()) {
    if (labels.includes(label)) return index;
  }

  return priorityLabels.length;
}

function blockingLabels(
  labels: string[],
  excludedLabels: Set<string>,
): string[] {
  return labels.filter((label) => excludedLabels.has(label));
}

function approvalPolicy(options: ResolvedIssueSelectionOptions) {
  return (
    options.approvalPolicy ??
    createWorkflowApprovalPolicy(DEFAULT_PATCHMILL_CONFIG.workflow)
  );
}

function isEligible(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): boolean {
  if (issue.state !== "open") return false;
  if (blockingLabels(issue.labels, options.excludedLabels).length > 0) {
    return false;
  }

  return isActionableWorkflowState(
    resolveWorkflowState(issue.labels, {
      readyLabel: options.readyLabel,
      policy: approvalPolicy(options),
    }),
  );
}

function rejectionForIssue(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): IssueSelectionRejection | undefined {
  const state = resolveWorkflowState(issue.labels, {
    readyLabel: options.readyLabel,
    policy: approvalPolicy(options),
  });
  const blockedBy = blockingLabels(issue.labels, options.excludedLabels);
  let reason: IssueSelectionRejectionReason | undefined;
  let missingLabel: string | undefined;

  if (issue.state !== "open") {
    reason = "non-open-state";
  } else if (blockedBy.length > 0) {
    reason = "blocking-labels";
  } else if (state.kind === "waiting-spec-review") {
    reason = "waiting-spec-approval";
    missingLabel = state.missingLabel;
  } else if (state.kind === "waiting-plan-review") {
    reason = "waiting-plan-approval";
    missingLabel = state.missingLabel;
  } else if (!isActionableWorkflowState(state)) {
    reason = "not-actionable";
  }

  if (!reason) return undefined;

  return {
    issueNumber: issue.number,
    title: issue.title,
    state: issue.state,
    labels: [...issue.labels],
    workflowState: state.kind,
    reason,
    ...(blockedBy.length > 0 ? { blockingLabels: blockedBy } : {}),
    ...(missingLabel ? { missingLabel } : {}),
  };
}

function compareIssues(
  left: IssueSummary,
  right: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): number {
  const priorityDifference =
    priorityRank(left.labels, options.priorityLabels) -
    priorityRank(right.labels, options.priorityLabels);
  if (priorityDifference !== 0) return priorityDifference;
  return left.number - right.number;
}

export function selectIssueWithDiagnostics(
  issues: IssueSummary[],
  options: IssueSelectionOptions,
): IssueSelectionDiagnostics {
  const resolved = resolveSelectionOptions(options);

  if (resolved.issueNumber !== undefined) {
    return {
      issue: selectIssue(issues, options),
      rejections: [],
      consideredCount: issues.length,
    };
  }

  let selected: IssueSummary | undefined;
  for (const issue of issues) {
    if (!isEligible(issue, resolved)) continue;
    if (!selected || compareIssues(issue, selected, resolved) < 0) {
      selected = issue;
    }
  }

  if (selected) {
    return { issue: selected, rejections: [], consideredCount: issues.length };
  }

  return {
    rejections: issues.flatMap((issue) => {
      const rejection = rejectionForIssue(issue, resolved);
      return rejection ? [rejection] : [];
    }),
    consideredCount: issues.length,
  };
}

export function selectIssue(
  issues: IssueSummary[],
  options: IssueSelectionOptions,
): IssueSummary | undefined {
  const resolved = resolveSelectionOptions(options);

  if (resolved.issueNumber !== undefined) {
    const issue = issues.find(
      (candidate) =>
        candidate.number === resolved.issueNumber && candidate.state === "open",
    );
    if (!issue) return undefined;
    const blockedBy = blockingLabels(issue.labels, resolved.excludedLabels);
    if (blockedBy.length > 0) {
      throw new Error(
        `Issue #${issue.number} is open but not eligible because it has ${blockedBy.join(", ")}`,
      );
    }

    assertExplicitWorkflowState(issue.labels, {
      readyLabel: resolved.readyLabel,
      policy: approvalPolicy(resolved),
      issue,
    });

    return issue;
  }

  return selectIssueWithDiagnostics(issues, options).issue;
}
