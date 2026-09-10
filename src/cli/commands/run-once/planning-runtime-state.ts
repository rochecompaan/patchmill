import type {
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
export function requiredImplementationFinishContext(
  state: PlanningStateV1,
  phaseIndex: number,
): ImplementationPullRequestOpenPlanningPhase {
  const phase = state.phases[phaseIndex];
  if (phase?.kind !== "implementation" || phase.status !== "pull-request-open")
    throw new Error(
      "Planning finish requires a validated implementation pull request",
    );
  return phase;
}
