import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";

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
  const workspaceArtifacts = input.state.phases.flatMap((phase) =>
    "artifacts" in phase
      ? phase.artifacts
          .filter((artifact) => artifact.source === "workspace")
          .map((artifact) => artifact.commitOid)
      : [],
  );
  const commits = new Set([...input.commits, ...workspaceArtifacts]);
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
      error.reason === "not-ancestor"
    )
      throw new PlanningImplementationAncestryError();
    throw error;
  }
}
