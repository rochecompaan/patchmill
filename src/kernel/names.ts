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

export function isIssueBranch(issue: number, branch: string): boolean {
  return new RegExp(`^agent/issue-${issue}(?:-|$)`).test(branch);
}

export function worktreeDirName(branch: string): string {
  return branch.replaceAll("/", "-");
}

export function isSpecFile(issue: number, fileName: string): boolean {
  return new RegExp(
    `^\\d{4}-\\d{2}-\\d{2}-issue-${issue}(-.+)?-design\\.md$`,
  ).test(fileName);
}

export function isPlanFile(issue: number, fileName: string): boolean {
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-issue-${issue}(-.+)?\\.md$`).test(
    fileName,
  );
}

function localDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

export function specFileName(date: Date, issue: number, title: string): string {
  const slug = slugify(title);
  return `${localDate(date)}-issue-${issue}${slug === "" ? "" : `-${slug}`}-design.md`;
}

export function planFileName(date: Date, issue: number, title: string): string {
  const slug = slugify(title);
  return `${localDate(date)}-issue-${issue}${slug === "" ? "" : `-${slug}`}.md`;
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
