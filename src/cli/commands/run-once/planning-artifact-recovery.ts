import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import {
  PlanningWorkspaceConflictError,
  type PlanningWorkspaceLifecycle,
} from "../../../git/planning-workspaces.ts";
import type { PlannedPhase } from "../../../workflow/planning-pull-requests.ts";
import {
  appendPlanningArtifactEvidence,
  PlanningPhaseArtifactError,
  type PlanningArtifactCheckpoint,
  type PlanningArtifactWorkspacePhase,
} from "./planning-phase-artifacts.ts";

type RecoveryInput = {
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

/** Recovers one committed artifact without advancing the saved head before proof. */
export async function reconcilePlanningWorkspaceArtifact(
  input: RecoveryInput,
): Promise<PlanningArtifactWorkspacePhase> {
  const { current } = input;
  const kind = input.phase.artifactKinds.find(
    (kind) => !current.artifacts.some((artifact) => artifact.kind === kind),
  );
  if (kind === undefined) return current;
  const ownership = {
    runId: input.runId,
    phase: current.kind,
    identity: current.workspace.identity,
    base: current.base,
    saved: current.workspace,
  };
  try {
    await input.workspaces.resume(ownership);
    return current;
  } catch (error) {
    if (
      !(error instanceof PlanningWorkspaceConflictError) ||
      error.reason !== "head-oid-mismatch"
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
  if (!live.clean)
    throw new PlanningPublicationGitError("status", "dirty-workspace");
  await input.git.assertAncestor({
    ancestorOid: current.workspace.headOid,
    descendantOid: observed.headOid,
  });
  const candidates = await input.git.inspectArtifactCandidates({
    commitOid: observed.headOid,
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
  await input.git.verifyArtifactCommit({
    workspacePath: current.workspace.identity.worktreePath,
    previousHeadOid: current.workspace.headOid,
    headOid: observed.headOid,
    artifactPath: path,
  });
  // Re-prove registration, exact HEAD, and ordinary cleanliness at the checkpoint edge.
  const verified = await input.workspaces.resume(liveOwnership);
  if (!verified.clean)
    throw new PlanningPublicationGitError("status", "dirty-workspace");
  const next = appendPlanningArtifactEvidence(current, input.phase, {
    kind,
    path,
    source: "workspace",
    commitOid: observed.headOid,
  });
  await input.checkpoint(next);
  return next;
}
