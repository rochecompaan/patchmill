export type PlanningWorkspaceIdentity = {
  readonly branch: string;
  readonly worktreePath: string;
};

export type PlanningWorkspaceSnapshot =
  | {
      readonly state: "missing";
      readonly identity: PlanningWorkspaceIdentity;
    }
  | {
      readonly state: "branch-only";
      readonly identity: PlanningWorkspaceIdentity;
      readonly headSha: string;
    }
  | {
      readonly state: "ready";
      readonly identity: PlanningWorkspaceIdentity;
      readonly headSha: string;
      readonly clean: boolean;
    };

export type PreparedPlanningWorkspace = {
  readonly created: boolean;
  readonly remote: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly snapshot: Extract<PlanningWorkspaceSnapshot, { state: "ready" }>;
};

export type PlanningWorkspaceConflictReason =
  | "path-owned-by-other-branch"
  | "branch-owned-by-other-worktree"
  | "unregistered-path"
  | "detached-worktree"
  | "base-sha-mismatch"
  | "head-sha-mismatch"
  | "dirty-worktree"
  | "head-not-pushed";

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

export interface PlanningWorkspaceLifecycle {
  prepare(input: {
    identity: PlanningWorkspaceIdentity;
    remote: string;
    baseBranch: string;
    resume?: {
      baseSha: string;
      headSha: string;
    };
  }): Promise<PreparedPlanningWorkspace>;

  inspect(
    identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot>;

  removeWorktree(
    identity: PlanningWorkspaceIdentity,
  ): Promise<Extract<PlanningWorkspaceSnapshot, { state: "branch-only" }>>;

  removeBranch(input: {
    identity: PlanningWorkspaceIdentity;
    pushedHeadSha: string;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>>;
}
