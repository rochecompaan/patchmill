import fs from "node:fs/promises";
import { resolve } from "node:path";
import { CommandFailedError, type CommandRunner } from "../process/command.ts";
import { isIssueBranch } from "./names.ts";

export type KernelGit = {
  fetch(): Promise<void>;
  remoteDefaultBranch(): Promise<string | undefined>;
  remoteBranches(issue: number): Promise<string[]>;
  ensureWorktree(input: {
    path: string;
    branch: string;
    base: string;
    remoteExists: boolean;
  }): Promise<"created" | "existing">;
  hasUncommittedChanges(worktree: string): Promise<boolean>;
  unpushedCommits(
    worktree: string,
    branch: string,
  ): Promise<number | "no-remote-branch">;
};

export function createKernelGit(
  runner: CommandRunner,
  repoRoot: string,
): KernelGit {
  const git = async (args: string[], absentCode?: number, cwd = repoRoot) => {
    const result = await runner("git", args, { cwd });
    if (result.code === absentCode) return undefined;
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
    return result.stdout.trim();
  };
  return {
    async fetch(): Promise<void> {
      await git(["fetch", "--prune", "origin"]);
    },
    async remoteDefaultBranch(): Promise<string | undefined> {
      const ref = await git(
        ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        1,
      );
      return ref?.replace(/^refs\/remotes\/origin\//, "");
    },
    async ensureWorktree(input: {
      path: string;
      branch: string;
      base: string;
      remoteExists: boolean;
    }): Promise<"created" | "existing"> {
      await git(["worktree", "prune"]);
      const path = resolve(repoRoot, input.path);
      const canonicalPath = await fs
        .realpath(path)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return path;
          throw error;
        });
      const registered = await git(["worktree", "list", "--porcelain", "-z"]);
      if (registered!.split("\0").includes(`worktree ${canonicalPath}`)) {
        return "existing";
      }
      try {
        await fs.rmdir(path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOTEMPTY" || code === "EEXIST") {
          throw new Error(
            `Unregistered worktree path is not empty: ${input.path}`,
            { cause: error },
          );
        }
        if (code !== "ENOENT") throw error;
      }
      const local = await git(
        ["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`],
        1,
      );
      if (local !== undefined) {
        await git(["worktree", "add", path, input.branch]);
      } else if (input.remoteExists) {
        await git([
          "worktree",
          "add",
          "--track",
          "-b",
          input.branch,
          path,
          `origin/${input.branch}`,
        ]);
      } else {
        await git([
          "worktree",
          "add",
          "-b",
          input.branch,
          path,
          `origin/${input.base}`,
        ]);
      }
      return "created";
    },
    async hasUncommittedChanges(worktree: string): Promise<boolean> {
      return (await git(["status", "--porcelain"], undefined, worktree)) !== "";
    },
    async unpushedCommits(
      worktree: string,
      branch: string,
    ): Promise<number | "no-remote-branch"> {
      const remote = `refs/remotes/origin/${branch}`;
      if (
        (await git(
          ["show-ref", "--verify", "--quiet", remote],
          1,
          worktree,
        )) === undefined
      ) {
        return "no-remote-branch";
      }
      return Number(
        await git(
          ["rev-list", "--count", `${remote}..refs/heads/${branch}`, "--"],
          undefined,
          worktree,
        ),
      );
    },
    async remoteBranches(issue: number): Promise<string[]> {
      const refs = await git([
        "for-each-ref",
        "--format=%(refname:strip=3)",
        "refs/remotes/origin/",
      ]);
      return refs!.split("\n").filter((branch) => isIssueBranch(issue, branch));
    },
  };
}
