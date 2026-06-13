import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type WorkflowArtifactOptions = {
  suffix?: string;
};

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

export function buildArtifactFilename(
  issueNumber: number,
  title: string,
  date: string | Date,
  options: WorkflowArtifactOptions = {},
): string {
  return `${datePrefix(date)}-issue-${issueNumber}-${slugify(title)}${options.suffix ?? ""}.md`;
}

export function buildArtifactPath(
  artifactDir: string,
  issueNumber: number,
  title: string,
  date: string | Date,
  options: WorkflowArtifactOptions = {},
): string {
  return join(
    artifactDir,
    buildArtifactFilename(issueNumber, title, date, options),
  );
}

export async function findIssueArtifact(
  artifactDir: string,
  issueNumber: number,
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(artifactDir, { withFileTypes: true });
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

  return match ? join(artifactDir, match) : undefined;
}
