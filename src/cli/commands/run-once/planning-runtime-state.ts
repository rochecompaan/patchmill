import type { AgentIssuePrCreatedResult } from "./types.ts";
import type {
  ImplementationCompletePlanningPhase,
  ImplementationPullRequestOpenPlanningPhase,
  PlanningArtifactEvidence,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";

/** Returns one unambiguous durable artifact path or fails before an effect. */
export function artifactPath(
  state: PlanningStateV1,
  kind: PlanningArtifactEvidence["kind"],
): string {
  const paths = state.phases.flatMap((phase) =>
    "artifacts" in phase
      ? phase.artifacts
          .filter((artifact) => artifact.kind === kind)
          .map((artifact) => artifact.path)
      : [],
  );
  if (paths.length !== 1)
    throw new Error(`Planning state requires exactly one durable ${kind} path`);
  return paths[0]!;
}

/** Selects the validated implementation evidence required for finish effects. */
export function durableImplementationResult(
  phase:
    | ImplementationPullRequestOpenPlanningPhase
    | ImplementationCompletePlanningPhase,
): AgentIssuePrCreatedResult {
  return {
    status: "pr-created",
    prUrl: phase.pullRequest.url,
    branch: phase.implementation.branch,
    commits: [...phase.implementation.commits],
    validation: [...phase.implementation.validation],
    ...(phase.implementation.reviewSummary === undefined
      ? {}
      : { reviewSummary: phase.implementation.reviewSummary }),
    ...(phase.implementation.landingDecision === undefined
      ? {}
      : { landingDecision: phase.implementation.landingDecision }),
    visualEvidence: phase.implementation.visualEvidence.map((evidence) => ({
      screenshotPath: evidence.screenshotPath,
      ...(evidence.caption === undefined ? {} : { caption: evidence.caption }),
      ...(evidence.referencePaths === undefined
        ? {}
        : { referencePaths: [...evidence.referencePaths] }),
      ...(evidence.url === undefined ? {} : { url: evidence.url }),
    })),
  };
}

export function requiredImplementationFinishContext(
  state: PlanningStateV1,
  phaseIndex: number,
):
  | ImplementationPullRequestOpenPlanningPhase
  | ImplementationCompletePlanningPhase {
  const phase = state.phases[phaseIndex];
  if (
    phase?.kind !== "implementation" ||
    (phase.status !== "pull-request-open" && phase.status !== "complete")
  )
    throw new Error(
      "Planning finish requires a validated implementation pull request",
    );
  return phase;
}
