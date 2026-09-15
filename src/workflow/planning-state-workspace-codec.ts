import type {
  PlanningWorkspaceCleanup,
  PlanningWorkspaceIdentity,
  PlanningWorkspaceOwnership,
} from "../git/planning-workspaces.ts";
import {
  branch,
  fail,
  object,
  oid,
  phase,
  singleLine,
  string,
} from "./planning-state-codec.ts";

function ignoredPath(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (
    parsed.length === 0 ||
    parsed.length > 4096 ||
    parsed.includes("\0") ||
    parsed.startsWith("/") ||
    parsed.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(parsed) ||
    parsed.split(/[\\/]/u).includes("..")
  )
    fail("invalid-ignored-path", path);
  return parsed;
}

/** Decodes immutable phase-workspace evidence and raw ignored cleanup paths. */
export function planningWorkspaceEvidence(
  value: unknown,
  path: string,
): PlanningWorkspaceOwnership {
  const parsed = object(
    value,
    [
      "runId",
      "phase",
      "identity",
      "remote",
      "baseBranch",
      "baseOid",
      "headOid",
      "cleanup",
    ],
    path,
  );
  const identity = object(
    parsed.identity,
    ["branch", "worktreePath"],
    `${path}.identity`,
  );
  const worktreePath = string(
    identity.worktreePath,
    `${path}.identity.worktreePath`,
  );
  if (
    worktreePath.length === 0 ||
    worktreePath.length > 4096 ||
    /[\0\r\n]/u.test(worktreePath)
  )
    fail("invalid-worktree-path", `${path}.identity.worktreePath`);
  const cleanupRaw = parsed.cleanup as Record<string, unknown>;
  const cleanup = object(
    cleanupRaw,
    cleanupRaw?.state === "ready"
      ? ["state"]
      : cleanupRaw?.state === "cleanup-pending"
        ? ["state", "reason", "ignoredPaths"]
        : ["state", "pushedHeadOid"],
    `${path}.cleanup`,
  );
  const state = string(cleanup.state, `${path}.cleanup.state`);
  let cleanupEvidence!: PlanningWorkspaceCleanup;
  if (state === "ready") cleanupEvidence = { state: "ready" };
  else if (state === "cleanup-pending") {
    if (cleanup.reason !== "ignored-worktree-content")
      fail("invalid-cleanup", `${path}.cleanup.reason`);
    if (!Array.isArray(cleanup.ignoredPaths))
      fail("expected-array", `${path}.cleanup.ignoredPaths`);
    const ignoredPaths = (cleanup.ignoredPaths as unknown[]).map(
      (item, index) =>
        ignoredPath(item, `${path}.cleanup.ignoredPaths[${index}]`),
    );
    if (
      ignoredPaths.length === 0 ||
      new Set(ignoredPaths).size !== ignoredPaths.length
    )
      fail(
        ignoredPaths.length === 0 ? "invalid-cleanup" : "duplicate-value",
        `${path}.cleanup.ignoredPaths`,
      );
    cleanupEvidence = {
      state,
      reason: "ignored-worktree-content",
      ignoredPaths,
    };
  } else if (state === "worktree-removed" || state === "removed") {
    cleanupEvidence = {
      state,
      pushedHeadOid: oid(
        cleanup.pushedHeadOid,
        `${path}.cleanup.pushedHeadOid`,
      ),
    };
  } else fail("invalid-cleanup", `${path}.cleanup.state`);
  const runId = string(parsed.runId, `${path}.runId`);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      runId,
    )
  )
    fail("invalid-uuid", `${path}.runId`);
  return {
    runId,
    phase: phase(parsed.phase, `${path}.phase`),
    identity: {
      branch: branch(identity.branch, `${path}.identity.branch`),
      worktreePath,
    } as PlanningWorkspaceIdentity,
    remote: singleLine(parsed.remote, `${path}.remote`),
    baseBranch: branch(parsed.baseBranch, `${path}.baseBranch`),
    baseOid: oid(parsed.baseOid, `${path}.baseOid`),
    headOid: oid(parsed.headOid, `${path}.headOid`),
    cleanup: cleanupEvidence,
  } as PlanningWorkspaceOwnership;
}
