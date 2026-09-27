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

export type PlanningMergeProofInsufficiency =
  | Readonly<{ source: "merge-ancestry"; failure: "not-ancestor" }>
  | Readonly<{
      source: "merge-commit-tree" | "fetched-base-tree";
      failure: "non-regular-file";
    }>;

export type PlanningMergedArtifactProof =
  | Readonly<{
      kind: "verified";
      evidenceSource: "merge-and-base" | "current-base";
    }>
  | Readonly<{
      kind: "blocked";
      trigger: PlanningMergeProofInsufficiency;
      recovery: Extract<PlanningMergeRecoveryResult, { kind: "blocked" }>;
    }>;

function typedInsufficiency(
  error: unknown,
  source: PlanningMergeProofInsufficiency["source"],
): PlanningMergeProofInsufficiency | undefined {
  if (!(error instanceof PlanningPublicationGitError)) return undefined;
  if (
    source === "merge-ancestry" &&
    error.operation === "ancestry" &&
    error.reason === "not-ancestor"
  )
    return { source, failure: "not-ancestor" };
  if (
    source !== "merge-ancestry" &&
    error.operation === "tree" &&
    error.reason === "non-regular-file"
  )
    return { source, failure: "non-regular-file" };
  return undefined;
}

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

export async function verifyPlanningMergedArtifacts(input: {
  mergeOid: string;
  artifacts: readonly PlanningArtifactEvidence[];
  base: PlanningRemoteBaseSnapshot;
  git: Pick<
    PlanningPublicationOperations,
    "assertAncestor" | "assertRegularFiles"
  >;
}): Promise<PlanningMergedArtifactProof> {
  const paths = input.artifacts.map((artifact) => artifact.path);
  const checks: readonly [
    PlanningMergeProofInsufficiency["source"],
    () => Promise<void>,
  ][] = [
    [
      "merge-ancestry",
      () =>
        input.git.assertAncestor({
          ancestorOid: input.mergeOid,
          descendantOid: input.base.baseOid,
        }),
    ],
    [
      "merge-commit-tree",
      () => input.git.assertRegularFiles({ commitOid: input.mergeOid, paths }),
    ],
    [
      "fetched-base-tree",
      () =>
        input.git.assertRegularFiles({ commitOid: input.base.baseOid, paths }),
    ],
  ];
  for (const [source, check] of checks) {
    try {
      await check();
    } catch (error) {
      const trigger = typedInsufficiency(error, source);
      if (trigger === undefined) throw error;
      const recovery = await verifyPlanningMergeRecoveryEvidence({
        artifacts: input.artifacts,
        base: input.base,
        git: input.git,
      });
      return recovery.kind === "verified"
        ? { kind: "verified", evidenceSource: "current-base" }
        : { kind: "blocked", trigger, recovery };
    }
  }
  return { kind: "verified", evidenceSource: "merge-and-base" };
}
