import { relative, resolve, sep } from "node:path";
import type {
  PublishedWorkflowArtifact,
  PublishedWorkflowArtifacts,
  WorkflowArtifactKind,
} from "../../../workflow/artifacts/published-artifacts.ts";
import {
  artifactContentIsEmpty,
  normalizePublishedArtifactContent,
} from "../../../workflow/artifacts/published-artifacts.ts";
import type { IssueSummary } from "./types.ts";

export type ResolvedIssueArtifactSource = PublishedWorkflowArtifact & {
  absolutePath: string;
};

export type ResolvedIssueArtifactSources = Partial<
  Record<WorkflowArtifactKind, ResolvedIssueArtifactSource>
>;

export class ArtifactSourcePreflightError extends Error {
  readonly name = "ArtifactSourcePreflightError";
  readonly issueNumber: number;
  readonly artifactKind?: WorkflowArtifactKind;

  constructor(
    message: string,
    options: { issueNumber: number; artifactKind?: WorkflowArtifactKind },
  ) {
    super(message);
    this.issueNumber = options.issueNumber;
    this.artifactKind = options.artifactKind;
  }
}

export type ValidateIssueArtifactSourcesOptions = {
  issue: IssueSummary;
  repoRoot: string;
  specsDir: string;
  plansDir: string;
  artifacts: PublishedWorkflowArtifacts;
};

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

function targetForArtifact(
  source: PublishedWorkflowArtifact,
  options: ValidateIssueArtifactSourcesOptions,
): { absolutePath: string; path: string } {
  const path = normalizeRepoPath(source.path);
  return { absolutePath: resolve(options.repoRoot, path), path };
}

function issueTextBlocks(issue: IssueSummary): string[] {
  return [issue.body, ...(issue.comments ?? []).map((comment) => comment.body)];
}

function isVerbatimIssueContent(content: string, issue: IssueSummary): boolean {
  const normalizedContent = normalizePublishedArtifactContent(content);
  return issueTextBlocks(issue).some((block) =>
    normalizePublishedArtifactContent(block).includes(normalizedContent),
  );
}

async function validateArtifact(
  kind: WorkflowArtifactKind,
  source: PublishedWorkflowArtifact,
  options: ValidateIssueArtifactSourcesOptions,
): Promise<ResolvedIssueArtifactSource> {
  const content = normalizePublishedArtifactContent(source.content);
  if (artifactContentIsEmpty(content)) {
    throw new ArtifactSourcePreflightError(
      `Issue #${options.issue.number} has a ${kind} artifact with empty content`,
      { issueNumber: options.issue.number, artifactKind: kind },
    );
  }
  if (!isVerbatimIssueContent(content, options.issue)) {
    throw new ArtifactSourcePreflightError(
      `Issue #${options.issue.number} has a ${kind} artifact that was not copied verbatim from the issue content`,
      { issueNumber: options.issue.number, artifactKind: kind },
    );
  }
  const target = targetForArtifact(source, options);
  const expectedDir = kind === "spec" ? options.specsDir : options.plansDir;
  const dirName = kind === "spec" ? "specsDir" : "plansDir";
  if (!pathInside(target.absolutePath, expectedDir)) {
    throw new ArtifactSourcePreflightError(
      `Issue #${options.issue.number} references ${kind} path ${target.path} outside configured ${dirName}`,
      { issueNumber: options.issue.number, artifactKind: kind },
    );
  }
  return {
    ...source,
    path: target.path,
    absolutePath: target.absolutePath,
    content,
  };
}

export async function validateIssueArtifactSources(
  options: ValidateIssueArtifactSourcesOptions,
): Promise<ResolvedIssueArtifactSources> {
  const resolved: ResolvedIssueArtifactSources = {};
  if (options.artifacts.spec) {
    resolved.spec = await validateArtifact(
      "spec",
      options.artifacts.spec,
      options,
    );
  }
  if (options.artifacts.plan) {
    resolved.plan = await validateArtifact(
      "plan",
      options.artifacts.plan,
      options,
    );
  }
  return resolved;
}
