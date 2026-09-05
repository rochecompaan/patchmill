import type { GitWorktreeStrategyConfig } from "../git/types.ts";
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../git/worktree-strategy.ts";

export const PLANNING_PR_WORKFLOW_VERSION = "planning-pr-v1" as const;

export type PlanningPhaseKind = "spec" | "plan" | "implementation";
export type PlanningArtifactKind = "spec" | "plan";

export type PlanningGateSnapshot = {
  specRequired: boolean;
  planRequired: boolean;
};

export type PlannedPhase = {
  kind: PlanningPhaseKind;
  artifactKinds: readonly PlanningArtifactKind[];
  pullRequestRequired: true;
};

export function planningPhasePlan(
  gates: PlanningGateSnapshot,
): readonly PlannedPhase[] {
  if (gates.specRequired && gates.planRequired) {
    return [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "plan",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ];
  }
  if (gates.specRequired) {
    return [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
    ];
  }
  if (gates.planRequired) {
    return [
      {
        kind: "plan",
        artifactKinds: ["spec", "plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ];
  }
  return [
    {
      kind: "implementation",
      artifactKinds: ["spec", "plan"],
      pullRequestRequired: true,
    },
  ];
}

export function phaseWorkspaceIdentity(input: {
  issueNumber: number;
  title: string;
  phase: PlanningPhaseKind;
  strategy: GitWorktreeStrategyConfig;
}): { branch: string; worktreePath: string } {
  const branch = buildIssueBranchName(
    input.issueNumber,
    input.title,
    input.strategy,
  );
  const worktreePath = buildIssueWorktreePath(
    input.issueNumber,
    input.title,
    input.strategy,
  );
  return {
    branch: `${branch}-${input.phase}`,
    worktreePath: `${worktreePath}-${input.phase}`,
  };
}

const markerCandidatePattern = /<!--\s*patchmill:planning-pr-[\s\S]*?-->/gu;
const markerStartPattern = /<!--\s*patchmill:planning-pr-/gu;
const validMarkerPattern =
  /^<!-- patchmill:(planning-pr-v1) issue=([1-9]\d*) phase=(spec|plan|implementation) -->$/u;

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

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function backtickRunEnd(value: string, start: number): number {
  let end = start;
  while (value[end] === "`") end += 1;
  return end;
}

function codeSpanEnd(
  value: string,
  start: number,
  delimiterLength: number,
): number | undefined {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (value[cursor] !== "`" || isEscaped(value, cursor)) continue;
    const end = backtickRunEnd(value, cursor);
    if (end - cursor === delimiterLength) return end;
    cursor = end - 1;
  }
  return undefined;
}

function withoutMarkdownCodeSpans(body: string): string {
  let visibleText = "";
  for (let cursor = 0; cursor < body.length; cursor += 1) {
    if (body[cursor] !== "`" || isEscaped(body, cursor)) {
      visibleText += body[cursor];
      continue;
    }
    const openerEnd = backtickRunEnd(body, cursor);
    const closerEnd = codeSpanEnd(body, openerEnd, openerEnd - cursor);
    if (closerEnd === undefined) {
      visibleText += body.slice(cursor, openerEnd);
      cursor = openerEnd - 1;
      continue;
    }
    visibleText += " ";
    cursor = closerEnd - 1;
  }
  return visibleText;
}

export function parsePlanningPullRequestMarker(body: string):
  | {
      workflowVersion: typeof PLANNING_PR_WORKFLOW_VERSION;
      issueNumber: number;
      phase: PlanningPhaseKind;
    }
  | undefined {
  const markerBody = withoutMarkdownCodeSpans(body);
  const candidates = markerBody.match(markerCandidatePattern) ?? [];
  const starts = markerBody.match(markerStartPattern) ?? [];
  if (starts.length === 0) return undefined;
  if (starts.length !== candidates.length) {
    throw new PlanningPullRequestMarkerError("malformed marker", markerBody);
  }
  if (candidates.length !== 1) {
    throw new PlanningPullRequestMarkerError(
      "multiple markers",
      candidates.join("\n"),
    );
  }
  const marker = candidates[0]!;
  const match = validMarkerPattern.exec(marker);
  if (!match) {
    throw new PlanningPullRequestMarkerError("unsupported marker", marker);
  }
  const issueNumber = Number(match[2]);
  if (!Number.isSafeInteger(issueNumber)) {
    throw new PlanningPullRequestMarkerError("invalid issue number", marker);
  }
  return {
    workflowVersion: PLANNING_PR_WORKFLOW_VERSION,
    issueNumber,
    phase: match[3] as PlanningPhaseKind,
  };
}

export function planningPullRequestTitle(input: {
  issueNumber: number;
  phase: PlanningArtifactKind;
}): string {
  assertPositiveIssueNumber(input.issueNumber);
  const label = input.phase === "spec" ? "Spec" : "Plan";
  return `${label} for #${input.issueNumber}`;
}

function markdownCodeSpan(value: string): string {
  const delimiter = "`".repeat(
    1 + Math.max(0, ...(value.match(/`+/gu) ?? []).map((run) => run.length)),
  );
  return `${delimiter} ${value} ${delimiter}`;
}

export function planningPullRequestBody(input: {
  issueNumber: number;
  phase: PlanningArtifactKind;
  artifactPaths: readonly string[];
}): string {
  assertPositiveIssueNumber(input.issueNumber);
  const artifactPaths = [...new Set(input.artifactPaths)];
  if (artifactPaths.length === 0) {
    throw new RangeError("Planning pull request requires an artifact path");
  }
  const label = input.phase === "spec" ? "Spec" : "Plan";
  return [
    `Refs #${input.issueNumber}`,
    "",
    "## Planning phase",
    "",
    label,
    "",
    "## Artifacts",
    "",
    ...artifactPaths.map((path) => `- ${markdownCodeSpan(path)}`),
    "",
    "Merge this pull request to unlock the next phase.",
    "",
    renderPlanningPullRequestMarker(input),
  ].join("\n");
}
