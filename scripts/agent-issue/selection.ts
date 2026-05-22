import { DEFAULT_TRIAGE_EXCLUDED_LABELS } from "../agent-issue-triage/labels.ts";
import type { IssueSelectionOptions, IssueSummary } from "./types.ts";

const PRIORITY_LABELS = [
  "priority:critical",
  "priority:high",
  "priority:medium",
  "priority:low",
] as const;

const EXCLUDED_LABELS = new Set<string>(
  [...DEFAULT_TRIAGE_EXCLUDED_LABELS].filter((label) => label !== "agent-ready"),
);

function priorityRank(labels: string[]): number {
  for (const [index, label] of PRIORITY_LABELS.entries()) {
    if (labels.includes(label)) return index;
  }

  return PRIORITY_LABELS.length;
}

function blockingLabels(labels: string[]): string[] {
  return labels.filter((label) => EXCLUDED_LABELS.has(label));
}

function isEligible(issue: IssueSummary, readyLabel: string): boolean {
  return issue.state === "open"
    && issue.labels.includes(readyLabel)
    && blockingLabels(issue.labels).length === 0;
}

function compareIssues(left: IssueSummary, right: IssueSummary): number {
  const priorityDifference = priorityRank(left.labels) - priorityRank(right.labels);
  if (priorityDifference !== 0) return priorityDifference;
  return left.number - right.number;
}

export function selectIssue(
  issues: IssueSummary[],
  options: IssueSelectionOptions,
): IssueSummary | undefined {
  if (options.issueNumber !== undefined) {
    const issue = issues.find((candidate) => candidate.number === options.issueNumber && candidate.state === "open");
    if (!issue) return undefined;
    if (!issue.labels.includes(options.readyLabel)) {
      throw new Error(`Issue #${issue.number} is open but not labeled ${options.readyLabel}`);
    }

    const blockedBy = blockingLabels(issue.labels);
    if (blockedBy.length > 0) {
      throw new Error(`Issue #${issue.number} is open but not eligible because it has ${blockedBy.join(", ")}`);
    }

    return issue;
  }

  let selected: IssueSummary | undefined;
  for (const issue of issues) {
    if (!isEligible(issue, options.readyLabel)) continue;
    if (!selected || compareIssues(issue, selected) < 0) {
      selected = issue;
    }
  }

  return selected;
}
