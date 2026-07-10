import { createHash } from "node:crypto";
import type {
  ArtifactExtractionInlineSource,
  ArtifactExtractionResult,
  ArtifactKind,
} from "../run-once/artifact-source-types.ts";
import type { IssueSummary } from "../run-once/types.ts";
import {
  artifactContentEmptyMessage,
  artifactContentIsEmpty,
  normalizeArtifactContent,
} from "../artifact-content.ts";

const OPEN_MARKER = "<!-- patchmill-artifact:v1";
const CLOSE_MARKER = "<!-- /patchmill-artifact -->";
const ARTIFACT_MARKER_PATTERN =
  /<!--\s*patchmill-artifact:v1\s+(\{[^\n]*\})\s*-->\n?([\s\S]*?)\n?<!--\s*\/patchmill-artifact\s*-->/gu;
const OPEN_MARKER_DETECTION_PATTERN = /<!--\s*patchmill-artifact:v1\b/iu;
const CLOSE_MARKER_DETECTION_PATTERN = /<!--\s*\/patchmill-artifact\s*-->/iu;

export type PublishedArtifactKind = ArtifactKind;

export type PublishedArtifactInput = {
  kind: PublishedArtifactKind;
  path: string;
  content: string;
};

type PublishedArtifactMetadata = {
  kind: PublishedArtifactKind;
  path: string;
  sha256: string;
};

type PublishedArtifact = PublishedArtifactMetadata & {
  content: string;
  evidence: string;
};

export type PublishedArtifactExtractionOptions = {
  trustedAuthors: readonly string[];
};

type PublishedArtifactSourceBlock = {
  body: string;
  label: string;
  authorLogin?: string;
};

function titleForKind(kind: PublishedArtifactKind): string {
  return kind === "spec"
    ? "Spec attached to this issue"
    : "Implementation plan attached to this issue";
}

function summaryForKind(kind: PublishedArtifactKind): string {
  return kind === "spec" ? "Spec content" : "Implementation plan content";
}

export function normalizePublishedArtifactContent(content: string): string {
  return normalizeArtifactContent(content);
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertContentCanBePublished(content: string): void {
  if (
    OPEN_MARKER_DETECTION_PATTERN.test(content) ||
    CLOSE_MARKER_DETECTION_PATTERN.test(content)
  ) {
    throw new Error("artifact content contains Patchmill artifact markers");
  }
}

function metadataJson(metadata: PublishedArtifactMetadata): string {
  return JSON.stringify(metadata);
}

function sourceBlocks(issue: IssueSummary): PublishedArtifactSourceBlock[] {
  return (issue.comments ?? []).map((comment, index) => ({
    body: comment.body,
    label: comment.authorLogin
      ? `comment ${index + 1} by ${comment.authorLogin}`
      : `comment ${index + 1}`,
    ...(comment.authorLogin ? { authorLogin: comment.authorLogin } : {}),
  }));
}

function trustedAuthorSet(trustedAuthors: readonly string[]): Set<string> {
  return new Set(
    trustedAuthors.map((author) => author.trim()).filter((author) => author),
  );
}

function sourceIsTrusted(
  source: PublishedArtifactSourceBlock,
  trustedAuthors: Set<string>,
): boolean {
  const authorLogin = source.authorLogin?.trim();
  return Boolean(authorLogin && trustedAuthors.has(authorLogin));
}

function parseMetadata(raw: string, label: string): PublishedArtifactMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Patchmill artifact metadata in ${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Patchmill artifact metadata in ${label} is not an object`);
  }
  const metadata = parsed as Record<string, unknown>;
  if (metadata.kind !== "spec" && metadata.kind !== "plan") {
    throw new Error(`Patchmill artifact metadata in ${label} has invalid kind`);
  }
  if (typeof metadata.path !== "string" || metadata.path.trim().length === 0) {
    throw new Error(`Patchmill artifact metadata in ${label} has invalid path`);
  }
  if (
    typeof metadata.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(metadata.sha256)
  ) {
    throw new Error(
      `Patchmill artifact metadata in ${label} has invalid sha256`,
    );
  }

  return {
    kind: metadata.kind,
    path: metadata.path,
    sha256: metadata.sha256,
  };
}

export function issueHasPublishedArtifactMarker(issue: IssueSummary): boolean {
  return (issue.comments ?? []).some((comment) =>
    OPEN_MARKER_DETECTION_PATTERN.test(comment.body),
  );
}

function findPublishedArtifacts(
  issue: IssueSummary,
  options: PublishedArtifactExtractionOptions,
): PublishedArtifact[] {
  const artifacts: PublishedArtifact[] = [];
  const trustedAuthors = trustedAuthorSet(options.trustedAuthors);
  if (trustedAuthors.size === 0) return artifacts;

  for (const source of sourceBlocks(issue)) {
    if (!sourceIsTrusted(source, trustedAuthors)) continue;
    for (const match of source.body.matchAll(ARTIFACT_MARKER_PATTERN)) {
      const rawMetadata = match[1] ?? "";
      const rawContent = match[2] ?? "";
      const metadata = parseMetadata(rawMetadata, source.label);
      const content = normalizePublishedArtifactContent(rawContent);
      const actualHash = sha256(content);
      if (actualHash !== metadata.sha256) {
        throw new Error(
          `Patchmill ${metadata.kind} artifact checksum mismatch in ${source.label}`,
        );
      }
      artifacts.push({
        ...metadata,
        content,
        evidence: `${source.label}: ${titleForKind(metadata.kind)}`,
      });
    }
  }

  return artifacts;
}

function toInlineSource(
  artifact: PublishedArtifact,
): ArtifactExtractionInlineSource<typeof artifact.kind> {
  return {
    kind: artifact.kind,
    type: "inline",
    path: artifact.path,
    content: artifact.content,
    evidence: artifact.evidence,
  };
}

export function formatPublishedArtifactComment(
  input: PublishedArtifactInput,
): string {
  const content = normalizePublishedArtifactContent(input.content);
  if (artifactContentIsEmpty(content)) {
    throw new Error(artifactContentEmptyMessage(input.kind));
  }
  assertContentCanBePublished(content);
  const metadata = metadataJson({
    kind: input.kind,
    path: input.path,
    sha256: sha256(content),
  });
  const detailsOpen = input.kind === "spec" ? "<details open>" : "<details>";

  return [
    `## ${titleForKind(input.kind)}`,
    "",
    detailsOpen,
    `<summary>${summaryForKind(input.kind)}</summary>`,
    "",
    `${OPEN_MARKER} ${metadata} -->`,
    content,
    CLOSE_MARKER,
    "",
    "</details>",
  ].join("\n");
}

export function extractPublishedArtifactResult(
  issue: IssueSummary,
  options: PublishedArtifactExtractionOptions,
): ArtifactExtractionResult {
  const artifacts = findPublishedArtifacts(issue, options);
  const latest: Partial<Record<PublishedArtifactKind, PublishedArtifact>> = {};
  for (const artifact of artifacts) latest[artifact.kind] = artifact;

  const spec = latest.spec ? toInlineSource(latest.spec) : undefined;
  const plan = latest.plan ? toInlineSource(latest.plan) : undefined;
  if (!spec && !plan) return { status: "none" };

  return {
    status: "resolved",
    ...(spec ? { spec } : {}),
    ...(plan ? { plan } : {}),
  };
}
