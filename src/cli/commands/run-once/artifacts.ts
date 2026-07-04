import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type WorkflowArtifactOptions = {
  suffix?: string;
};

export type WorkflowArtifactKind = "spec" | "plan";

export type IssueContentArtifactComment = {
  body?: string;
};

export type IssueContentArtifactResolution = {
  path: string;
  source: "body" | "comment";
  commentIndex?: number;
};

export type IssueContentArtifactOptions = {
  repoRoot: string;
  kind: WorkflowArtifactKind;
  body?: string;
  comments?: readonly IssueContentArtifactComment[];
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

const PATH_PATTERN =
  /(?:`([^`]+)`|\[[^\]]+\]\(([^)]+)\)|(^|\s)((?:\.?\.?\/)?[A-Za-z0-9._/-]+\.md))/gm;

function hasArtifactSignal(text: string, kind: WorkflowArtifactKind): boolean {
  const escapedKind = kind === "spec" ? "spec" : "plan";
  return new RegExp(
    `(?:approved\\s+${escapedKind}|${escapedKind}\\s+approved|approved\\s+${escapedKind}\\s+artifact|existing\\s+${escapedKind}\\s+ready)`,
    "i",
  ).test(text);
}

function extractPathCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(PATH_PATTERN)) {
    const value = match[1] ?? match[2] ?? match[4];
    if (value) candidates.push(value.trim());
  }
  return candidates;
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function insideRepo(repoRoot: string, absolutePath: string): boolean {
  const relativePath = relative(repoRoot, absolutePath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

async function validateIssueArtifactPath(
  repoRoot: string,
  candidate: string,
): Promise<string | undefined> {
  if (!candidate || isUrl(candidate)) return undefined;
  if (candidate.includes("\0")) return undefined;

  const normalizedRepoRoot = resolve(repoRoot);
  const absolutePath = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(normalizedRepoRoot, candidate);
  if (!insideRepo(normalizedRepoRoot, absolutePath)) return undefined;

  let info;
  try {
    info = await stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isFile()) return undefined;

  return relative(normalizedRepoRoot, absolutePath).split(sep).join("/");
}

async function resolveFromText(
  repoRoot: string,
  kind: WorkflowArtifactKind,
  text: string,
): Promise<string | undefined> {
  const signalLines = text
    .split(/\r?\n/)
    .filter((line) => hasArtifactSignal(line, kind));
  for (const line of signalLines) {
    for (const candidate of extractPathCandidates(line)) {
      const validPath = await validateIssueArtifactPath(repoRoot, candidate);
      if (validPath) return validPath;
    }
  }
  return undefined;
}

export async function resolveIssueContentArtifact(
  options: IssueContentArtifactOptions,
): Promise<IssueContentArtifactResolution | undefined> {
  const comments = options.comments ?? [];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const path = await resolveFromText(
      options.repoRoot,
      options.kind,
      comments[index]?.body ?? "",
    );
    if (path) return { path, source: "comment", commentIndex: index };
  }

  const path = await resolveFromText(
    options.repoRoot,
    options.kind,
    options.body ?? "",
  );
  return path ? { path, source: "body" } : undefined;
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
