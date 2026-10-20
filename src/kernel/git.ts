import fs from "node:fs/promises";
import { resolve } from "node:path";
import { CommandFailedError, type CommandRunner } from "../process/command.ts";
import { isIssueBranch } from "./names.ts";

export type WorktreeInput = {
  path: string;
  branch: string;
  base: string;
  remoteExists: boolean;
};
/** Where the issue workspace lives now, or the ref provisioning would check out. */
export type WorkspaceSource =
  | { kind: "worktree" }
  | { kind: "local-branch"; ref: string }
  | { kind: "remote-ref"; ref: string };

export type KernelGit = {
  fetch(): Promise<void>;
  remoteDefaultBranch(): Promise<string | undefined>;
  remoteBranches(issue: number): Promise<string[]>;
  /** Regular file names directly inside a directory of a ref's tree. */
  treeFiles(ref: string, directory: string): Promise<string[]>;
  baseArtifactsMatch(
    source: { worktree: string } | { ref: string },
    base: string,
    paths: string[],
  ): Promise<boolean>;
  /** Read-only; ensureWorktree checks out exactly this source. */
  workspaceSource(input: WorktreeInput): Promise<WorkspaceSource>;
  ensureWorktree(input: WorktreeInput): Promise<"created" | "existing">;
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
  const workspaceSource = async (
    input: WorktreeInput,
  ): Promise<WorkspaceSource> => {
    const path = resolve(repoRoot, input.path);
    const entries = await fs
      .readdir(path)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (entries !== undefined) {
      const canonicalPath = await fs.realpath(path);
      const registered = await git(["worktree", "list", "--porcelain", "-z"]);
      const record = registered!
        .split("\0\0")
        .find((entry) =>
          entry.split("\0").includes(`worktree ${canonicalPath}`),
        );
      if (record) {
        if (!record.split("\0").includes(`branch refs/heads/${input.branch}`))
          throw new Error(
            `Worktree ${input.path}: expected branch ${input.branch}.`,
          );
        return { kind: "worktree" };
      }
      if (entries.length > 0)
        throw new Error(
          `Unregistered worktree path is not empty: ${input.path}`,
        );
    }
    const local = `refs/heads/${input.branch}`;
    if (
      (await git(["show-ref", "--verify", "--quiet", local], 1)) !== undefined
    )
      return { kind: "local-branch", ref: local };
    return {
      kind: "remote-ref",
      ref: `origin/${input.remoteExists ? input.branch : input.base}`,
    };
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
    workspaceSource,
    async ensureWorktree(input) {
      await git(["worktree", "prune"]);
      const source = await workspaceSource(input);
      if (source.kind === "worktree") return "existing";
      const path = resolve(repoRoot, input.path);
      // workspaceSource has rejected anything but a missing or empty directory.
      await fs.rmdir(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await git(
        source.kind === "local-branch"
          ? ["worktree", "add", path, input.branch]
          : [
              "worktree",
              "add",
              ...(input.remoteExists ? ["--track"] : []),
              "-b",
              input.branch,
              path,
              source.ref,
            ],
      );
      return "created";
    },
    async hasUncommittedChanges(worktree: string): Promise<boolean> {
      return (await git(["status", "--porcelain"], undefined, worktree)) !== "";
    },
    async unpushedCommits(worktree, branch) {
      const remote = `refs/remotes/origin/${branch}`;
      const remoteRef = await git(
        ["show-ref", "--verify", "--quiet", remote],
        1,
        worktree,
      );
      if (remoteRef === undefined) return "no-remote-branch";
      return Number(
        await git(
          ["rev-list", "--count", `${remote}..refs/heads/${branch}`, "--"],
          undefined,
          worktree,
        ),
      );
    },
    async treeFiles(ref, directory): Promise<string[]> {
      const prefix = directory === "" ? "" : `${directory}/`;
      const entries = await git([
        "ls-tree",
        "-z",
        "--full-tree",
        ref,
        "--",
        ...(prefix ? [prefix] : []),
      ]);
      return entries!
        .split("\0")
        .filter((entry) => /^100(644|755) blob /.test(entry))
        .map((entry) => entry.slice(entry.indexOf("\t") + 1 + prefix.length));
    },
    async baseArtifactsMatch(source, base, paths): Promise<boolean> {
      const ref = `origin/${base}`;
      const files = await git([
        "ls-tree",
        "-r",
        "--name-only",
        ref,
        "--",
        ...paths,
      ]);
      if (!paths.every((path) => files!.split("\n").includes(path)))
        return false;
      const [target, cwd] =
        "ref" in source ? [[source.ref], repoRoot] : [[], source.worktree];
      return (
        (await git(
          ["diff", "--quiet", ref, ...target, "--", ...paths],
          1,
          cwd,
        )) !== undefined
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
