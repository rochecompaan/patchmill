import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type {
  PlanningWorkspaceLifecycle,
  PlanningWorkspaceSnapshot,
} from "../../../git/planning-workspaces.ts";
import type {
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";

type UnsafeWorkspaceRecovery = Readonly<{
  kind: "unsafe";
  state: PlanningStateV1;
  reason: "not-ready" | "dirty" | "not-descendant";
  workspace: PlanningWorkspaceSnapshot;
}>;

type SafeWorkspaceRecovery = Readonly<{
  kind: "safe";
  state: PlanningStateV1;
  phase: ImplementationWorkspaceReadyPlanningPhase;
  workspace: Extract<PlanningWorkspaceSnapshot, { state: "ready" }>;
}>;

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
): Promise<UnsafeWorkspaceRecovery | SafeWorkspaceRecovery> {
  const workspace = await input.workspaces.inspect(
    input.phase.workspace.identity,
  );
  if (workspace.state !== "ready")
    return {
      kind: "unsafe",
      state: input.state,
      reason: "not-ready",
      workspace,
    };
  if (!workspace.clean)
    return {
      kind: "unsafe",
      state: input.state,
      reason: "dirty",
      workspace,
    };
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
      return {
        kind: "unsafe",
        state: input.state,
        reason: "not-descendant",
        workspace,
      };
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
