import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { CommandRunner } from "../triage/types.ts";

export type InitGitPolicy = "add" | "ignore" | "exclude";

export const PATCHMILL_GIT_IGNORE_ENTRIES = [
  "patchmill.config.json",
  ".patchmill/",
] as const;

export const PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES = [
  ".patchmill/pi-agent",
  ".patchmill/runs",
  ".patchmill/triage-runs",
] as const;

export type InitGitPolicyResult = {
  policy: InitGitPolicy;
  message: string;
};

export type InitGitPolicyPrompt = (question: string) => Promise<string>;

function normalEntry(entry: string): string {
  return entry.trim().replace(/\/+$/u, "");
}

function hasEntry(lines: string[], entry: string): boolean {
  const wanted = normalEntry(entry);
  return lines.some((line) => normalEntry(line) === wanted);
}

async function appendEntries(
  path: string,
  entries: readonly string[],
): Promise<string[]> {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const lines = existing.split(/\r?\n/u);
  const added = entries.filter((entry) => !hasEntry(lines, entry));
  if (added.length === 0) return [];

  const separator =
    existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${separator}${added.join("\n")}\n`);
  return added;
}

async function resolveGitDir(repoRoot: string): Promise<string | undefined> {
  const dotGit = join(repoRoot, ".git");

  try {
    const dotGitStat = await stat(dotGit);
    if (dotGitStat.isDirectory()) return dotGit;
    if (!dotGitStat.isFile()) return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const dotGitContent = await readFile(dotGit, "utf8");
  const match = /^gitdir:\s*(.+?)\s*$/imu.exec(dotGitContent);
  if (!match) return undefined;

  const gitDir = match[1] ?? "";
  return isAbsolute(gitDir) ? gitDir : resolve(repoRoot, gitDir);
}

function formatEntries(entries: readonly string[]): string {
  return entries.map((entry) => `  ${entry}`).join("\n");
}

export async function selectInitGitPolicy(options: {
  isInteractive: boolean;
  assumeYes: boolean;
  prompt?: InitGitPolicyPrompt;
}): Promise<InitGitPolicy> {
  if (!options.isInteractive || options.assumeYes || !options.prompt) {
    return "exclude";
  }

  const answer = (
    await options.prompt(
      [
        "How should Patchmill files be handled by git?",
        "  1) Add config and skills to git",
        "  2) Add Patchmill files to .gitignore",
        "  3) Add Patchmill files to .git/info/exclude (local only)",
        "Choose 1, 2, or 3 [3]: ",
      ].join("\n"),
    )
  )
    .trim()
    .toLowerCase();

  if (["1", "a", "add", "git", "add to git"].includes(answer)) return "add";
  if (["2", "i", "ignore", "gitignore", "git ignore"].includes(answer)) {
    return "ignore";
  }
  return "exclude";
}

export async function applyInitGitPolicy(options: {
  repoRoot: string;
  policy: InitGitPolicy;
  runner: CommandRunner;
}): Promise<InitGitPolicyResult> {
  if (options.policy === "add") {
    const gitignorePath = join(options.repoRoot, ".gitignore");
    const added = await appendEntries(
      gitignorePath,
      PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES,
    );
    const gitAdd = await options.runner.run(
      "git",
      ["add", "patchmill.config.json", ".patchmill/skills", ".gitignore"],
      { cwd: options.repoRoot },
    );
    const gitAddMessage =
      gitAdd.code === 0
        ? "Staged patchmill.config.json, .patchmill/skills, and .gitignore."
        : `Warning: git add failed: ${gitAdd.stderr || gitAdd.stdout || "unknown error"}`;
    const ignoreMessage =
      added.length > 0
        ? `Added local Patchmill runtime directories to .gitignore:\n${formatEntries(added)}`
        : "Local Patchmill runtime directories were already listed in .gitignore.";
    return {
      policy: options.policy,
      message: [
        "Added Patchmill config and skills to git.",
        gitAddMessage,
        ignoreMessage,
      ].join("\n"),
    };
  }

  if (options.policy === "ignore") {
    const added = await appendEntries(
      join(options.repoRoot, ".gitignore"),
      PATCHMILL_GIT_IGNORE_ENTRIES,
    );
    return {
      policy: options.policy,
      message:
        added.length > 0
          ? `Added Patchmill files to .gitignore:\n${formatEntries(added)}`
          : "Patchmill files were already listed in .gitignore.",
    };
  }

  const gitDir = await resolveGitDir(options.repoRoot);
  const excludePath = gitDir
    ? join(gitDir, "info", "exclude")
    : join(options.repoRoot, ".git", "info", "exclude");
  if (!gitDir) {
    return {
      policy: options.policy,
      message: [
        "Warning: Patchmill could not update .git/info/exclude because this directory is not inside a git repository.",
        "Add these entries manually to keep Patchmill files local:",
        formatEntries(PATCHMILL_GIT_IGNORE_ENTRIES),
      ].join("\n"),
    };
  }

  await mkdir(join(gitDir, "info"), { recursive: true });
  const added = await appendEntries(excludePath, PATCHMILL_GIT_IGNORE_ENTRIES);
  return {
    policy: options.policy,
    message:
      added.length > 0
        ? `Added Patchmill files to .git/info/exclude:\n${formatEntries(added)}`
        : "Patchmill files were already listed in .git/info/exclude.",
  };
}
