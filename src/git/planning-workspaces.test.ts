import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningWorkspaceConflictError,
  type PlanningWorkspaceIdentity,
  type PlanningWorkspaceLifecycle,
  type PlanningWorkspaceSnapshot,
  type PreparedPlanningWorkspace,
} from "./planning-workspaces.ts";

const identity: PlanningWorkspaceIdentity = {
  branch: "agent/issue-184-foundations-spec",
  worktreePath: ".worktrees/patchmill-issue-184-foundations-spec",
};

class FakePlanningWorkspace implements PlanningWorkspaceLifecycle {
  readonly events: string[] = [];
  private snapshot: PlanningWorkspaceSnapshot = {
    state: "missing",
    identity,
  };

  async prepare(input: {
    identity: PlanningWorkspaceIdentity;
    remote: string;
    baseBranch: string;
    resume?: { baseSha: string; headSha: string };
  }): Promise<PreparedPlanningWorkspace> {
    this.events.push("prepare");
    const headSha = input.resume?.headSha ?? "head-1";
    const snapshot: Extract<PlanningWorkspaceSnapshot, { state: "ready" }> = {
      state: "ready",
      identity: input.identity,
      headSha,
      clean: true,
    };
    this.snapshot = snapshot;
    return {
      created: input.resume === undefined,
      remote: input.remote,
      baseBranch: input.baseBranch,
      baseSha: input.resume?.baseSha ?? "base-1",
      snapshot,
    };
  }

  async inspect(
    _identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot> {
    this.events.push("inspect");
    return this.snapshot;
  }

  async removeWorktree(
    _identity: PlanningWorkspaceIdentity,
  ): Promise<Extract<PlanningWorkspaceSnapshot, { state: "branch-only" }>> {
    this.events.push("remove-worktree");
    if (this.snapshot.state !== "ready") {
      throw new PlanningWorkspaceConflictError(
        "branch-owned-by-other-worktree",
        identity,
      );
    }
    if (!this.snapshot.clean) {
      throw new PlanningWorkspaceConflictError("dirty-worktree", identity);
    }
    this.snapshot = {
      state: "branch-only",
      identity,
      headSha: this.snapshot.headSha,
    };
    return this.snapshot;
  }

  async removeBranch(input: {
    identity: PlanningWorkspaceIdentity;
    pushedHeadSha: string;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>> {
    this.events.push("remove-branch");
    if (
      this.snapshot.state !== "branch-only" ||
      this.snapshot.headSha !== input.pushedHeadSha
    ) {
      throw new PlanningWorkspaceConflictError("head-not-pushed", identity);
    }
    this.snapshot = { state: "missing", identity: input.identity };
    return this.snapshot;
  }
}

test("a coordinator can use the workspace lifecycle without Git commands", async () => {
  const workspace = new FakePlanningWorkspace();
  const prepared = await workspace.prepare({
    identity,
    remote: "origin",
    baseBranch: "main",
  });

  assert.equal(prepared.created, true);
  assert.equal(prepared.baseSha, "base-1");
  assert.deepEqual(await workspace.inspect(identity), prepared.snapshot);

  const branchOnly = await workspace.removeWorktree(identity);
  assert.equal(branchOnly.state, "branch-only");

  const missing = await workspace.removeBranch({
    identity,
    pushedHeadSha: "head-1",
  });
  assert.equal(missing.state, "missing");
  assert.deepEqual(workspace.events, [
    "prepare",
    "inspect",
    "remove-worktree",
    "remove-branch",
  ]);
});

test("workspace conflict error keeps the reason and identity", () => {
  const error = new PlanningWorkspaceConflictError(
    "unregistered-path",
    identity,
  );

  assert.equal(error.name, "PlanningWorkspaceConflictError");
  assert.equal(error.reason, "unregistered-path");
  assert.deepEqual(error.identity, identity);
});
