import { relative, resolve } from "node:path";
import type { PlanningPhaseKind } from "../workflow/planning-pull-request-markers.ts";
import {
  isPlanningArtifactPath,
  isPlanningBranch,
  isPlanningSingleLine,
  planningOid,
} from "./planning-git-validation.ts";
import {
  PlanningWorkspaceConflictError,
  type PlanningRemoteBaseSnapshot,
  type PlanningWorkspaceIdentity,
} from "./planning-workspaces.ts";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === keys.length &&
    keys.every((key) => key in (value as Record<string, unknown>))
  );
}
export function planningWorkspacePath(
  repoRoot: string,
  worktreeRoot: string,
  identity: PlanningWorkspaceIdentity,
): string {
  const path = resolve(repoRoot, identity.worktreePath);
  const relativePath = relative(worktreeRoot, path).replaceAll("\\", "/");
  if (relativePath === ".." || relativePath.startsWith("../"))
    throw new PlanningWorkspaceConflictError("outside-worktree-root", identity);
  return path;
}
export function assertPlanningWorkspacePrepareInput(input: {
  runId: string;
  phase: PlanningPhaseKind;
  identity: PlanningWorkspaceIdentity;
  base: PlanningRemoteBaseSnapshot;
}): void {
  if (
    !exact(input, ["runId", "phase", "identity", "base"]) ||
    !uuid.test(input.runId) ||
    !["spec", "plan", "implementation"].includes(input.phase) ||
    !exact(input.identity, ["branch", "worktreePath"]) ||
    !isPlanningBranch(input.identity.branch) ||
    !isPlanningSingleLine(input.identity.worktreePath, 4096) ||
    !exact(input.base, [
      "remote",
      "baseBranch",
      "baseOid",
      "artifactCandidates",
    ]) ||
    !isPlanningSingleLine(input.base.remote) ||
    !isPlanningBranch(input.base.baseBranch) ||
    !planningOid.test(input.base.baseOid) ||
    !exact(input.base.artifactCandidates, ["spec", "plan"])
  )
    throw new PlanningWorkspaceConflictError(
      "invalid-saved-identity",
      input.identity,
    );
  for (const values of [
    input.base.artifactCandidates.spec,
    input.base.artifactCandidates.plan,
  ])
    if (
      !Array.isArray(values) ||
      values.some((value) => !isPlanningArtifactPath(value)) ||
      new Set(values).size !== values.length
    )
      throw new PlanningWorkspaceConflictError(
        "invalid-saved-identity",
        input.identity,
      );
}
