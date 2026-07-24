import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  formatPublishedArtifactComment,
  type WorkflowArtifactKind,
} from "./published-artifacts.ts";

export type PublishComment = (
  issueNumber: number,
  body: string,
) => Promise<void>;

export type PublishWorkflowArtifactOptions = {
  kind: WorkflowArtifactKind;
  issueNumber: number;
  repoRoot: string;
  artifactPath: string;
  artifactDir: string;
  publishComment: PublishComment;
};

export type PublishedWorkflowArtifactResult = {
  path: string;
};

function artifactName(kind: WorkflowArtifactKind): string {
  return kind === "spec" ? "spec" : "plan";
}

function artifactDirName(kind: WorkflowArtifactKind): string {
  return kind === "spec" ? "specsDir" : "plansDir";
}

function normalizeRepoPath(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).replaceAll("\\", "/");
}

function pathInside(path: string, dir: string): boolean {
  const absoluteDir = resolve(dir);
  const absolutePath = resolve(path);
  const rel = relative(absoluteDir, absolutePath);
  return (
    rel.length === 0 || (!rel.startsWith("..") && !rel.includes(`..${sep}`))
  );
}

async function assertFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error(`${path} is not a file`);
}

export async function publishWorkflowArtifact(
  options: PublishWorkflowArtifactOptions,
): Promise<PublishedWorkflowArtifactResult> {
  const absolutePath = isAbsolute(options.artifactPath)
    ? resolve(options.artifactPath)
    : resolve(options.repoRoot, options.artifactPath);
  if (!pathInside(absolutePath, options.artifactDir)) {
    throw new Error(
      `${artifactName(options.kind)} path must be inside configured ${artifactDirName(options.kind)}`,
    );
  }
  await assertFile(absolutePath);

  const path = normalizeRepoPath(options.repoRoot, absolutePath);
  const content = await readFile(absolutePath, "utf8");
  await options.publishComment(
    options.issueNumber,
    formatPublishedArtifactComment({ kind: options.kind, path, content }),
  );
  return { path };
}
