import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import type { IssueSelectionOptions, IssueSummary } from "./types.ts";

const DEFAULT_TRIAGE_POLICY = createTriagePolicy(
  DEFAULT_PATCHMILL_CONFIG.labels,
);

type ResolvedIssueSelectionOptions = {
  issueNumber?: number;
  readyLabel: IssueSelectionOptions["readyLabel"];
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
    priorityLabels:
      options.priorityLabels ?? triagePolicy.runOnceSelection.priorityOrder,
    excludedLabels: new Set(
      options.excludedLabels ?? defaultExcludedLabels(options),
    ),
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

function isEligible(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): boolean {
  return (
    issue.state === "open" &&
    issue.labels.includes(options.readyLabel) &&
    blockingLabels(issue.labels, options.excludedLabels).length === 0
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
    if (!issue.labels.includes(resolved.readyLabel)) {
      throw new Error(
        `Issue #${issue.number} is open but not labeled ${resolved.readyLabel}`,
      );
    }

    const blockedBy = blockingLabels(issue.labels, resolved.excludedLabels);
    if (blockedBy.length > 0) {
      throw new Error(
        `Issue #${issue.number} is open but not eligible because it has ${blockedBy.join(", ")}`,
      );
    }

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
