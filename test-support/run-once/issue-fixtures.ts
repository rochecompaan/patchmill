import type { IssueSummary } from "../../src/cli/commands/run-once/types.ts";

export function issue(
  number: number,
  labels: string[],
  title = `Issue ${number}`,
): IssueSummary {
  return {
    number,
    title,
    body: `Body for issue ${number}`,
    labels,
    state: "open",
    author: "rozanne",
    updated: "2026-05-09T11:00:00Z",
    comments: [
      { author: { login: "ana" }, body: "Please keep this deterministic." },
    ],
  };
}

export function teaIssuePayload(entry: IssueSummary) {
  return {
    index: entry.number,
    title: entry.title,
    body: entry.body,
    state: entry.state,
    labels: entry.labels.map((name) => ({ name })),
    author: { login: entry.author },
    updated: entry.updated,
    comments: entry.comments,
  };
}

export function issueListPayload(issues: IssueSummary[]): string {
  return JSON.stringify(issues.map(teaIssuePayload));
}

export function issueViewPayload(issue: IssueSummary): string {
  return JSON.stringify(teaIssuePayload(issue));
}

export const DEFAULT_LABEL_NAMES = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
  "in-progress",
  "agent-done",
  "bug",
  "enhancement",
  "docs",
  "chore",
  "test",
  "priority:low",
  "priority:medium",
  "priority:high",
  "priority:critical",
  "spec-review",
  "spec-approved",
  "plan-review",
  "plan-approved",
] as const;

export function labelListPayload(
  labels: readonly string[] = DEFAULT_LABEL_NAMES,
): string {
  return JSON.stringify(labels.map((name) => ({ name })));
}
