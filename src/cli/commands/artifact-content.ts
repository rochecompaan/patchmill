export type ArtifactContentKind = "spec" | "plan";

export const MIN_ARTIFACT_CONTENT_LENGTH = 8;

export function normalizeArtifactContent(content: string): string {
  return content.replace(/\r\n?/gu, "\n").trim();
}

export function artifactContentIsEmpty(content: string): boolean {
  return normalizeArtifactContent(content).length < MIN_ARTIFACT_CONTENT_LENGTH;
}

export function artifactContentEmptyMessage(kind: ArtifactContentKind): string {
  return `${kind} artifact content is empty`;
}
