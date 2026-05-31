import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export const PATCHMILL_LOCAL_EXCLUDE_ENTRIES = [
  ".patchmill",
  "patchmill.config.json",
] as const;

export type LocalExcludeUpdateResult = {
  path: string;
  added: string[];
  skipped?: string;
};

function hasExcludeEntry(lines: string[], entry: string): boolean {
  if (entry === ".patchmill") {
    return lines.some((line) => {
      const trimmed = line.trim();
      return [
        ".patchmill",
        ".patchmill/",
        "/.patchmill",
        "/.patchmill/",
      ].includes(trimmed);
    });
  }

  return lines.some((line) => line.trim() === entry);
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

export async function ensurePatchmillLocalExcludeEntries(
  repoRoot: string,
): Promise<LocalExcludeUpdateResult> {
  const gitDir = await resolveGitDir(repoRoot);
  const path = gitDir
    ? join(gitDir, "info", "exclude")
    : join(repoRoot, ".git", "info", "exclude");

  if (!gitDir) {
    return {
      path,
      added: [],
      skipped: "not inside a git repository with a local exclude file",
    };
  }

  await mkdir(join(gitDir, "info"), { recursive: true });

  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const lines = existing.split(/\r?\n/u);
  const added = PATCHMILL_LOCAL_EXCLUDE_ENTRIES.filter(
    (entry) => !hasExcludeEntry(lines, entry),
  );
  if (added.length === 0) return { path, added };

  const separator =
    existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${separator}${added.join("\n")}\n`);

  return { path, added };
}
