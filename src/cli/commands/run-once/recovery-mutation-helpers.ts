import type { CommandRunner } from "../../../command/types.ts";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

export async function recoveryCommand(
  runner: CommandRunner,
  repoRoot: string,
  args: string[],
): Promise<void> {
  const result = await runner.run("git", args, { cwd: repoRoot });
  if (result.code !== 0)
    throw new Error(
      `Recovery git mutation failed: git ${args.join(" ")}\n${result.stderr || result.stdout}`,
    );
}
export function recoveryWorktreePath(repoRoot: string, path: string): string {
  return resolve(repoRoot, path);
}
export async function assertRecoveryPathAbsent(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Recovery target path appeared: ${path}`);
}
export async function assertRecoveryBranchOid(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
  expectedOid: string,
): Promise<void> {
  const result = await runner.run(
    "git",
    ["rev-parse", "--verify", `${branch}^{commit}`],
    { cwd: repoRoot },
  );
  if (result.code !== 0 || result.stdout.trim() !== expectedOid)
    throw new Error(`Recovery branch changed before publication: ${branch}`);
}
/** A late ordinary status change preserves the workspace and stops recovery. */
export async function assertRecoveryWorkspaceUnchanged(
  runner: CommandRunner,
  path: string,
  label: string,
): Promise<void> {
  const ordinary = await runner.run("git", [
    "--no-optional-locks",
    "-C",
    path,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (ordinary.code !== 0 || ordinary.stdout.trim())
    throw new Error(
      `Recovery workspace changed at ${label}; preserved without publishing or ref update`,
    );
}
