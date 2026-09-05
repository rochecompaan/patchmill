import type { GitWorktreeStrategyConfig } from "../git/types.ts";
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../git/worktree-strategy.ts";
import {
  renderPlanningPullRequestMarker,
  type PlanningPhaseKind,
} from "./planning-pull-request-markers.ts";

export {
  PLANNING_PR_WORKFLOW_VERSION,
  PlanningPullRequestMarkerError,
  parsePlanningPullRequestMarker,
  renderPlanningPullRequestMarker,
} from "./planning-pull-request-markers.ts";
export type { PlanningPhaseKind } from "./planning-pull-request-markers.ts";

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

function assertPositiveIssueNumber(issueNumber: number): void {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new RangeError("Issue number must be a positive safe integer");
  }
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

function assertSingleLineArtifactPath(path: string): void {
  if (/\r|\n/u.test(path)) {
    throw new RangeError("Planning artifact paths must be single-line");
  }
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
  for (const path of artifactPaths) assertSingleLineArtifactPath(path);
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
