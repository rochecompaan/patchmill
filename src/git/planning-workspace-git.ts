import { lstat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { CommandRunner } from "../process/command.ts";
import type { PlanningPhaseKind } from "../workflow/planning-pull-request-markers.ts";
import {
  parsePlanningWorktreePorcelain,
  type PlanningWorktreeRegistration,
} from "./planning-worktree-porcelain.ts";
import {
  PlanningWorkspaceCommandError,
  PlanningWorkspaceConflictError,
  PlanningWorkspaceResponseError,
  type PlanningRemoteBaseSnapshot,
  type PlanningWorkspaceIdentity,
  type PlanningWorkspaceLifecycle,
  type PlanningWorkspaceOwnership,
  type PlanningWorkspaceSnapshot,
  type PreparedPlanningWorkspace,
} from "./planning-workspaces.ts";
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
export class PlanningWorkspaceGit implements PlanningWorkspaceLifecycle {
  readonly runner: CommandRunner;
  readonly repoRoot: string;
  readonly worktreeRoot: string;
  constructor(input: {
    runner: CommandRunner;
    repoRoot: string;
    worktreeRoot: string;
  }) {
    this.runner = input.runner;
    this.repoRoot = resolve(input.repoRoot);
    this.worktreeRoot = resolve(input.worktreeRoot);
  }
  private path(identity: PlanningWorkspaceIdentity): string {
    const path = resolve(this.repoRoot, identity.worktreePath);
    const rel = relative(this.worktreeRoot, path);
    const portable = rel.replaceAll("\\", "/");
    if (portable === ".." || portable.startsWith("../"))
      throw new PlanningWorkspaceConflictError(
        "outside-worktree-root",
        identity,
      );
    return path;
  }
  private async run(
    args: string[],
    operation:
      | "worktree-inspection"
      | "worktree-add"
      | "worktree-remove"
      | "status"
      | "ref-resolution"
      | "remote-head-inspection"
      | "branch-deletion",
  ) {
    const result = await this.runner.run("git", args, { cwd: this.repoRoot });
    if (result.code !== 0)
      throw new PlanningWorkspaceCommandError(operation, result);
    return result;
  }
  private async entries(): Promise<readonly PlanningWorktreeRegistration[]> {
    const result = await this.run(
      ["worktree", "list", "--porcelain", "-z"],
      "worktree-inspection",
    );
    const parsed = parsePlanningWorktreePorcelain(result.stdout);
    if (parsed.malformed)
      throw new PlanningWorkspaceResponseError(
        "worktree-inspection",
        "malformed-porcelain",
      );
    return parsed.entries;
  }
  private async branchHead(branch: string): Promise<string | undefined> {
    const exists = await this.runner.run(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd: this.repoRoot },
    );
    if (exists.code === 1) return undefined;
    if (exists.code !== 0)
      throw new PlanningWorkspaceCommandError("ref-resolution", exists);
    const result = await this.run(
      ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
      "ref-resolution",
    );
    const oid = result.stdout.trim();
    if (!OID.test(oid))
      throw new PlanningWorkspaceResponseError(
        "ref-resolution",
        "invalid-object-id",
      );
    return oid;
  }
  private async clean(path: string): Promise<boolean> {
    const result = await this.run(
      [
        "--no-optional-locks",
        "-C",
        path,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignored=matching",
      ],
      "status",
    );
    return result.stdout === "";
  }
  private async existing(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  async inspect(
    identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot> {
    const path = this.path(identity);
    const entries = await this.entries();
    const entry = entries.find((item) => item.path === path);
    const branchElsewhere = entries.find(
      (item) => item.branch === identity.branch && item.path !== path,
    );
    if (branchElsewhere !== undefined)
      throw new PlanningWorkspaceConflictError(
        "branch-owned-by-other-worktree",
        identity,
      );
    const head = await this.branchHead(identity.branch);
    if (entry === undefined)
      return head === undefined
        ? { state: "missing", identity }
        : { state: "branch-only", identity, headOid: head };
    if (
      entry.branch !== identity.branch ||
      entry.detached ||
      entry.locked ||
      entry.prunable
    )
      throw new PlanningWorkspaceConflictError("unsafe-registration", identity);
    if (head === undefined || head !== entry.headOid)
      throw new PlanningWorkspaceConflictError("head-oid-mismatch", identity);
    return {
      state: "ready",
      identity,
      headOid: head,
      clean: await this.clean(path),
    };
  }
  async prepare(input: {
    runId: string;
    phase: PlanningPhaseKind;
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
  }): Promise<PreparedPlanningWorkspace> {
    const path = this.path(input.identity);
    if (!OID.test(input.base.baseOid))
      throw new PlanningWorkspaceConflictError(
        "base-oid-mismatch",
        input.identity,
      );
    const before = await this.inspect(input.identity);
    if (before.state !== "missing" || (await this.existing(path)))
      throw new PlanningWorkspaceConflictError(
        before.state === "branch-only" ? "branch-collision" : "path-collision",
        input.identity,
      );
    await this.run(
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
    const snapshot = await this.inspect(input.identity);
    if (snapshot.state !== "ready" || snapshot.headOid !== input.base.baseOid)
      throw new PlanningWorkspaceConflictError(
        "base-oid-mismatch",
        input.identity,
      );
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
    )
      throw new PlanningWorkspaceConflictError(
        "invalid-saved-identity",
        input.identity,
      );
    const proof = await this.run(
      ["rev-parse", "--verify", `${saved.baseOid}^{commit}`],
      "ref-resolution",
    );
    if (proof.stdout.trim() !== saved.baseOid)
      throw new PlanningWorkspaceConflictError(
        "base-oid-mismatch",
        input.identity,
      );
    const snapshot = await this.inspect(input.identity);
    if (snapshot.state !== "ready" || snapshot.headOid !== saved.headOid)
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        input.identity,
      );
    return snapshot;
  }
  async removeWorktree(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  }): Promise<
    Extract<PlanningWorkspaceSnapshot, { state: "branch-only" | "missing" }>
  > {
    const { workspace } = input;
    if (input.runId !== workspace.runId || input.phase !== workspace.phase)
      throw new PlanningWorkspaceConflictError(
        "invalid-saved-identity",
        workspace.identity,
      );
    const snapshot = await this.inspect(workspace.identity);
    if (snapshot.state === "missing") {
      if (await this.existing(this.path(workspace.identity)))
        throw new PlanningWorkspaceConflictError(
          "unregistered-path",
          workspace.identity,
        );
      return snapshot;
    }
    if (snapshot.state === "branch-only") {
      if (await this.existing(this.path(workspace.identity)))
        throw new PlanningWorkspaceConflictError(
          "unregistered-path",
          workspace.identity,
        );
      if (snapshot.headOid !== workspace.headOid)
        throw new PlanningWorkspaceConflictError(
          "head-oid-mismatch",
          workspace.identity,
        );
      return snapshot;
    }
    if (snapshot.headOid !== workspace.headOid)
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        workspace.identity,
      );
    if (!snapshot.clean)
      throw new PlanningWorkspaceConflictError(
        "dirty-worktree",
        workspace.identity,
      );
    await this.run(
      ["worktree", "remove", "--", this.path(workspace.identity)],
      "worktree-remove",
    );
    const after = await this.inspect(workspace.identity);
    if (after.state === "ready")
      throw new PlanningWorkspaceConflictError(
        "unsafe-registration",
        workspace.identity,
      );
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
    if (input.runId !== workspace.runId || input.phase !== workspace.phase)
      throw new PlanningWorkspaceConflictError(
        "invalid-saved-identity",
        workspace.identity,
      );
    if (workspace.cleanup.pushedHeadOid !== workspace.headOid)
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        workspace.identity,
      );
    const current = await this.inspect(workspace.identity);
    if (current.state === "ready")
      throw new PlanningWorkspaceConflictError(
        "branch-owned-by-other-worktree",
        workspace.identity,
      );
    if (await this.existing(this.path(workspace.identity)))
      throw new PlanningWorkspaceConflictError(
        "unregistered-path",
        workspace.identity,
      );
    const remote = await this.runner.run(
      "git",
      [
        "ls-remote",
        "--exit-code",
        "--heads",
        "--",
        workspace.remote,
        `refs/heads/${workspace.identity.branch}`,
      ],
      { cwd: this.repoRoot },
    );
    if (remote.code !== 0)
      throw new PlanningWorkspaceCommandError("remote-head-inspection", remote);
    const expected = `${workspace.cleanup.pushedHeadOid}\trefs/heads/${workspace.identity.branch}`;
    if (remote.stdout.trim() !== expected)
      throw new PlanningWorkspaceConflictError(
        "remote-head-mismatch",
        workspace.identity,
      );
    if (current.state === "branch-only") {
      if (current.headOid !== workspace.headOid)
        throw new PlanningWorkspaceConflictError(
          "head-oid-mismatch",
          workspace.identity,
        );
      await this.run(
        [
          "update-ref",
          "-d",
          `refs/heads/${workspace.identity.branch}`,
          workspace.headOid,
        ],
        "branch-deletion",
      );
    }
    const after = await this.inspect(workspace.identity);
    if (after.state !== "missing")
      throw new PlanningWorkspaceConflictError(
        "unsafe-registration",
        workspace.identity,
      );
    return after;
  }
}
