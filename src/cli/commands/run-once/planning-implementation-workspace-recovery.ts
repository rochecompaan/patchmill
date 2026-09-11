import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type {
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";

export type PostAgentWorkspaceRecoveryInput = Readonly<{
  state: PlanningStateV1;
  phaseIndex: number;
  phase: ImplementationWorkspaceReadyPlanningPhase;
  workspaces: Pick<PlanningWorkspaceLifecycle, "inspect">;
  git: Pick<PlanningPublicationOperations, "assertAncestor">;
  checkpoint: (
    phase: ImplementationWorkspaceReadyPlanningPhase,
  ) => Promise<PlanningStateV1>;
}>;

/** Adopts only a clean workspace head proven to descend from saved evidence. */
export async function recoverPostAgentWorkspace(
  input: PostAgentWorkspaceRecoveryInput,
) {
  const workspace = await input.workspaces.inspect(
    input.phase.workspace.identity,
  );
  if (workspace.state !== "ready" || !workspace.clean)
    return { kind: "unsafe" as const, state: input.state };
  if (workspace.headOid === input.phase.workspace.headOid)
    return {
      kind: "safe" as const,
      state: input.state,
      phase: input.phase,
      workspace,
    };
  try {
    await input.git.assertAncestor({
      ancestorOid: input.phase.workspace.headOid,
      descendantOid: workspace.headOid,
    });
  } catch (error) {
    if (
      error instanceof PlanningPublicationGitError &&
      error.reason === "not-ancestor"
    )
      return { kind: "unsafe" as const, state: input.state };
    throw error;
  }
  const state = await input.checkpoint({
    ...input.phase,
    workspace: { ...input.phase.workspace, headOid: workspace.headOid },
  });
  const phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation" || phase.status !== "workspace-ready")
    throw new RangeError("Implementation workspace state changed");
  return { kind: "safe" as const, state, phase, workspace };
}
