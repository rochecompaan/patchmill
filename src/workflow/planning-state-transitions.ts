import { isDeepStrictEqual } from "node:util";
import type {
  PlanningArtifactEvidence,
  PlanningPhaseStateV1,
  PlanningWorkspaceEvidence,
} from "./planning-state-types.ts";
import { PlanningStateValidationError } from "./planning-state-validation.ts";

type PhaseName =
  | "pending"
  | "workspace-ready"
  | "branch-pushed"
  | "pull-request-open-ready"
  | "pull-request-open-worktree-removed"
  | "pull-request-open-removed"
  | "complete-remote-base"
  | "complete-merged";
function phaseName(phase: PlanningPhaseStateV1): PhaseName {
  if (phase.status === "complete")
    return phase.completion.kind === "remote-base"
      ? "complete-remote-base"
      : "complete-merged";
  if (phase.status !== "pull-request-open") return phase.status;
  return `pull-request-open-${phase.workspace.cleanup.state}`;
}
const allowed: Readonly<Record<PhaseName, readonly PhaseName[]>> = {
  pending: ["pending", "workspace-ready", "complete-remote-base"],
  "workspace-ready": ["workspace-ready", "branch-pushed"],
  "branch-pushed": ["branch-pushed", "pull-request-open-ready"],
  "pull-request-open-ready": [
    "pull-request-open-ready",
    "pull-request-open-worktree-removed",
  ],
  "pull-request-open-worktree-removed": [
    "pull-request-open-worktree-removed",
    "pull-request-open-removed",
  ],
  "pull-request-open-removed": ["pull-request-open-removed", "complete-merged"],
  "complete-remote-base": ["complete-remote-base"],
  "complete-merged": ["complete-merged"],
};
function fail(reason: string, index: number, suffix = ""): never {
  throw new PlanningStateValidationError(reason, `$.phases[${index}]${suffix}`);
}
function same(left: unknown, right: unknown, index: number): void {
  if (!isDeepStrictEqual(left, right)) fail("immutable-evidence", index);
}
function workspaceStable(
  workspace: PlanningWorkspaceEvidence,
  allowHeadAdvance: boolean,
) {
  const { cleanup: _cleanup, headOid: _headOid, ...stable } = workspace;
  return allowHeadAdvance ? stable : { ...stable, headOid: workspace.headOid };
}
function assertWorkspace(
  current: PlanningWorkspaceEvidence,
  next: PlanningWorkspaceEvidence,
  allowHeadAdvance: boolean,
  index: number,
): void {
  same(
    workspaceStable(current, allowHeadAdvance),
    workspaceStable(next, allowHeadAdvance),
    index,
  );
  if (!allowHeadAdvance && current.headOid !== next.headOid)
    fail("immutable-evidence", index);
  if (current.cleanup.state === next.cleanup.state) {
    same(current.cleanup, next.cleanup, index);
    return;
  }
  if (
    current.cleanup.state === "ready" &&
    next.cleanup.state === "worktree-removed" &&
    next.cleanup.pushedHeadOid === current.headOid
  )
    return;
  if (
    current.cleanup.state === "worktree-removed" &&
    next.cleanup.state === "removed" &&
    next.cleanup.pushedHeadOid === current.cleanup.pushedHeadOid
  )
    return;
  fail("invalid-cleanup-transition", index, ".workspace.cleanup");
}
function assertArtifacts(
  current: readonly PlanningArtifactEvidence[],
  next: readonly PlanningArtifactEvidence[],
  allowAppend: boolean,
  allowMergeConversion: boolean,
  index: number,
): void {
  if (
    next.length < current.length ||
    (!allowAppend && next.length !== current.length)
  )
    fail("immutable-evidence", index);
  for (let offset = 0; offset < current.length; offset += 1) {
    const left = current[offset]!;
    const right = next[offset]!;
    if (left.kind !== right.kind || left.path !== right.path)
      fail("immutable-evidence", index);
    if (allowMergeConversion) continue;
    if (left.source !== right.source) fail("immutable-evidence", index);
    if (
      left.commitOid !== right.commitOid &&
      !(allowAppend && left.source === "workspace")
    )
      fail("immutable-evidence", index);
  }
}
export function assertPlanningPhaseReplacement(
  current: PlanningPhaseStateV1,
  next: PlanningPhaseStateV1,
  index: number,
): void {
  const from = phaseName(current);
  const to = phaseName(next);
  if (!allowed[from].includes(to)) fail("invalid-transition", index, ".status");
  if (current.status === "pending") {
    if (next.status === "pending") same(current, next, index);
    return;
  }
  if (current.status === "complete") {
    same(current, next, index);
    return;
  }
  if (current.status === "workspace-ready") {
    if (next.status !== "workspace-ready" && next.status !== "branch-pushed")
      fail("invalid-transition", index, ".status");
    same(current.base, next.base, index);
    const appendingArtifact =
      next.status === "workspace-ready" &&
      next.artifacts.length === current.artifacts.length + 1;
    if (
      next.status === "workspace-ready" &&
      next.artifacts.length > current.artifacts.length + 1
    )
      fail("invalid-transition", index, ".artifacts");
    assertWorkspace(
      current.workspace,
      next.workspace,
      appendingArtifact,
      index,
    );
    assertArtifacts(
      current.artifacts,
      next.artifacts,
      appendingArtifact,
      false,
      index,
    );
    return;
  }
  if (current.status === "branch-pushed") {
    if (next.status !== "branch-pushed" && next.status !== "pull-request-open")
      fail("invalid-transition", index, ".status");
    same(current.base, next.base, index);
    same(current.workspace, next.workspace, index);
    same(current.artifacts, next.artifacts, index);
    same(current.publication, next.publication, index);
    return;
  }
  if (next.status === "pull-request-open") {
    same(current.base, next.base, index);
    assertWorkspace(current.workspace, next.workspace, false, index);
    same(current.artifacts, next.artifacts, index);
    same(current.publication, next.publication, index);
    same(current.pullRequest, next.pullRequest, index);
    return;
  }
  if (
    next.status !== "complete" ||
    next.completion.kind !== "merged-pull-request" ||
    !("workspace" in next) ||
    !("publication" in next) ||
    !("pullRequest" in next)
  )
    fail("invalid-transition", index, ".status");
  same(current.base, next.base, index);
  same(current.workspace, next.workspace, index);
  same(current.publication, next.publication, index);
  same(current.pullRequest, next.pullRequest, index);
  assertArtifacts(current.artifacts, next.artifacts, false, true, index);
}
