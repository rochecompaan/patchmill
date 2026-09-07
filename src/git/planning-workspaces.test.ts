import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningWorkspaceConflictError,
  type PlanningRemoteBaseSnapshot,
  type PlanningWorkspaceIdentity,
  type PlanningWorkspaceLifecycle,
  type PlanningWorkspaceOwnership,
  type PlanningWorkspaceSnapshot,
  type PreparedPlanningWorkspace,
} from "./planning-workspaces.ts";

const identity: PlanningWorkspaceIdentity = {
  branch: "agent/issue-184-foundations-spec",
  worktreePath: ".worktrees/patchmill-issue-184-foundations-spec",
};
const base: PlanningRemoteBaseSnapshot = {
  remote: "origin",
  baseBranch: "main",
  baseOid: "a".repeat(40),
  artifactCandidates: { spec: [], plan: [] },
};

class FakePlanningWorkspace implements PlanningWorkspaceLifecycle {
  readonly events: string[] = [];
  private snapshot: PlanningWorkspaceSnapshot = { state: "missing", identity };

  async prepare(input: {
    runId: string;
    phase: "spec" | "plan" | "implementation";
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
  }): Promise<PreparedPlanningWorkspace> {
    this.events.push("prepare");
    const snapshot = {
      state: "ready" as const,
      identity: input.identity,
      headOid: input.base.baseOid,
      clean: true,
    };
    this.snapshot = snapshot;
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
        headOid: input.base.baseOid,
        cleanup: { state: "ready" },
      },
      snapshot,
    };
  }

  async resume(input: {
    runId: string;
    phase: "spec" | "plan" | "implementation";
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
    saved: PlanningWorkspaceOwnership;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "ready" }>> {
    this.events.push("resume");
    assert.equal(input.saved.runId, input.runId);
    assert.equal(input.saved.phase, input.phase);
    assert.deepEqual(input.saved.identity, input.identity);
    assert.deepEqual(input.base, base);
    if (this.snapshot.state !== "ready") throw new Error("not ready");
    return this.snapshot;
  }

  async inspect(
    identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot> {
    this.events.push("inspect");
    assert.deepEqual(identity, this.snapshot.identity);
    return this.snapshot;
  }

  async removeWorktree(input: {
    runId: string;
    phase: "spec" | "plan" | "implementation";
    workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  }): Promise<
    Extract<PlanningWorkspaceSnapshot, { state: "branch-only" | "missing" }>
  > {
    this.events.push("remove-worktree");
    assert.equal(input.runId, input.workspace.runId);
    assert.equal(input.phase, input.workspace.phase);
    if (this.snapshot.state !== "ready")
      throw new PlanningWorkspaceConflictError("unsafe-registration", identity);
    this.snapshot = {
      state: "branch-only",
      identity,
      headOid: this.snapshot.headOid,
    };
    return this.snapshot;
  }

  async removeBranch(input: {
    runId: string;
    phase: "spec" | "plan" | "implementation";
    workspace: PlanningWorkspaceOwnership<{
      state: "worktree-removed";
      pushedHeadOid: string;
    }>;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>> {
    this.events.push("remove-branch");
    assert.equal(input.runId, input.workspace.runId);
    assert.equal(input.phase, input.workspace.phase);
    this.snapshot = { state: "missing", identity };
    return this.snapshot;
  }
}

test("a coordinator uses pinned base and saved workspace ownership", async () => {
  const workspace = new FakePlanningWorkspace();
  const prepared = await workspace.prepare({
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "spec",
    identity,
    base,
  });
  assert.equal(prepared.workspace.baseOid, base.baseOid);
  const resumed = await workspace.resume({
    runId: prepared.workspace.runId,
    phase: "spec",
    identity,
    base,
    saved: prepared.workspace,
  });
  assert.deepEqual(resumed, prepared.snapshot);
  const branchOnly = await workspace.removeWorktree({
    runId: prepared.workspace.runId,
    phase: "spec",
    workspace: prepared.workspace,
  });
  assert.equal(branchOnly.state, "branch-only");
  const missing = await workspace.removeBranch({
    runId: prepared.workspace.runId,
    phase: "spec",
    workspace: {
      ...prepared.workspace,
      cleanup: {
        state: "worktree-removed",
        pushedHeadOid: prepared.workspace.headOid,
      },
    },
  });
  assert.equal(missing.state, "missing");
  assert.deepEqual(workspace.events, [
    "prepare",
    "resume",
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
