import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import {
  assertImplementationOid,
  parseImplementationCommits,
  ImplementationOidValidationError,
} from "./implementation-oid-validation.ts";

export class PlanningImplementationAncestryError extends Error {
  readonly reason = "ancestry" as const;

  constructor() {
    super("Implementation commits are not on the expected ancestry path");
    this.name = "PlanningImplementationAncestryError";
  }
}

export async function assertPlanningImplementationAncestry(input: {
  state: PlanningStateV1;
  baseOid: string;
  savedHeadOid: string;
  headOid: string;
  commits: readonly string[];
  git: Pick<PlanningPublicationOperations, "assertAncestor">;
}): Promise<void> {
  const reportedCommits = parseImplementationCommits(
    input.commits,
    "planning-ancestry",
  );
  for (const field of ["baseOid", "savedHeadOid", "headOid"] as const) {
    assertImplementationOid(input[field], {
      context: "planning-ancestry",
      field,
    });
  }
  const workspaceArtifacts = input.state.phases.flatMap((phase, phaseIndex) =>
    "artifacts" in phase
      ? phase.artifacts.flatMap((artifact, artifactIndex) => {
          if (artifact.source !== "workspace") return [];
          assertImplementationOid(artifact.commitOid, {
            context: "planning-ancestry",
            field: `phases[${phaseIndex}].artifacts[${artifactIndex}].commitOid`,
          });
          return [artifact.commitOid];
        })
      : [],
  );
  const commits = new Set([...reportedCommits, ...workspaceArtifacts]);
  try {
    await input.git.assertAncestor({
      ancestorOid: input.baseOid,
      descendantOid: input.headOid,
    });
    if (input.savedHeadOid !== input.headOid)
      await input.git.assertAncestor({
        ancestorOid: input.savedHeadOid,
        descendantOid: input.headOid,
      });
    for (const commit of commits) {
      await input.git.assertAncestor({
        ancestorOid: input.baseOid,
        descendantOid: commit,
      });
      await input.git.assertAncestor({
        ancestorOid: commit,
        descendantOid: input.headOid,
      });
    }
  } catch (error) {
    if (
      error instanceof PlanningPublicationGitError &&
      error.operation === "ancestry" &&
      error.reason === "invalid-input"
    )
      throw new ImplementationOidValidationError(
        { context: "planning-ancestry", field: "ancestry.operands" },
        { cause: error },
      );
    if (
      error instanceof PlanningPublicationGitError &&
      error.reason === "not-ancestor"
    )
      throw new PlanningImplementationAncestryError();
    throw error;
  }
}
