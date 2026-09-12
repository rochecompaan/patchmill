import type { CommandRunner } from "../command/types.ts";
import type { PlanningPhaseKind } from "../workflow/planning-pull-request-markers.ts";
import { PlanningWorkspaceCleanupGit } from "./planning-workspace-cleanup.ts";
import { PlanningWorkspaceRepositoryGit } from "./planning-workspace-inspection.ts";
import { assertPlanningWorkspacePrepareInput } from "./planning-workspace-input.ts";
import {
  PlanningWorkspaceConflictError,
  type PlanningRemoteBaseSnapshot,
  type PlanningWorkspaceIdentity,
  type PlanningWorkspaceLifecycle,
  type PlanningWorkspaceOwnership,
  type PlanningWorkspaceSnapshot,
  type PreparedPlanningWorkspace,
} from "./planning-workspaces.ts";

export class PlanningWorkspaceGit implements PlanningWorkspaceLifecycle {
  readonly runner: CommandRunner;
  readonly repoRoot: string;
  readonly worktreeRoot: string;
  private readonly repository: PlanningWorkspaceRepositoryGit;
  private readonly cleanup: PlanningWorkspaceCleanupGit;

  constructor(input: {
    runner: CommandRunner;
    repoRoot: string;
    worktreeRoot: string;
  }) {
    this.repository = new PlanningWorkspaceRepositoryGit(input);
    this.cleanup = new PlanningWorkspaceCleanupGit(this.repository);
    this.runner = this.repository.runner;
    this.repoRoot = this.repository.repoRoot;
    this.worktreeRoot = this.repository.worktreeRoot;
  }

  inspect(
    identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot> {
    return this.repository.inspect(identity);
  }

  async prepare(input: {
    runId: string;
    phase: PlanningPhaseKind;
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
  }): Promise<PreparedPlanningWorkspace> {
    assertPlanningWorkspacePrepareInput(input);
    const path = this.repository.path(input.identity);
    const before = await this.repository.inspect(input.identity);
    if (before.state !== "missing" || (await this.repository.existing(path))) {
      throw new PlanningWorkspaceConflictError(
        before.state === "branch-only" ? "branch-collision" : "path-collision",
        input.identity,
      );
    }
    await this.repository.run(
      [
        "worktree",
        "add",
        "-b",
        input.identity.branch,
        "--",
        path,
        input.base.baseOid,
      ],
      "worktree-add",
    );
    const snapshot = await this.repository.inspect(input.identity);
    if (snapshot.state !== "ready" || snapshot.headOid !== input.base.baseOid) {
      throw new PlanningWorkspaceConflictError(
        "base-oid-mismatch",
        input.identity,
      );
    }
    return {
      created: true,
      base: input.base,
      workspace: {
        runId: input.runId,
        phase: input.phase,
        identity: input.identity,
        remote: input.base.remote,
        baseBranch: input.base.baseBranch,
        baseOid: input.base.baseOid,
        headOid: snapshot.headOid,
        cleanup: { state: "ready" },
      },
      snapshot,
    };
  }

  async resume(input: {
    runId: string;
    phase: PlanningPhaseKind;
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
    saved: PlanningWorkspaceOwnership;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "ready" }>> {
    const saved = input.saved;
    if (
      saved.runId !== input.runId ||
      saved.phase !== input.phase ||
      saved.identity.branch !== input.identity.branch ||
      saved.identity.worktreePath !== input.identity.worktreePath ||
      saved.remote !== input.base.remote ||
      saved.baseBranch !== input.base.baseBranch ||
      saved.baseOid !== input.base.baseOid ||
      saved.cleanup.state !== "ready"
    ) {
      throw new PlanningWorkspaceConflictError(
        "invalid-saved-identity",
        input.identity,
      );
    }
    const proof = await this.repository.run(
      ["rev-parse", "--verify", `${saved.baseOid}^{commit}`],
      "ref-resolution",
    );
    if (proof.stdout.trim() !== saved.baseOid) {
      throw new PlanningWorkspaceConflictError(
        "base-oid-mismatch",
        input.identity,
      );
    }
    const snapshot = await this.repository.inspect(input.identity);
    if (snapshot.state !== "ready" || snapshot.headOid !== saved.headOid) {
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        input.identity,
      );
    }
    return snapshot;
  }

  removeWorktree(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  }): Promise<
    Extract<PlanningWorkspaceSnapshot, { state: "branch-only" | "missing" }>
  > {
    return this.cleanup.removeWorktree(input);
  }

  removeBranch(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{
      state: "worktree-removed";
      pushedHeadOid: string;
    }>;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>> {
    return this.cleanup.removeBranch(input);
  }
}
