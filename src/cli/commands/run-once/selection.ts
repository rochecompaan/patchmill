import type { IssueSummary } from "../../../issue/types.ts";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { workflowRolesFromLabels } from "../../../issue-state/labels.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { selectionBlockingLabels } from "./pipeline-lifecycle.ts";
import type {
  IssueSelectionDiagnostics,
  IssueSelectionOptions,
  IssueSelectionRejection,
  IssueSelectionRejectionReason,
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
  approvalPolicy?: IssueSelectionOptions["approvalPolicy"];
  issueState?: IssueSelectionOptions["issueState"];
  issueStateProvider?: IssueSelectionOptions["issueStateProvider"];
  triagePolicy: ReturnType<typeof createTriagePolicy>;
  priorityLabels: readonly string[];
  excludedLabels: Set<string>;
};

function defaultExcludedLabels(options: IssueSelectionOptions): string[] {
  return [
    ...(options.triagePolicy?.runOnceSelection?.excludedLabels ??
      DEFAULT_TRIAGE_POLICY.runOnceSelection.excludedLabels),
  ];
}

function resolveSelectionOptions(
  options: IssueSelectionOptions,
): ResolvedIssueSelectionOptions {
  const triagePolicy = options.triagePolicy?.labels
    ? options.triagePolicy
    : DEFAULT_TRIAGE_POLICY;

  return {
    ...(options.issueNumber === undefined
      ? {}
      : { issueNumber: options.issueNumber }),
    readyLabel: options.readyLabel,
    triagePolicy,
    ...(options.approvalPolicy === undefined
      ? {}
      : { approvalPolicy: options.approvalPolicy }),
    ...(options.issueState === undefined
      ? {}
      : { issueState: options.issueState }),
    ...(options.issueStateProvider === undefined
      ? {}
      : { issueStateProvider: options.issueStateProvider }),
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
  options: ResolvedIssueSelectionOptions,
): string[] {
  return selectionBlockingLabels(labels, [...options.excludedLabels], options);
}

function approvalPolicy(options: ResolvedIssueSelectionOptions) {
  return (
    options.approvalPolicy ??
    createWorkflowApprovalPolicy(DEFAULT_PATCHMILL_CONFIG.workflow)
  );
}

function workflowRoles(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): string[] {
  if (options.issueStateProvider) {
    return options.issueStateProvider.resolveRoles(issue).roles;
  }
  return workflowRolesFromLabels(issue.labels, {
    triagePolicy: options.triagePolicy,
    approvalPolicy: approvalPolicy(options),
  });
}

function isBlockedByWorkflowRole(roles: readonly string[]): boolean {
  return roles.some((role) =>
    [
      "needs-info",
      "agent-unsuitable",
      "blocked",
      "in-progress",
      "agent-done",
    ].includes(role),
  );
}

function isEligible(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): boolean {
  if (issue.state !== "open") return false;
  if (blockingLabels(issue.labels, options).length > 0) {
    return false;
  }
  const roles = workflowRoles(issue, options);
  if (isBlockedByWorkflowRole(roles)) return false;

  return isActionableWorkflowState(
    resolveWorkflowState(roles, {
      readyLabel: options.readyLabel,
      policy: approvalPolicy(options),
    }),
  );
}

function rejectionForIssue(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): IssueSelectionRejection | undefined {
  const roles = workflowRoles(issue, options);
  const state = resolveWorkflowState(roles, {
    readyLabel: options.readyLabel,
    policy: approvalPolicy(options),
  });
  const blockedBy = blockingLabels(issue.labels, options);
  let reason: IssueSelectionRejectionReason | undefined;
  let missingLabel: string | undefined;

  if (issue.state !== "open") {
    reason = "non-open-state";
  } else if (blockedBy.length > 0 || isBlockedByWorkflowRole(roles)) {
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

export function compareIssuesByPriority(
  left: IssueSummary,
  right: IssueSummary,
  priorityLabels: readonly string[],
): number {
  const priorityDifference =
    priorityRank(left.labels, priorityLabels) -
    priorityRank(right.labels, priorityLabels);
  return priorityDifference !== 0
    ? priorityDifference
    : left.number - right.number;
}

function compareIssues(
  left: IssueSummary,
  right: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): number {
  return compareIssuesByPriority(left, right, options.priorityLabels);
}

export function selectIssueWithDiagnostics(
  issues: IssueSummary[],
  options: IssueSelectionOptions,
): IssueSelectionDiagnostics {
  const resolved = resolveSelectionOptions(options);

  if (resolved.issueNumber !== undefined) {
    const issue = selectIssue(issues, options);
    return {
      ...(issue === undefined ? {} : { issue }),
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
    const blockedBy = blockingLabels(issue.labels, resolved);
    if (blockedBy.length > 0) {
      throw new Error(
        `Issue #${issue.number} is open but not eligible because it has ${blockedBy.join(", ")}`,
      );
    }

    assertExplicitWorkflowState(workflowRoles(issue, resolved), {
      readyLabel: resolved.readyLabel,
      policy: approvalPolicy(resolved),
      issue,
    });

    return issue;
  }

  return selectIssueWithDiagnostics(issues, options).issue;
}
