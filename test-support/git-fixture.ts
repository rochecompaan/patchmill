import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandFailedError, runCommand } from "../src/process/command.ts";

export async function createGitFixture(): Promise<{
  dir: string;
  originPath: string;
  repoRoot: string;
  env: Record<string, string>;
}> {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-git-"));
  const originPath = join(dir, "origin.git");
  const repoRoot = join(dir, "repo");
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    GIT_AUTHOR_NAME: "Patchmill Test",
    GIT_AUTHOR_EMAIL: "patchmill@example.invalid",
    GIT_COMMITTER_NAME: "Patchmill Test",
    GIT_COMMITTER_EMAIL: "patchmill@example.invalid",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = async (args: string[], cwd = dir) => {
    const result = await runCommand("git", args, { cwd, env });
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
  };
  try {
    await git(["init", "--bare", "--initial-branch=main", originPath]);
    const seed = join(dir, "seed");
    await git(["init", "--initial-branch=main", seed]);
    await fs.writeFile(join(seed, "README.md"), "fixture\n");
    await git(["add", "README.md"], seed);
    await git(["commit", "-m", "Initial commit"], seed);
    await git(["remote", "add", "origin", originPath], seed);
    await git(["push", "origin", "main"], seed);
    await git(["clone", originPath, repoRoot]);
    return { dir, originPath, repoRoot, env };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}
