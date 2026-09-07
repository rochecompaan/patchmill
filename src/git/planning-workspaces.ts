import type { CommandResult } from "../process/command.ts";
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

export type PlanningWorkspaceCleanup =
  | Readonly<{ state: "ready" }>
  | Readonly<{ state: "worktree-removed"; pushedHeadOid: string }>
  | Readonly<{ state: "removed"; pushedHeadOid: string }>;

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
  | "branch-deletion";

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
  removeWorktree(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  }): Promise<
    Extract<PlanningWorkspaceSnapshot, { state: "branch-only" | "missing" }>
  >;
  removeBranch(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{
      state: "worktree-removed";
      pushedHeadOid: string;
    }>;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>>;
}
