import { posix } from "node:path";
import { markdownTopLevelLines } from "./planning-markdown-top-level-lines.ts";
import type { PlanningArtifactEvidence } from "./planning-state-types.ts";

export class PlanningCompanionArtifactError extends Error {
  readonly reason: string;
  readonly path?: string;
  constructor(reason: string, path?: string) {
    super(
      `Invalid planning companion: ${reason}${path === undefined ? "" : ` (${path})`}`,
    );
    this.name = "PlanningCompanionArtifactError";
    this.reason = reason;
    if (path !== undefined) this.path = path;
  }
}

export function isPlanningCompanionPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("docs/mockups/") &&
    value.endsWith(".html") &&
    !/[\s\u0000-\u001f\u007f\\:%?#`]/u.test(value) &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function parseEntry(entry: string, specPath: string): string {
  const match = /^- `([^`]+)`:[ \t\n]*\[[^\]\n]+\]\(([^()\s]+)\)$/u.exec(entry);
  if (match === null)
    throw new PlanningCompanionArtifactError("malformed-declaration");
  const path = match[1]!;
  if (!isPlanningCompanionPath(path))
    throw new PlanningCompanionArtifactError("unsafe-path", path);
  const link = match[2]!;
  if (
    link.startsWith("/") ||
    /[\\:%?#\u0000-\u001f\u007f]/u.test(link) ||
    link.split("/").some((part) => part === "") ||
    posix.normalize(posix.join(posix.dirname(specPath), link)) !== path
  ) {
    throw new PlanningCompanionArtifactError("invalid-link", path);
  }
  return path;
}

/** Derive authority only from the dedicated section of the supplied spec blob. */
export function parsePlanningCompanionPaths(input: {
  specPath: string;
  body: string;
}): readonly string[] {
  const lines = markdownTopLevelLines(input.body);
  const sections = lines.filter(({ line }) =>
    /^[ ]{0,3}## Companion artifacts[ \t]*#*[ \t]*$/u.test(line),
  );
  if (sections.length === 0) return [];
  if (sections.length !== 1)
    throw new PlanningCompanionArtifactError("repeated-section");
  const start = sections[0]!.index;
  const content: string[] = [];
  for (const { line, index } of lines) {
    if (index <= start) continue;
    if (/^[ ]{0,3}#{1,6}[ \t]/u.test(line)) break;
    if (line.trim() !== "") content.push(line);
  }
  const entries: string[] = [];
  for (const line of content) {
    if (line.startsWith("- ")) entries.push(line);
    else if (/^ {1,3}\S/u.test(line) && entries.length > 0)
      entries[entries.length - 1] += `\n${line.trim()}`;
    else throw new PlanningCompanionArtifactError("malformed-declaration");
  }
  if (entries.length === 0)
    throw new PlanningCompanionArtifactError("empty-section");
  const paths = entries.map((entry) => parseEntry(entry, input.specPath));
  if (new Set(paths).size !== paths.length)
    throw new PlanningCompanionArtifactError("duplicate-path");
  return paths;
}

/** Render previously verified evidence; this function does not authorize files. */
export function planningArtifactPaths(
  artifacts: readonly PlanningArtifactEvidence[],
): readonly string[] {
  return [
    ...new Set(
      artifacts.flatMap((artifact) => [
        artifact.path,
        ...(artifact.companionPaths ?? []),
      ]),
    ),
  ];
}
