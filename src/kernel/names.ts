import { randomBytes } from "node:crypto";
import { join } from "node:path";

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

export function branchName(issue: number, title: string): string {
  const slug = slugify(title);
  return `agent/issue-${issue}${slug === "" ? "" : `-${slug}`}`;
}

// A slugify result: hyphen-joined ASCII groups, so it never contains `--`.
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SLUG_LIMIT = 48;

/**
 * A planning branch carries the issue's fixed slug before its stage suffix.
 * An empty slug gives the legacy `agent/issue-N--stage` form.
 */
export function planningBranchName(
  issue: number,
  stage: ArtifactKind,
  slug: string,
): string {
  return `agent/issue-${issue}${slug === "" ? "" : `-${slug}`}--${stage}`;
}

/** Recognises slugged and legacy planning branches of one issue. */
export function parsePlanningBranch(
  issue: number,
  branch: string,
): { stage: ArtifactKind; slug: string } | undefined {
  const match = new RegExp(
    `^agent/issue-${issue}(?:-(${SLUG}))?--(spec|plan)$`,
  ).exec(branch);
  if (!match) return undefined;
  const slug = match[1] ?? "";
  if (slug.length > SLUG_LIMIT) return undefined;
  return { stage: match[2] as ArtifactKind, slug };
}

export function isIssueBranch(issue: number, branch: string): boolean {
  return new RegExp(`^agent/issue-${issue}(?:-|$)`).test(branch);
}

export function worktreeDirName(branch: string): string {
  return branch.replaceAll("/", "-");
}

export type ArtifactKind = "spec" | "plan";

// The title slug only describes the file. The issue number and the final
// suffix identify it, so a title edit can never turn a plan into a spec.
const artifactSuffix: Record<ArtifactKind, string> = {
  spec: "design",
  plan: "plan",
};

export function artifactFileName(
  kind: ArtifactKind,
  date: Date,
  issue: number,
  title: string,
): string {
  const slug = slugify(title);
  return `${localDate(date)}-issue-${issue}${slug === "" ? "" : `-${slug}`}-${artifactSuffix[kind]}.md`;
}

export function isArtifactFile(
  kind: ArtifactKind,
  issue: number,
  fileName: string,
): boolean {
  return new RegExp(
    `^\\d{4}-\\d{2}-\\d{2}-issue-${issue}(?:-.+)?-${artifactSuffix[kind]}\\.md$`,
  ).test(fileName);
}

/** The title slug in a recognised artifact name, or `""` when it has none. */
export function artifactSlug(
  kind: ArtifactKind,
  issue: number,
  fileName: string,
): string | undefined {
  if (!isArtifactFile(kind, issue, fileName)) return undefined;
  const match = new RegExp(
    `^\\d{4}-\\d{2}-\\d{2}-issue-${issue}(?:-(${SLUG}))?-${artifactSuffix[kind]}\\.md$`,
  ).exec(fileName);
  if (!match) return undefined;
  const slug = match[1] ?? "";
  return slug.length > SLUG_LIMIT ? undefined : slug;
}

function localDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

export function newRunId(now: Date): string {
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  return `${localDate(now).replaceAll("-", "")}-${time}-${randomBytes(2).toString("hex")}`;
}

export function runDirectory(
  runsDir: string,
  issue: number,
  runId: string,
): string {
  return join(runsDir, `issue-${issue}`, runId);
}
