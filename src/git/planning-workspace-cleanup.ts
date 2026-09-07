import type { PlanningPhaseKind } from "../workflow/planning-pull-request-markers.ts";
import { PlanningWorkspaceRepositoryGit } from "./planning-workspace-inspection.ts";
import {
  PlanningWorkspaceConflictError,
  type PlanningWorkspaceOwnership,
  type PlanningWorkspaceSnapshot,
} from "./planning-workspaces.ts";

export class PlanningWorkspaceCleanupGit {
  private readonly repository: PlanningWorkspaceRepositoryGit;

  constructor(repository: PlanningWorkspaceRepositoryGit) {
    this.repository = repository;
  }

  async removeWorktree(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  }): Promise<
    Extract<PlanningWorkspaceSnapshot, { state: "branch-only" | "missing" }>
  > {
    const { workspace } = input;
    this.assertOwner(input.runId, input.phase, workspace);
    const snapshot = await this.repository.inspect(workspace.identity);
    const path = this.repository.path(workspace.identity);
    if (snapshot.state === "missing") {
      await this.assertPathAbsent(path, workspace);
      return snapshot;
    }
    if (snapshot.state === "branch-only") {
      await this.assertPathAbsent(path, workspace);
      this.assertHead(snapshot.headOid, workspace);
      return snapshot;
    }
    this.assertHead(snapshot.headOid, workspace);
    if (!snapshot.clean) {
      throw new PlanningWorkspaceConflictError(
        "dirty-worktree",
        workspace.identity,
      );
    }
    await this.repository.run(
      ["worktree", "remove", "--", path],
      "worktree-remove",
    );
    const after = await this.repository.inspect(workspace.identity);
    if (after.state === "ready") {
      throw new PlanningWorkspaceConflictError(
        "unsafe-registration",
        workspace.identity,
      );
    }
    return after;
  }

  async removeBranch(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{
      state: "worktree-removed";
      pushedHeadOid: string;
    }>;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>> {
    const { workspace } = input;
    this.assertOwner(input.runId, input.phase, workspace);
    this.assertHead(workspace.cleanup.pushedHeadOid, workspace);
    const current = await this.repository.inspect(workspace.identity);
    if (current.state === "ready") {
      throw new PlanningWorkspaceConflictError(
        "branch-owned-by-other-worktree",
        workspace.identity,
      );
    }
    await this.assertPathAbsent(
      this.repository.path(workspace.identity),
      workspace,
    );
    await this.assertRemoteHead(workspace);
    if (current.state === "branch-only") {
      this.assertHead(current.headOid, workspace);
      await this.repository.run(
        [
          "update-ref",
          "-d",
          `refs/heads/${workspace.identity.branch}`,
          workspace.headOid,
        ],
        "branch-deletion",
      );
    }
    const after = await this.repository.inspect(workspace.identity);
    if (after.state !== "missing") {
      throw new PlanningWorkspaceConflictError(
        "unsafe-registration",
        workspace.identity,
      );
    }
    return after;
  }

  private assertOwner(
    runId: string,
    phase: PlanningPhaseKind,
    workspace: PlanningWorkspaceOwnership,
  ): void {
    if (runId !== workspace.runId || phase !== workspace.phase) {
      throw new PlanningWorkspaceConflictError(
        "invalid-saved-identity",
        workspace.identity,
      );
    }
  }

  private assertHead(
    actual: string,
    workspace: PlanningWorkspaceOwnership,
  ): void {
    if (actual !== workspace.headOid) {
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        workspace.identity,
      );
    }
  }

  private async assertPathAbsent(
    path: string,
    workspace: PlanningWorkspaceOwnership,
  ): Promise<void> {
    if (await this.repository.existing(path)) {
      throw new PlanningWorkspaceConflictError(
        "unregistered-path",
        workspace.identity,
      );
    }
  }

  private async assertRemoteHead(
    workspace: PlanningWorkspaceOwnership<{
      state: "worktree-removed";
      pushedHeadOid: string;
    }>,
  ): Promise<void> {
    const remote = await this.repository.run(
      [
        "ls-remote",
        "--exit-code",
        "--heads",
        "--",
        workspace.remote,
        `refs/heads/${workspace.identity.branch}`,
      ],
      "remote-head-inspection",
    );
    const expected = `${workspace.cleanup.pushedHeadOid}\trefs/heads/${workspace.identity.branch}\n`;
    if (remote.stdout !== expected) {
      throw new PlanningWorkspaceConflictError(
        "remote-head-mismatch",
        workspace.identity,
      );
    }
  }
}
