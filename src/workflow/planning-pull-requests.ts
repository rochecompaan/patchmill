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
const validMarkerPattern =
  /^<!-- patchmill:(planning-pr-v1) issue=([1-9]\d*) phase=(spec|plan|implementation) -->$/u;
const markerPrefix = "patchmill:planning-pr-";

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

export function parsePlanningPullRequestMarker(body: string):
  | {
      workflowVersion: typeof PLANNING_PR_WORKFLOW_VERSION;
      issueNumber: number;
      phase: PlanningPhaseKind;
    }
  | undefined {
  const candidates = body.match(markerCandidatePattern) ?? [];
  if (candidates.length === 0) {
    if (body.includes(markerPrefix)) {
      throw new PlanningPullRequestMarkerError("malformed marker", body);
    }
    return undefined;
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
    ...artifactPaths.map((path) => `- \`${path}\``),
    "",
    "Merge this pull request to unlock the next phase.",
    "",
    renderPlanningPullRequestMarker(input),
  ].join("\n");
}
