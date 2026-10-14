import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import {
  PlanningWorkspaceConflictError,
  type PlanningWorkspaceLifecycle,
  type PlanningWorkspaceSnapshot,
} from "../../../git/planning-workspaces.ts";
import type { PlannedPhase } from "../../../workflow/planning-pull-requests.ts";
import {
  appendPlanningArtifactEvidence,
  PlanningPhaseArtifactError,
  type PlanningArtifactCheckpoint,
  type PlanningArtifactWorkspacePhase,
} from "./planning-phase-artifacts.ts";

type WorkspaceReadyInput = {
  runId: string;
  issueNumber: number;
  specsDir: string;
  plansDir: string;
  phase: PlannedPhase;
  current: PlanningArtifactWorkspacePhase;
  checkpoint: PlanningArtifactCheckpoint;
  git: Pick<
    PlanningPublicationOperations,
    "inspectArtifactCandidates" | "assertAncestor" | "verifyArtifactCommit"
  >;
  workspaces: Pick<PlanningWorkspaceLifecycle, "inspect" | "resume">;
};

async function recoverArtifact(
  input: WorkspaceReadyInput,
  kind: PlannedPhase["artifactKinds"][number],
  headOid: string,
): Promise<PlanningArtifactWorkspacePhase> {
  const candidates = await input.git.inspectArtifactCandidates({
    commitOid: headOid,
    issueNumber: input.issueNumber,
    specsDir: input.specsDir,
    plansDir: input.plansDir,
  });
  const paths = candidates[kind];
  if (paths.length !== 1)
    throw new PlanningPhaseArtifactError(
      paths.length === 0
        ? "missing-workspace-artifact"
        : "ambiguous-workspace-artifact",
    );
  const path = paths[0]!;
  const evidence = await input.git.verifyArtifactCommit({
    workspacePath: input.current.workspace.identity.worktreePath,
    previousHeadOid: input.current.workspace.headOid,
    headOid,
    artifactPath: path,
    artifactKind: kind,
  });
  return appendPlanningArtifactEvidence(input.current, input.phase, evidence);
}

/**
 * Strictly resumes or recovers a workspace-ready phase before any agent runs.
 * Missing artifacts require a clean, artifact-only descendant. Once artifacts
 * are recorded, only implementation may adopt other descendant commits; dirty
 * content remains untouched and the caller must block before running agents.
 */
export async function reconcilePlanningWorkspaceReady(
  input: WorkspaceReadyInput,
): Promise<Extract<PlanningWorkspaceSnapshot, { state: "ready" }>> {
  const { current } = input;
  const kind = input.phase.artifactKinds.find(
    (kind) => !current.artifacts.some((artifact) => artifact.kind === kind),
  );
  const ownership = {
    runId: input.runId,
    phase: current.kind,
    identity: current.workspace.identity,
    base: current.base,
    saved: current.workspace,
  };
  try {
    return await input.workspaces.resume(ownership);
  } catch (error) {
    if (
      !(error instanceof PlanningWorkspaceConflictError) ||
      error.reason !== "head-oid-mismatch" ||
      (kind === undefined && current.kind !== "implementation")
    )
      throw error;
  }
  const observed = await input.workspaces.inspect(current.workspace.identity);
  if (observed.state !== "ready")
    throw new PlanningWorkspaceConflictError(
      "head-oid-mismatch",
      current.workspace.identity,
    );
  const liveOwnership = {
    ...ownership,
    saved: { ...current.workspace, headOid: observed.headOid },
  };
  const live = await input.workspaces.resume(liveOwnership);
  if (kind !== undefined && !live.clean)
    throw new PlanningPublicationGitError("status", "dirty-workspace");
  try {
    await input.git.assertAncestor({
      ancestorOid: current.workspace.headOid,
      descendantOid: observed.headOid,
    });
  } catch (error) {
    if (
      kind === undefined &&
      error instanceof PlanningPublicationGitError &&
      error.reason === "not-ancestor"
    )
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        current.workspace.identity,
      );
    throw error;
  }
  const next =
    kind === undefined
      ? {
          ...current,
          workspace: { ...current.workspace, headOid: observed.headOid },
        }
      : await recoverArtifact(input, kind, observed.headOid);
  // Re-prove ownership, registration, exact HEAD, and status at the checkpoint edge.
  const verified = await input.workspaces.resume(liveOwnership);
  if (kind !== undefined && !verified.clean)
    throw new PlanningPublicationGitError("status", "dirty-workspace");
  await input.checkpoint(next);
  return verified;
}
