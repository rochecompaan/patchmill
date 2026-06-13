import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import type { IssueSelectionOptions, IssueSummary } from "./types.ts";
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

  let selected: IssueSummary | undefined;
  for (const issue of issues) {
    if (!isEligible(issue, resolved)) continue;
    if (!selected || compareIssues(issue, selected, resolved) < 0) {
      selected = issue;
    }
  }

  return selected;
}
