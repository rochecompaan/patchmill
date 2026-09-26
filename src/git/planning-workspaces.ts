import type { CommandResult } from "../command/types.ts";
import type { PlanningPhaseKind } from "../workflow/planning-pull-request-markers.ts";

export type PlanningWorkspaceIdentity = Readonly<{
  branch: string;
  worktreePath: string;
}>;

export type PlanningArtifactCandidates = Readonly<{
  spec: readonly string[];
  plan: readonly string[];
}>;

export type PlanningRemoteBaseSnapshot = Readonly<{
  remote: string;
  baseBranch: string;
  baseOid: string;
  artifactCandidates: PlanningArtifactCandidates;
}>;

export type PlanningWorkspaceCleanupPending = Readonly<{
  state: "cleanup-pending";
  reason: "ignored-worktree-content";
  ignoredPaths: readonly string[];
}>;

export type PlanningWorkspaceCleanup =
  | Readonly<{ state: "ready" }>
  | PlanningWorkspaceCleanupPending
  | Readonly<{ state: "worktree-removed"; pushedHeadOid: string }>
  | Readonly<{ state: "removed"; pushedHeadOid: string }>;

export type PlanningHeadAdoptionFailure =
  | "remote-missing"
  | "head-disagreement"
  | "not-descendant"
  | "unexpected-paths"
  | "non-regular-artifact"
  | "head-moved";

export type PlanningHeadAdoptionBlockedEvidence = Readonly<{
  failure: PlanningHeadAdoptionFailure;
  recordedHeadOid: string;
  hostHeadOid?: string;
  fetchedHeadOid?: string;
  remoteHeadOid?: string;
  artifactPaths: readonly string[];
  unexpectedPaths: readonly string[];
  cleanupState: PlanningWorkspaceCleanup["state"];
}>;

export type PlanningHeadAdoptionResult =
  | Readonly<{ kind: "adopted"; headOid: string }>
  | Readonly<{
      kind: "blocked";
      evidence: PlanningHeadAdoptionBlockedEvidence;
    }>;

export type PlanningHeadAdoptionInput = Readonly<{
  issueNumber: number;
  runId: string;
  phase: PlanningPhaseKind;
  workspace: PlanningWorkspaceOwnership;
  hostHeadOid: string;
  artifactPaths: readonly string[];
}>;

export type PlanningWorkspaceBranchRemovalAuthorization =
  | Readonly<{ kind: "publication" }>
  | Readonly<{ kind: "merged-terminal" }>;

export type PlanningWorkspaceRemovalOutcome =
  | Readonly<{
      kind: "removed";
      snapshot: Extract<
        PlanningWorkspaceSnapshot,
        { state: "branch-only" | "missing" }
      >;
    }>
  | Readonly<{
      kind: "cleanup-pending";
      reason: "ignored-worktree-content";
      ignoredPaths: readonly string[];
    }>;

export type PlanningWorkspaceOwnership<
  Cleanup extends PlanningWorkspaceCleanup = PlanningWorkspaceCleanup,
> = Readonly<{
  runId: string;
  phase: PlanningPhaseKind;
  identity: PlanningWorkspaceIdentity;
  remote: string;
  baseBranch: string;
  baseOid: string;
  headOid: string;
  cleanup: Cleanup;
}>;

export type PlanningWorkspaceSnapshot =
  | Readonly<{ state: "missing"; identity: PlanningWorkspaceIdentity }>
  | Readonly<{
      state: "branch-only";
      identity: PlanningWorkspaceIdentity;
      headOid: string;
    }>
  | Readonly<{
      state: "ready";
      identity: PlanningWorkspaceIdentity;
      headOid: string;
      clean: boolean;
    }>;

export type PreparedPlanningWorkspace = Readonly<{
  created: true;
  base: PlanningRemoteBaseSnapshot;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  snapshot: Extract<PlanningWorkspaceSnapshot, { state: "ready" }>;
}>;

export type PlanningWorkspaceConflictReason =
  | "invalid-saved-identity"
  | "branch-collision"
  | "path-collision"
  | "path-owned-by-other-branch"
  | "branch-owned-by-other-worktree"
  | "unregistered-path"
  | "detached-worktree"
  | "unsafe-registration"
  | "base-oid-mismatch"
  | "head-oid-mismatch"
  | "dirty-worktree"
  | "remote-head-mismatch"
  | "outside-worktree-root"
  | "missing-workspace";

export class PlanningWorkspaceConflictError extends Error {
  readonly reason: PlanningWorkspaceConflictReason;
  readonly identity: PlanningWorkspaceIdentity;

  constructor(
    reason: PlanningWorkspaceConflictReason,
    identity: PlanningWorkspaceIdentity,
  ) {
    super(`Planning workspace is unsafe: ${reason}`);
    this.name = "PlanningWorkspaceConflictError";
    this.reason = reason;
    this.identity = identity;
  }
}

export type PlanningWorkspaceOperation =
  | "fetch"
  | "ref-resolution"
  | "tree-inspection"
  | "worktree-inspection"
  | "worktree-add"
  | "worktree-remove"
  | "status"
  | "remote-head-inspection"
  | "branch-deletion"
  | "head-adoption-fetch"
  | "head-adoption-proof"
  | "head-adoption-fast-forward";

export class PlanningWorkspaceCommandError extends Error {
  readonly operation: PlanningWorkspaceOperation;
  readonly exitCode: number;

  constructor(operation: PlanningWorkspaceOperation, result: CommandResult) {
    super(`Planning workspace command failed: ${operation} (${result.code})`);
    this.name = "PlanningWorkspaceCommandError";
    this.operation = operation;
    this.exitCode = result.code;
    Object.defineProperty(this, "diagnostics", {
      enumerable: false,
      value: Object.freeze({ ...result }),
    });
  }

  declare readonly diagnostics: Readonly<CommandResult>;
}

export class PlanningWorkspaceResponseError extends Error {
  readonly operation: PlanningWorkspaceOperation;
  readonly reason: string;

  constructor(operation: PlanningWorkspaceOperation, reason: string) {
    super(`Planning workspace response is invalid: ${operation}/${reason}`);
    this.name = "PlanningWorkspaceResponseError";
    this.operation = operation;
    this.reason = reason;
  }
}

export interface PlanningWorkspaceLifecycle {
  prepare(input: {
    runId: string;
    phase: PlanningPhaseKind;
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
  }): Promise<PreparedPlanningWorkspace>;
  resume(input: {
    runId: string;
    phase: PlanningPhaseKind;
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
    saved: PlanningWorkspaceOwnership;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "ready" }>>;
  inspect(
    identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot>;
  adoptPlanningHead(
    input: PlanningHeadAdoptionInput,
  ): Promise<PlanningHeadAdoptionResult>;
  removeWorktree(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<
      { state: "ready" } | PlanningWorkspaceCleanupPending
    >;
  }): Promise<PlanningWorkspaceRemovalOutcome>;
  removeBranch(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{
      state: "worktree-removed";
      pushedHeadOid: string;
    }>;
    authorization: PlanningWorkspaceBranchRemovalAuthorization;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>>;
}
