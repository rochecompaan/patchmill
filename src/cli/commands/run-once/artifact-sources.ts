import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  ArtifactExtractionResult,
  ArtifactExtractionSource,
} from "./artifact-source-extraction.ts";
import { buildPlanPath } from "./plans.ts";
import { buildSpecPath } from "./specs.ts";
import type { IssueSummary } from "./types.ts";

export type ResolvedIssuePathArtifactSource = {
  artifactKind: "spec" | "plan";
  sourceType: "path";
  path: string;
  absolutePath: string;
  evidence: string;
};

export type ResolvedIssueInlineArtifactSource = {
  artifactKind: "spec" | "plan";
  sourceType: "inline";
  path: string;
  absolutePath: string;
  content: string;
  evidence: string;
  commit?: string;
};

export type ResolvedIssueArtifactSource =
  | ResolvedIssuePathArtifactSource
  | ResolvedIssueInlineArtifactSource;

export type ResolvedIssueArtifactSources = {
  spec?: ResolvedIssueArtifactSource;
  plan?: ResolvedIssueArtifactSource;
};

export class ArtifactSourcePreflightError extends Error {
  readonly name = "ArtifactSourcePreflightError";
  readonly issueNumber: number;
  readonly artifactKind?: "spec" | "plan";

  constructor(
    message: string,
    options: { issueNumber: number; artifactKind?: "spec" | "plan" },
  ) {
    super(message);
    this.issueNumber = options.issueNumber;
    this.artifactKind = options.artifactKind;
  }
}

export type ValidateExtractedArtifactSourcesOptions = {
  issue: IssueSummary;
  repoRoot: string;
  specsDir: string;
  plansDir: string;
  now: Date;
  extraction: ArtifactExtractionResult;
};

function repoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).replaceAll("\\", "/");
}

function normalizeRepoPath(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/gu, "")
    .replace(/^\.\//u, "")
    .replace(/^\//u, "");
}

function pathInside(path: string, dir: string): boolean {
  const absoluteDir = resolve(dir);
  const absolutePath = resolve(path);
  const rel = relative(absoluteDir, absolutePath);
  return (
    rel.length === 0 || (!rel.startsWith("..") && !rel.includes(`..${sep}`))
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function targetForInline(
  source: ArtifactExtractionSource,
  options: ValidateExtractedArtifactSourcesOptions,
): { absolutePath: string; path: string } {
  const absolutePath =
    source.kind === "spec"
      ? buildSpecPath(
          options.specsDir,
          options.issue.number,
          options.issue.title,
          options.now,
        )
      : buildPlanPath(
          options.plansDir,
          options.issue.number,
          options.issue.title,
          options.now,
        );
  return { absolutePath, path: repoRelative(options.repoRoot, absolutePath) };
}

async function validateSource(
  source: ArtifactExtractionSource,
  options: ValidateExtractedArtifactSourcesOptions,
): Promise<ResolvedIssueArtifactSource> {
  if (source.type === "inline") {
    const content = source.content.trim();
    if (content.length < 8) {
      throw new ArtifactSourcePreflightError(
        `Issue #${options.issue.number} has an inline ${source.kind} artifact with empty content`,
        { issueNumber: options.issue.number, artifactKind: source.kind },
      );
    }
    const target = targetForInline(source, options);
    return {
      artifactKind: source.kind,
      sourceType: "inline",
      path: target.path,
      absolutePath: target.absolutePath,
      content,
      evidence: source.evidence,
    };
  }

  const path = normalizeRepoPath(source.value);
  const absolutePath = resolve(options.repoRoot, path);
  const expectedDir =
    source.kind === "spec" ? options.specsDir : options.plansDir;
  const dirName = source.kind === "spec" ? "specsDir" : "plansDir";
  if (!pathInside(absolutePath, expectedDir)) {
    throw new ArtifactSourcePreflightError(
      `Issue #${options.issue.number} references ${source.kind} path ${source.value} outside configured ${dirName}`,
      { issueNumber: options.issue.number, artifactKind: source.kind },
    );
  }
  if (!(await fileExists(absolutePath))) {
    throw new ArtifactSourcePreflightError(
      `Issue #${options.issue.number} references ${source.kind} path ${path}, but the file does not exist`,
      { issueNumber: options.issue.number, artifactKind: source.kind },
    );
  }
  return {
    artifactKind: source.kind,
    sourceType: "path",
    path,
    absolutePath,
    evidence: source.evidence,
  };
}

export async function validateExtractedArtifactSources(
  options: ValidateExtractedArtifactSourcesOptions,
): Promise<ResolvedIssueArtifactSources> {
  if (options.extraction.status === "none") return {};
  if (options.extraction.status === "ambiguous") {
    throw new ArtifactSourcePreflightError(
      `Issue #${options.issue.number} has ambiguous artifact sources: ${options.extraction.reason}`,
      { issueNumber: options.issue.number },
    );
  }

  const resolved: ResolvedIssueArtifactSources = {};
  if (options.extraction.spec) {
    if (options.extraction.spec.kind !== "spec") {
      throw new ArtifactSourcePreflightError(
        `Issue #${options.issue.number} extractor returned a non-spec source in the spec slot`,
        { issueNumber: options.issue.number, artifactKind: "spec" },
      );
    }
    resolved.spec = await validateSource(options.extraction.spec, options);
  }
  if (options.extraction.plan) {
    if (options.extraction.plan.kind !== "plan") {
      throw new ArtifactSourcePreflightError(
        `Issue #${options.issue.number} extractor returned a non-plan source in the plan slot`,
        { issueNumber: options.issue.number, artifactKind: "plan" },
      );
    }
    resolved.plan = await validateSource(options.extraction.plan, options);
  }
  return resolved;
}
