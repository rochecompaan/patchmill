import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandRunner } from "../command/types.ts";
import { planningOid } from "./planning-git-validation.ts";
import { planningWorkspacePath } from "./planning-workspace-input.ts";
import {
  parsePlanningWorktreePorcelain,
  type PlanningWorktreeRegistration,
} from "./planning-worktree-porcelain.ts";
import {
  PlanningWorkspaceCommandError,
  PlanningWorkspaceConflictError,
  PlanningWorkspaceResponseError,
  type PlanningWorkspaceIdentity,
  type PlanningWorkspaceOperation,
  type PlanningWorkspaceSnapshot,
} from "./planning-workspaces.ts";

export class PlanningWorkspaceRepositoryGit {
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

  path(identity: PlanningWorkspaceIdentity): string {
    return planningWorkspacePath(this.repoRoot, this.worktreeRoot, identity);
  }

  async run(args: string[], operation: PlanningWorkspaceOperation) {
    const result = await this.runner.run("git", args, { cwd: this.repoRoot });
    if (result.code !== 0) {
      throw new PlanningWorkspaceCommandError(operation, result);
    }
    return result;
  }

  async existing(path: string): Promise<boolean> {
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
    if (branchElsewhere !== undefined) {
      throw new PlanningWorkspaceConflictError(
        "branch-owned-by-other-worktree",
        identity,
      );
    }
    const head = await this.branchHead(identity.branch);
    if (entry === undefined) {
      return head === undefined
        ? { state: "missing", identity }
        : { state: "branch-only", identity, headOid: head };
    }
    if (
      entry.branch !== identity.branch ||
      entry.detached ||
      entry.locked ||
      entry.prunable
    ) {
      throw new PlanningWorkspaceConflictError("unsafe-registration", identity);
    }
    if (head === undefined || head !== entry.headOid) {
      throw new PlanningWorkspaceConflictError("head-oid-mismatch", identity);
    }
    return {
      state: "ready",
      identity,
      headOid: head,
      clean: await this.clean(path),
    };
  }

  private async entries(): Promise<readonly PlanningWorktreeRegistration[]> {
    const result = await this.run(
      ["worktree", "list", "--porcelain", "-z"],
      "worktree-inspection",
    );
    const parsed = parsePlanningWorktreePorcelain(result.stdout);
    if (parsed.malformed) {
      throw new PlanningWorkspaceResponseError(
        "worktree-inspection",
        "malformed-porcelain",
      );
    }
    return parsed.entries;
  }

  private async branchHead(branch: string): Promise<string | undefined> {
    const exists = await this.runner.run(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd: this.repoRoot },
    );
    if (exists.code === 1) return undefined;
    if (exists.code !== 0) {
      throw new PlanningWorkspaceCommandError("ref-resolution", exists);
    }
    const result = await this.run(
      ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
      "ref-resolution",
    );
    const oid = result.stdout.trim();
    if (!planningOid.test(oid)) {
      throw new PlanningWorkspaceResponseError(
        "ref-resolution",
        "invalid-object-id",
      );
    }
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
}
