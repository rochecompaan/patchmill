import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type { PlanningArtifactEvidence } from "../../../workflow/planning-state-types.ts";

/** Refresh at the record's immutable tree; cached companions never authorize paths. */
export async function refreshPlanningArtifactEvidence(input: {
  artifacts: readonly PlanningArtifactEvidence[];
  git: Pick<PlanningPublicationOperations, "inspectArtifactEvidence">;
}): Promise<readonly PlanningArtifactEvidence[]> {
  const refreshed: PlanningArtifactEvidence[] = [];
  for (const artifact of input.artifacts) {
    const evidence = await input.git.inspectArtifactEvidence(artifact);
    if (
      artifact.companionPaths !== undefined &&
      JSON.stringify(artifact.companionPaths) !==
        JSON.stringify(evidence.companionPaths ?? [])
    )
      throw new PlanningPublicationGitError(
        "tree",
        "companion-evidence-mismatch",
      );
    refreshed.push(evidence);
  }
  return refreshed;
}
