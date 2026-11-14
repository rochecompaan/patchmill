import type { Issue, PullRequest } from "../src/host/types.ts";
import type { RunProgress } from "../src/kernel/run-progress.ts";
import type { RunObservation } from "../src/web/file-run-observations.ts";

export function boardIssue(number = 9, labels: string[] = []): Issue {
  return {
    number,
    title: `Issue ${number}`,
    body: "Private issue body",
    labels,
    state: "open",
    url: `https://github.com/owner/repo/issues/${number}`,
    author: "person",
    createdAt: "2026-11-14T12:00:00Z",
    comments: [],
  };
}
export function boardProgress(
  overrides: Partial<RunProgress> = {},
): RunProgress {
  return {
    schemaVersion: 1,
    issue: 9,
    runId: "20261114-120000-abcd",
    startedAt: "2026-11-14T12:00:00Z",
    updatedAt: "2026-11-14T12:00:01Z",
    state: "planning",
    phase: "planning",
    session: 1,
    interactive: true,
    facts: null,
    summary: null,
    outcome: null,
    ...overrides,
  };
}
export function boardObservation(
  overrides: Partial<RunObservation> = {},
): RunObservation {
  return {
    live: false,
    incomplete: false,
    state: null,
    phase: null,
    stage: null,
    branch: null,
    specPath: null,
    planPath: null,
    outcomeRole: null,
    summary: null,
    interactive: null,
    pullRequest: null,
    ...overrides,
  };
}
export function boardPull(
  branch = "agent/issue-9--spec",
  overrides: Partial<PullRequest> = {},
): PullRequest {
  return {
    number: 42,
    url: "https://github.com/owner/repo/pull/42",
    state: "open",
    draft: false,
    body: "Private PR body",
    headRepository: "owner/repo",
    headBranch: branch,
    baseBranch: "main",
    ...overrides,
  };
}
