import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { CommandRunner } from "../triage/types.ts";

export type InitGitPolicy = "add" | "ignore" | "exclude";

export const PATCHMILL_GIT_IGNORE_ENTRIES = [
  "patchmill.config.json",
  ".patchmill/",
  ".worktrees/",
  ".pi/todos/",
] as const;

export const PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES = [
  ".patchmill/pi-agent",
  ".patchmill/runs",
  ".patchmill/triage-runs",
  ".worktrees/",
  ".pi/todos/",
] as const;

export type InitSetupCommitStatus =
  | "committed"
  | "nothing"
  | "missing"
  | "stage-warning"
  | "commit-warning";

export type InitGitPolicyResult = {
  policy: InitGitPolicy;
  message: string;
  setupCommit?: {
    status: InitSetupCommitStatus;
    paths: string[];
  };
};

export type InitGitPolicyPrompt = (question: string) => Promise<string>;

type GitCommitOutcome =
  | { status: "committed"; paths: string[] }
  | { status: "nothing"; paths: string[] }
  | { status: "missing"; paths: string[] }
  | { status: "stage-warning"; warning: string; paths: string[] }
  | { status: "commit-warning"; warning: string; paths: string[] };

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

function gitOutput(result: { stdout: string; stderr: string }): string {
  return result.stderr || result.stdout || "unknown error";
}

function isNothingToCommit(output: string): boolean {
  return /nothing to commit|no changes added to commit|nothing added to commit|no changes/u.test(
    output.toLowerCase(),
  );
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

async function commitInitGitHygiene(options: {
  repoRoot: string;
  runner: CommandRunner;
  paths: readonly string[];
  message: string;
  forceAdd?: boolean;
}): Promise<GitCommitOutcome> {
  const paths = await existingPaths(options.repoRoot, options.paths);
  if (paths.length === 0) return { status: "missing", paths };

  const addArgs = options.forceAdd
    ? ["add", "-f", ...paths]
    : ["add", ...paths];
  const addResult = await options.runner.run("git", addArgs, {
    cwd: options.repoRoot,
  });
  if (addResult.code !== 0) {
    return {
      status: "stage-warning",
      warning: `Warning: git add failed while preparing init git hygiene commit; continuing without committing. ${gitOutput(addResult)}`,
      paths,
    };
  }

  const commitResult = await options.runner.run(
    "git",
    ["commit", "-m", options.message, "--", ...paths],
    { cwd: options.repoRoot },
  );
  if (commitResult.code === 0) return { status: "committed", paths };

  const output = gitOutput(commitResult);
  if (isNothingToCommit(output)) return { status: "nothing", paths };
  return {
    status: "commit-warning",
    warning: `Warning: git commit failed while finalizing init git hygiene; continuing. ${output}`,
    paths,
  };
}

export async function selectInitGitPolicy(options: {
  isInteractive: boolean;
  assumeYes: boolean;
  prompt?: InitGitPolicyPrompt;
}): Promise<InitGitPolicy> {
  if (!options.isInteractive || options.assumeYes || !options.prompt) {
    return "add";
  }

  const answer = (
    await options.prompt(
      [
        "How should Patchmill files be handled by git?",
        "  1) Add config and skills to git (recommended for shared config)",
        "  2) Add Patchmill files to .gitignore",
        "  3) Add Patchmill files to .git/info/exclude (local only)",
        "Choose 1, 2, or 3 [1]: ",
      ].join("\n"),
    )
  )
    .trim()
    .toLowerCase();

  if (["2", "i", "ignore", "gitignore", "git ignore"].includes(answer)) {
    return "ignore";
  }
  if (["3", "e", "exclude", "local", "local only"].includes(answer)) {
    return "exclude";
  }
  return "add";
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
    const commit = await commitInitGitHygiene({
      repoRoot: options.repoRoot,
      runner: options.runner,
      paths: ["patchmill.config.json", ...skillRoots, ".gitignore"],
      message: "chore: initialize Patchmill",
      forceAdd: true,
    });
    const ignoreMessage =
      added.length > 0
        ? `Added local Patchmill runtime directories to .gitignore:\n${formatEntries(added)}`
        : "Local Patchmill runtime directories were already listed in .gitignore.";
    const stagedSkills = commit.paths.some((path) => skillRoots.includes(path));
    const addSummary =
      commit.status === "committed"
        ? stagedSkills
          ? "Patchmill config, skills, and local artifact ignore rules were committed."
          : "Patchmill config and local artifact ignore rules were committed."
        : commit.status === "nothing"
          ? "No Patchmill git hygiene commit was needed."
          : commit.status === "missing"
            ? "No Patchmill files were available to commit."
            : commit.warning;
    return {
      policy: options.policy,
      message: [addSummary, ignoreMessage].join("\n"),
      setupCommit: {
        status: commit.status,
        paths: commit.paths,
      },
    };
  }

  if (options.policy === "ignore") {
    const added = await appendEntries(
      join(options.repoRoot, ".gitignore"),
      PATCHMILL_GIT_IGNORE_ENTRIES,
    );
    if (added.length === 0) {
      return {
        policy: options.policy,
        message:
          "No git hygiene commit was needed; Patchmill files were already listed in .gitignore.",
      };
    }

    const commit = await commitInitGitHygiene({
      repoRoot: options.repoRoot,
      runner: options.runner,
      paths: [".gitignore"],
      message: "chore: initialize Patchmill git hygiene",
    });
    const commitMessage =
      commit.status === "committed"
        ? ".gitignore git hygiene rules were committed."
        : commit.status === "nothing"
          ? "No git hygiene commit was needed."
          : commit.status === "missing"
            ? "Warning: .gitignore was not available to commit after init updated git hygiene rules."
            : commit.warning;
    return {
      policy: options.policy,
      message: [
        commitMessage,
        `Added Patchmill files to .gitignore:\n${formatEntries(added)}`,
      ].join("\n"),
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
