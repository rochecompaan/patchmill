import { isDeepStrictEqual } from "node:util";
import type {
  PlanningArtifactEvidence,
  PlanningPhaseStateV1,
  PlanningPullRequestEvidence,
  PlanningWorkspaceEvidence,
} from "./planning-state-types.ts";
import { PlanningStateValidationError } from "./planning-state-validation.ts";

type PhaseName =
  | "pending"
  | "workspace-ready"
  | "pull-request-open"
  | "complete-remote-base"
  | "complete-merged-ready"
  | "complete-merged-worktree-removed"
  | "complete-merged-removed";

function phaseName(phase: PlanningPhaseStateV1): PhaseName {
  if (phase.status !== "complete") return phase.status;
  if (phase.completion.kind === "remote-base") return "complete-remote-base";
  if ("workspace" in phase) {
    return `complete-merged-${phase.workspace.cleanup.state}`;
  }
  throw new TypeError("Merged planning phase requires workspace evidence");
}

const allowedTransitions: Readonly<Record<PhaseName, readonly PhaseName[]>> = {
  pending: ["pending", "workspace-ready", "complete-remote-base"],
  "workspace-ready": ["workspace-ready", "pull-request-open"],
  "pull-request-open": ["pull-request-open", "complete-merged-ready"],
  "complete-remote-base": ["complete-remote-base"],
  "complete-merged-ready": [
    "complete-merged-ready",
    "complete-merged-worktree-removed",
  ],
  "complete-merged-worktree-removed": [
    "complete-merged-worktree-removed",
    "complete-merged-removed",
  ],
  "complete-merged-removed": ["complete-merged-removed"],
};

function fail(reason: string, index: number, suffix = ""): never {
  throw new PlanningStateValidationError(reason, `$.phases[${index}]${suffix}`);
}

function assertSame(value: unknown, next: unknown, index: number): void {
  if (!isDeepStrictEqual(value, next)) fail("immutable-evidence", index);
}

function workspaceStableEvidence(workspace: PlanningWorkspaceEvidence) {
  const { headOid: _headOid, cleanup: _cleanup, ...stable } = workspace;
  return stable;
}

function assertWorkspace(
  current: PlanningWorkspaceEvidence,
  next: PlanningWorkspaceEvidence,
  allowHeadAdvance: boolean,
  index: number,
): void {
  assertSame(
    workspaceStableEvidence(current),
    workspaceStableEvidence(next),
    index,
  );
  if (allowHeadAdvance) {
    if (current.cleanup.state !== "ready" || next.cleanup.state !== "ready") {
      fail("immutable-evidence", index);
    }
    return;
  }
  if (current.headOid !== next.headOid) fail("immutable-evidence", index);
  if (current.cleanup.state === next.cleanup.state) {
    assertSame(current.cleanup, next.cleanup, index);
    return;
  }
  if (
    current.cleanup.state === "ready" &&
    next.cleanup.state === "worktree-removed" &&
    next.cleanup.pushedHeadOid === current.headOid
  ) {
    return;
  }
  if (
    current.cleanup.state === "worktree-removed" &&
    next.cleanup.state === "removed" &&
    next.cleanup.pushedHeadOid === current.cleanup.pushedHeadOid
  ) {
    return;
  }
  fail("invalid-cleanup-transition", index, ".workspace.cleanup");
}

function artifactStableEvidence(artifact: PlanningArtifactEvidence) {
  const { commitOid: _commitOid, ...stable } = artifact;
  return stable;
}

function assertArtifacts(
  current: readonly PlanningArtifactEvidence[],
  next: readonly PlanningArtifactEvidence[],
  allowHeadAdvance: boolean,
  index: number,
): void {
  if (current.length !== next.length) fail("immutable-evidence", index);
  for (let item = 0; item < current.length; item += 1) {
    const left = current[item]!;
    const right = next[item]!;
    assertSame(
      artifactStableEvidence(left),
      artifactStableEvidence(right),
      index,
    );
    if (
      left.commitOid !== right.commitOid &&
      !(allowHeadAdvance && left.source === "workspace")
    ) {
      fail("immutable-evidence", index);
    }
  }
}

function pullRequestStableEvidence(pullRequest: PlanningPullRequestEvidence) {
  const { headOid: _headOid, ...stable } = pullRequest;
  return stable;
}

function assertPullRequest(
  current: PlanningPullRequestEvidence,
  next: PlanningPullRequestEvidence,
  allowHeadAdvance: boolean,
  index: number,
): void {
  assertSame(
    pullRequestStableEvidence(current),
    pullRequestStableEvidence(next),
    index,
  );
  if (!allowHeadAdvance && current.headOid !== next.headOid) {
    fail("immutable-evidence", index);
  }
}

export function assertPlanningPhaseReplacement(
  current: PlanningPhaseStateV1,
  next: PlanningPhaseStateV1,
  index: number,
): void {
  const currentName = phaseName(current);
  const nextName = phaseName(next);
  if (!allowedTransitions[currentName].includes(nextName)) {
    fail("invalid-transition", index, ".status");
  }
  if (current.status === "pending") return;
  if (
    current.status === "complete" &&
    current.completion.kind === "remote-base"
  ) {
    assertSame(current, next, index);
    return;
  }
  if (current.status === "workspace-ready") {
    if (
      next.status !== "workspace-ready" &&
      next.status !== "pull-request-open"
    ) {
      fail("invalid-transition", index, ".status");
    }
    assertSame(current.base, next.base, index);
    assertWorkspace(current.workspace, next.workspace, true, index);
    return;
  }
  if (current.status === "pull-request-open") {
    if (
      next.status !== "pull-request-open" &&
      !(
        next.status === "complete" &&
        next.completion.kind === "merged-pull-request" &&
        "workspace" in next
      )
    ) {
      fail("invalid-transition", index, ".status");
    }
    assertSame(current.base, next.base, index);
    assertWorkspace(current.workspace, next.workspace, true, index);
    assertArtifacts(current.artifacts, next.artifacts, true, index);
    assertPullRequest(current.pullRequest, next.pullRequest, true, index);
    return;
  }
  if (
    current.completion.kind !== "merged-pull-request" ||
    !("workspace" in current) ||
    next.status !== "complete" ||
    next.completion.kind !== "merged-pull-request" ||
    !("workspace" in next)
  ) {
    fail("invalid-transition", index, ".status");
  }
  const allowHeadAdvance =
    current.workspace.cleanup.state === "ready" &&
    next.workspace.cleanup.state === "ready";
  assertSame(current.base, next.base, index);
  assertWorkspace(current.workspace, next.workspace, allowHeadAdvance, index);
  assertArtifacts(current.artifacts, next.artifacts, allowHeadAdvance, index);
  assertPullRequest(
    current.pullRequest,
    next.pullRequest,
    allowHeadAdvance,
    index,
  );
  if (current.completion.mergeOid !== next.completion.mergeOid) {
    fail("immutable-evidence", index);
  }
}
