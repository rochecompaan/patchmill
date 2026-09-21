import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type { PlanningRemoteBaseSnapshot } from "../../../git/planning-workspaces.ts";
import type { PlanningArtifactEvidence } from "../../../workflow/planning-state-types.ts";

export type PlanningMergeRecoveryFailure =
  | "missing"
  | "ambiguous"
  | "path-mismatch"
  | "non-regular-file";

export type PlanningMergeRecoveryResult =
  | Readonly<{ kind: "verified" }>
  | Readonly<{
      kind: "blocked";
      failure: PlanningMergeRecoveryFailure;
      artifactKinds: readonly ("spec" | "plan")[];
      expectedPaths: readonly string[];
      observedCandidates: readonly string[];
    }>;

export async function verifyPlanningMergeRecoveryEvidence(input: {
  artifacts: readonly PlanningArtifactEvidence[];
  base: PlanningRemoteBaseSnapshot;
  git: Pick<PlanningPublicationOperations, "assertRegularFiles">;
}): Promise<PlanningMergeRecoveryResult> {
  for (const artifact of input.artifacts) {
    const candidates = input.base.artifactCandidates[artifact.kind];
    const failure =
      candidates.length === 0
        ? "missing"
        : candidates.length > 1
          ? "ambiguous"
          : candidates[0] !== artifact.path
            ? "path-mismatch"
            : undefined;
    if (failure !== undefined)
      return {
        kind: "blocked",
        failure,
        artifactKinds: [artifact.kind],
        expectedPaths: [artifact.path],
        observedCandidates: candidates,
      };
  }
  const paths = input.artifacts.map((artifact) => artifact.path);
  try {
    await input.git.assertRegularFiles({
      commitOid: input.base.baseOid,
      paths,
    });
  } catch (error) {
    if (
      error instanceof PlanningPublicationGitError &&
      error.operation === "tree" &&
      error.reason === "non-regular-file"
    )
      return {
        kind: "blocked",
        failure: "non-regular-file",
        artifactKinds: input.artifacts.map((artifact) => artifact.kind),
        expectedPaths: paths,
        observedCandidates: input.artifacts.flatMap(
          (artifact) => input.base.artifactCandidates[artifact.kind],
        ),
      };
    throw error;
  }
  return { kind: "verified" };
}
