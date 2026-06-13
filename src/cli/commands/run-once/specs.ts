import { readdir } from "node:fs/promises";
import { join } from "node:path";

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

function datePrefix(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

export function buildSpecFilename(
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return `${datePrefix(date)}-issue-${issueNumber}-${slugify(title)}-design.md`;
}

export function buildSpecPath(
  specsDir: string,
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return join(specsDir, buildSpecFilename(issueNumber, title, date));
}

export async function findIssueSpec(
  specsDir: string,
  issueNumber: number,
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(specsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  const marker = `-issue-${issueNumber}-`;
  const match = entries
    .filter((entry) => entry.isFile() && entry.name.includes(marker))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))[0];

  return match ? join(specsDir, match) : undefined;
}
