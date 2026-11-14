import fs from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import { CommandFailedError, type CommandRunner } from "../process/command.ts";
import { planningBranchName, worktreeDirName } from "./names.ts";

export type CleanupGit = (args: string[], cwd?: string) => Promise<string>;
export type CleanupWorkspace = {
  branch: string;
  worktree: string;
  registered: boolean;
  branchExists: boolean;
};
export function cleanupGit(
  runner: CommandRunner,
  repoRoot: string,
): CleanupGit {
  return async (args, cwd = repoRoot) => {
    const result = await runner("git", args, { cwd });
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
    return result.stdout;
  };
}

export async function readCleanupWorktrees(
  git: CleanupGit,
): Promise<{ path: string; branch?: string }[]> {
  return (await git(["worktree", "list", "--porcelain", "-z"]))
    .split("\0\0")
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\0");
      const path = fields
        .find((field) => field.startsWith("worktree "))
        ?.slice(9);
      if (!path) throw new Error("Invalid Git worktree registration");
      const branch = fields
        .find((field) => field.startsWith("branch refs/heads/"))
        ?.slice(18);
      return { path, ...(branch === undefined ? {} : { branch }) };
    });
}

/** Resolve existing ancestors too, so absent paths cannot hide a symlink. */
async function realPath(path: string): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await realPath(parent), basename(path));
  }
}
const contains = (parent: string, child: string) => {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
};

/** Observe only. The caller must hold the issue lock before using targets. */
export async function cleanupWorkspaces(input: {
  git: CleanupGit;
  config: PatchmillConfig;
  repoRoot: string;
  issue: number;
  branch: string;
  issueDir: string;
}): Promise<CleanupWorkspace[]> {
  const records = await Promise.all(
    (await readCleanupWorktrees(input.git)).map(async (record) => ({
      ...record,
      canonical: await realPath(resolve(record.path)),
    })),
  );
  const branches = new Set(
    (
      await input.git([
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
      ])
    )
      .trim()
      .split("\n"),
  );
  const primary = records[0];
  if (!primary) throw new Error("Git has no primary checkout");
  const protectedPaths = await Promise.all(
    [primary.path, input.repoRoot, process.cwd(), input.issueDir].map((path) =>
      realPath(resolve(path)),
    ),
  );
  const result: CleanupWorkspace[] = [];
  for (const branch of [
    input.branch,
    planningBranchName(input.issue, "spec"),
    planningBranchName(input.issue, "plan"),
  ]) {
    const worktree = resolve(
      input.repoRoot,
      input.config.paths.worktreeDir,
      worktreeDirName(branch),
    );
    const canonical = await realPath(worktree);
    if (protectedPaths.some((path) => contains(canonical, path)))
      throw new Error(
        `Unsafe cleanup worktree: ${worktree} contains a protected checkout, current directory, or lock parent.`,
      );
    const registration = records.find(
      (record) => record.canonical === canonical,
    );
    const nested = records.find(
      (record) =>
        record !== registration && contains(canonical, record.canonical),
    );
    if (nested)
      throw new Error(
        `Unsafe cleanup worktree: ${worktree} contains registered worktree ${nested.path}.`,
      );
    const elsewhere = records.find(
      (record) => record.branch === branch && record.canonical !== canonical,
    );
    if (elsewhere || (registration && registration.branch !== branch))
      throw new Error(
        `Worktree registration mismatch for ${branch}: ${worktree}`,
      );
    if (!registration) {
      try {
        await fs.lstat(worktree);
        throw new Error(`Unregistered cleanup worktree: ${worktree}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    result.push({
      branch,
      worktree,
      registered: !!registration,
      branchExists: branches.has(branch),
    });
  }
  return result;
}
