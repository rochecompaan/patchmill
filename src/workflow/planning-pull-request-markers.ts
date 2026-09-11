import { markdownTopLevelLines } from "./planning-markdown-top-level-lines.ts";

export const PLANNING_PR_WORKFLOW_VERSION = "planning-pr-v1" as const;

export type PlanningPhaseKind = "spec" | "plan" | "implementation";

export class PlanningPullRequestMarkerError extends Error {
  readonly reason: string;
  readonly marker: string;

  constructor(reason: string, marker: string) {
    super(`Planning pull request marker is invalid: ${reason}`);
    this.name = "PlanningPullRequestMarkerError";
    this.reason = reason;
    this.marker = marker;
  }
}

function assertPositiveIssueNumber(issueNumber: number): void {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new RangeError("Issue number must be a positive safe integer");
  }
}

export function renderPlanningPullRequestMarker(input: {
  issueNumber: number;
  phase: PlanningPhaseKind;
}): string {
  assertPositiveIssueNumber(input.issueNumber);
  return `<!-- patchmill:${PLANNING_PR_WORKFLOW_VERSION} issue=${input.issueNumber} phase=${input.phase} -->`;
}

const markerPrefix = "<!-- patchmill:planning-pr-";
const validMarkerPattern =
  /^<!-- patchmill:(planning-pr-v1) issue=([1-9]\d*) phase=(spec|plan|implementation) -->$/u;

type MarkerLine = { line: string; index: number };

function topLevelMarkerLines(body: string): MarkerLine[] {
  return markdownTopLevelLines(body, {
    includeStandaloneLine: (line) => line.startsWith(markerPrefix),
  }).flatMap(({ line, index }) =>
    line.startsWith(markerPrefix) ? [{ line, index }] : [],
  );
}

function finalNonblankLineIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.trim() !== "") return index;
  }
  return -1;
}

export function parsePlanningPullRequestMarker(body: string):
  | {
      workflowVersion: typeof PLANNING_PR_WORKFLOW_VERSION;
      issueNumber: number;
      phase: PlanningPhaseKind;
    }
  | undefined {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const markers = topLevelMarkerLines(body);
  if (markers.length === 0) return undefined;
  if (markers.length !== 1) {
    throw new PlanningPullRequestMarkerError("multiple markers", body);
  }
  const marker = markers[0]!;
  if (marker.index !== finalNonblankLineIndex(lines)) return undefined;
  const match = validMarkerPattern.exec(marker.line);
  if (match === null) {
    throw new PlanningPullRequestMarkerError("unsupported marker", marker.line);
  }
  const issueNumber = Number(match[2]);
  if (!Number.isSafeInteger(issueNumber)) {
    throw new PlanningPullRequestMarkerError(
      "invalid issue number",
      marker.line,
    );
  }
  return {
    workflowVersion: PLANNING_PR_WORKFLOW_VERSION,
    issueNumber,
    phase: match[3] as PlanningPhaseKind,
  };
}
