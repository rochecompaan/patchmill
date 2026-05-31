import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PATCHMILL_GITIGNORE_ENTRIES = [
  ".patchmill",
  "patchmill.config.json",
] as const;

export type GitignoreUpdateResult = {
  path: string;
  added: string[];
};

function hasGitignoreEntry(lines: string[], entry: string): boolean {
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

export async function ensurePatchmillGitignoreEntries(
  repoRoot: string,
): Promise<GitignoreUpdateResult> {
  const path = join(repoRoot, ".gitignore");
  let existing = "";

  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const lines = existing.split(/\r?\n/u);
  const added = PATCHMILL_GITIGNORE_ENTRIES.filter(
    (entry) => !hasGitignoreEntry(lines, entry),
  );
  if (added.length === 0) return { path, added };

  const separator =
    existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${separator}${added.join("\n")}\n`);

  return { path, added };
}
