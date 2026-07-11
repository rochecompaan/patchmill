import { createHash } from "node:crypto";

export type WorkflowArtifactKind = "spec" | "plan";

export const MIN_WORKFLOW_ARTIFACT_CONTENT_LENGTH = 8;

export type PublishedWorkflowArtifactInput = {
  kind: WorkflowArtifactKind;
  path: string;
  content: string;
};

export type PublishedWorkflowArtifact = {
  path: string;
  content: string;
  evidence: string;
  commit?: string;
};

export type PublishedWorkflowArtifacts = Partial<
  Record<WorkflowArtifactKind, PublishedWorkflowArtifact>
>;

export type PublishedArtifactTrustOptions = {
  trustedAuthors: readonly string[];
};

export type PublishedArtifactIssue = {
  body?: string;
  comments?: Array<{
    body: string;
    authorLogin?: string;
  }>;
};

type PublishedArtifactMetadata = {
  kind: WorkflowArtifactKind;
  path: string;
  sha256: string;
};

type ParsedPublishedArtifact = PublishedArtifactMetadata & {
  content: string;
  evidence: string;
};

type PublishedArtifactSourceBlock = {
  body: string;
  label: string;
  authorLogin?: string;
};

type MetadataParseResult =
  | { status: "valid"; metadata: PublishedArtifactMetadata }
  | { status: "invalid"; kind?: WorkflowArtifactKind; error: Error };

type ArtifactParseResult =
  | { status: "valid"; artifact: ParsedPublishedArtifact }
  | { status: "invalid"; kind?: WorkflowArtifactKind; error: Error };

const OPEN_MARKER = "<!-- patchmill-artifact:v1";
const CLOSE_MARKER = "<!-- /patchmill-artifact -->";
const ARTIFACT_MARKER_PATTERN =
  /<!--\s*patchmill-artifact:v1\s+(\{[^\n]*\})\s*-->\n?([\s\S]*?)\n?<!--\s*\/patchmill-artifact\s*-->/gu;
const OPEN_MARKER_DETECTION_PATTERN = /<!--\s*patchmill-artifact:v1\b/iu;
const CLOSE_MARKER_DETECTION_PATTERN = /<!--\s*\/patchmill-artifact\s*-->/iu;

function titleForKind(kind: WorkflowArtifactKind): string {
  return kind === "spec"
    ? "Spec attached to this issue"
    : "Implementation plan attached to this issue";
}

function summaryForKind(kind: WorkflowArtifactKind): string {
  return kind === "spec" ? "Spec content" : "Implementation plan content";
}

export function normalizePublishedArtifactContent(content: string): string {
  return content.replace(/\r\n?/gu, "\n").trim();
}

export function artifactContentIsEmpty(content: string): boolean {
  return (
    normalizePublishedArtifactContent(content).length <
    MIN_WORKFLOW_ARTIFACT_CONTENT_LENGTH
  );
}

export function artifactContentEmptyMessage(
  kind: WorkflowArtifactKind,
): string {
  return `${kind} artifact content is empty`;
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

function sourceBlocks(
  issue: PublishedArtifactIssue,
): PublishedArtifactSourceBlock[] {
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

function metadataKind(
  metadata: Record<string, unknown>,
): WorkflowArtifactKind | undefined {
  return metadata.kind === "spec" || metadata.kind === "plan"
    ? metadata.kind
    : undefined;
}

function parseMetadata(raw: string, label: string): MetadataParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      status: "invalid",
      error: new Error(
        `Patchmill artifact metadata in ${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      ),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      status: "invalid",
      error: new Error(
        `Patchmill artifact metadata in ${label} is not an object`,
      ),
    };
  }
  const metadata = parsed as Record<string, unknown>;
  const kind = metadataKind(metadata);
  if (!kind) {
    return {
      status: "invalid",
      error: new Error(
        `Patchmill artifact metadata in ${label} has invalid kind`,
      ),
    };
  }
  if (typeof metadata.path !== "string" || metadata.path.trim().length === 0) {
    return {
      status: "invalid",
      kind,
      error: new Error(
        `Patchmill artifact metadata in ${label} has invalid path`,
      ),
    };
  }
  if (
    typeof metadata.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(metadata.sha256)
  ) {
    return {
      status: "invalid",
      kind,
      error: new Error(
        `Patchmill artifact metadata in ${label} has invalid sha256`,
      ),
    };
  }

  return {
    status: "valid",
    metadata: {
      kind,
      path: metadata.path,
      sha256: metadata.sha256,
    },
  };
}

function parsePublishedArtifactMarker(
  rawMetadata: string,
  rawContent: string,
  label: string,
): ArtifactParseResult {
  const parsed = parseMetadata(rawMetadata, label);
  if (parsed.status === "invalid") return parsed;

  const { metadata } = parsed;
  const content = normalizePublishedArtifactContent(rawContent);
  const actualHash = sha256(content);
  if (actualHash !== metadata.sha256) {
    return {
      status: "invalid",
      kind: metadata.kind,
      error: new Error(
        `Patchmill ${metadata.kind} artifact checksum mismatch in ${label}`,
      ),
    };
  }

  return {
    status: "valid",
    artifact: {
      ...metadata,
      content,
      evidence: `${label}: ${titleForKind(metadata.kind)}`,
    },
  };
}

function toPublishedWorkflowArtifact(
  artifact: ParsedPublishedArtifact,
): PublishedWorkflowArtifact {
  return {
    path: artifact.path,
    content: artifact.content,
    evidence: artifact.evidence,
  };
}

function hasResolvedArtifact(artifacts: PublishedWorkflowArtifacts): boolean {
  return Boolean(artifacts.spec || artifacts.plan);
}

function publishedArtifactMatches(
  source: PublishedArtifactSourceBlock,
): RegExpMatchArray[] {
  return [...source.body.matchAll(ARTIFACT_MARKER_PATTERN)];
}

export function issueHasPublishedArtifactMarker(
  issue: PublishedArtifactIssue,
): boolean {
  return (issue.comments ?? []).some((comment) =>
    OPEN_MARKER_DETECTION_PATTERN.test(comment.body),
  );
}

export function extractPublishedArtifactsFromIssue(
  issue: PublishedArtifactIssue,
  options: PublishedArtifactTrustOptions,
): PublishedWorkflowArtifacts {
  const artifacts: PublishedWorkflowArtifacts = {};
  const trustedAuthors = trustedAuthorSet(options.trustedAuthors);
  if (trustedAuthors.size === 0) return artifacts;

  for (const source of sourceBlocks(issue).reverse()) {
    if (artifacts.spec && artifacts.plan) return artifacts;
    if (!sourceIsTrusted(source, trustedAuthors)) continue;

    for (const match of publishedArtifactMatches(source).reverse()) {
      const parsed = parsePublishedArtifactMarker(
        match[1] ?? "",
        match[2] ?? "",
        source.label,
      );

      if (parsed.status === "valid") {
        if (!artifacts[parsed.artifact.kind]) {
          artifacts[parsed.artifact.kind] = toPublishedWorkflowArtifact(
            parsed.artifact,
          );
        }
        continue;
      }

      if (parsed.kind) {
        if (!artifacts[parsed.kind]) throw parsed.error;
        continue;
      }

      if (!hasResolvedArtifact(artifacts)) throw parsed.error;
    }
  }

  return artifacts;
}

export function formatPublishedArtifactComment(
  input: PublishedWorkflowArtifactInput,
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
