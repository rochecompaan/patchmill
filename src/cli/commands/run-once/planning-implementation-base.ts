import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningRemoteBaseSnapshot } from "../../../git/planning-workspaces.ts";
import type {
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";

export type PlanningImplementationBaseErrorReason =
  | "prior-artifact-missing"
  | "prior-artifact-ambiguous"
  | "prior-artifact-mismatch";

/** A newly fetched implementation base no longer proves completed planning work. */
export class PlanningImplementationBaseError extends Error {
  readonly reason: PlanningImplementationBaseErrorReason;

  constructor(reason: PlanningImplementationBaseErrorReason) {
    super(`Planning implementation base is unsafe: ${reason}`);
    this.name = "PlanningImplementationBaseError";
    this.reason = reason;
  }
}

function effectivePlanningAnchor(
  phase: Extract<
    PlanningPhaseStateV1,
    { kind: "spec" | "plan"; status: "complete" }
  >,
): string {
  return phase.completion.kind === "merged-pull-request"
    ? phase.completion.mergedBaseOid
    : phase.base.baseOid;
}

/**
 * Verifies every completed planning artifact on the fetched implementation base
 * and retains only the newest completed planning phase's effective anchor.
 */
export async function assertPlanningImplementationBase(input: {
  state: PlanningStateV1;
  phaseIndex: number;
  base: PlanningRemoteBaseSnapshot;
  git: Pick<
    PlanningPublicationOperations,
    "assertAncestor" | "assertRegularFiles"
  >;
}): Promise<void> {
  let newestAnchor: string | undefined;
  const paths = new Set<string>();
  for (const phase of input.state.phases.slice(0, input.phaseIndex)) {
    if (phase.kind === "implementation" || phase.status !== "complete")
      continue;
    newestAnchor = effectivePlanningAnchor(phase);
    for (const artifact of phase.artifacts) {
      const candidates = input.base.artifactCandidates[artifact.kind];
      if (candidates.length === 0)
        throw new PlanningImplementationBaseError("prior-artifact-missing");
      if (candidates.length > 1)
        throw new PlanningImplementationBaseError("prior-artifact-ambiguous");
      if (candidates[0] !== artifact.path)
        throw new PlanningImplementationBaseError("prior-artifact-mismatch");
      paths.add(artifact.path);
    }
  }
  if (newestAnchor !== undefined)
    await input.git.assertAncestor({
      ancestorOid: newestAnchor,
      descendantOid: input.base.baseOid,
    });
  if (paths.size > 0)
    await input.git.assertRegularFiles({
      commitOid: input.base.baseOid,
      paths: [...paths],
    });
}
