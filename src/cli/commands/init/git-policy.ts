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
  return entry.trim().replace(/^\//u, "").replace(/\/+$/u, "");
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

function formatPathList(paths: readonly string[]): string {
  if (paths.length <= 1) return paths[0] ?? "nothing";
  if (paths.length === 2) return `${paths[0]} and ${paths[1]}`;
  return `${paths.slice(0, -1).join(", ")}, and ${paths.at(-1)}`;
}

function safeRelativePath(path: string): boolean {
  return (
    path !== "." &&
    path !== ".." &&
    !isAbsolute(path) &&
    !path.startsWith("../")
  );
}

async function existingPaths(
  repoRoot: string,
  paths: readonly string[],
): Promise<string[]> {
  const uniquePaths = [...new Set(paths)].filter(safeRelativePath);
  const existing: string[] = [];
  for (const path of uniquePaths) {
    try {
      await stat(join(repoRoot, path));
      existing.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return existing;
}

function manualExcludeWarning(reason: string): string {
  return [
    `Warning: Patchmill could not update .git/info/exclude (${reason}).`,
    "Add these entries manually to keep Patchmill files local:",
    formatEntries(PATCHMILL_GIT_IGNORE_ENTRIES),
  ].join("\n");
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
  skillRoots?: readonly string[];
}): Promise<InitGitPolicyResult> {
  if (options.policy === "add") {
    const gitignorePath = join(options.repoRoot, ".gitignore");
    const added = await appendEntries(
      gitignorePath,
      PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES,
    );
    const skillRoots = options.skillRoots ?? [".patchmill/skills"];
    const pathsToStage = await existingPaths(options.repoRoot, [
      "patchmill.config.json",
      ...skillRoots,
      ".gitignore",
    ]);
    const gitAdd =
      pathsToStage.length > 0
        ? await options.runner.run("git", ["add", "-f", ...pathsToStage], {
            cwd: options.repoRoot,
          })
        : undefined;
    const gitAddMessage = !gitAdd
      ? "No Patchmill files were available to stage."
      : gitAdd.code === 0
        ? `Staged ${formatPathList(pathsToStage)}.`
        : `Warning: git add failed: ${gitAdd.stderr || gitAdd.stdout || "unknown error"}`;
    const ignoreMessage =
      added.length > 0
        ? `Added local Patchmill runtime directories to .gitignore:\n${formatEntries(added)}`
        : "Local Patchmill runtime directories were already listed in .gitignore.";
    const stagedSkills = pathsToStage.some((path) => skillRoots.includes(path));
    const addSummary =
      gitAdd?.code === 0
        ? stagedSkills
          ? "Added Patchmill config and skills to git."
          : "Added Patchmill config to git."
        : "Warning: Patchmill could not add files to git.";
    return {
      policy: options.policy,
      message: [addSummary, gitAddMessage, ignoreMessage].join("\n"),
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

  let gitDir: string | undefined;
  try {
    gitDir = await resolveGitDir(options.repoRoot);
  } catch (error) {
    return {
      policy: options.policy,
      message: manualExcludeWarning(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  if (!gitDir) {
    return {
      policy: options.policy,
      message: manualExcludeWarning(
        "not inside a git repository with a local exclude file",
      ),
    };
  }

  let added: string[];
  try {
    await mkdir(join(gitDir, "info"), { recursive: true });
    added = await appendEntries(
      join(gitDir, "info", "exclude"),
      PATCHMILL_GIT_IGNORE_ENTRIES,
    );
  } catch (error) {
    return {
      policy: options.policy,
      message: manualExcludeWarning(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  return {
    policy: options.policy,
    message:
      added.length > 0
        ? `Added Patchmill files to .git/info/exclude:\n${formatEntries(added)}`
        : "Patchmill files were already listed in .git/info/exclude.",
  };
}
