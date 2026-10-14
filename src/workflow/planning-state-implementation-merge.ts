import type {
  PlanningImplementationMergeEvidence,
  PlanningPublicationEvidence,
  PlanningWorkspaceEvidence,
} from "./planning-state-types.ts";

/** A changed saved workspace needs merge inclusion, not a fabricated checked head. */
export function implementationPublicationMatchesWorkspace(input: {
  publication: Pick<PlanningPublicationEvidence, "headOid">;
  workspace: Pick<PlanningWorkspaceEvidence, "headOid">;
  observedHeadOid?: string | undefined;
  merge?: PlanningImplementationMergeEvidence | undefined;
}): boolean {
  const workspaceHead = input.workspace.headOid;
  if (
    input.merge?.workspaceHeadOid !== undefined &&
    input.merge.workspaceHeadOid !== workspaceHead
  )
    return false;
  return (
    input.publication.headOid === workspaceHead ||
    (input.merge !== undefined &&
      input.observedHeadOid !== undefined &&
      (input.observedHeadOid === workspaceHead ||
        input.merge.workspaceHeadOid === workspaceHead))
  );
}
