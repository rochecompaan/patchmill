import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { AgentIssueVisualEvidence, CommandRunner } from "./types.ts";

export const DEFAULT_VISUAL_EVIDENCE_REFERENCE_DIR = "docs/screenshots";

export type ValidateVisualEvidenceReferencesInput = {
  repoRoot: string;
  evidence: AgentIssueVisualEvidence[] | undefined;
  runner: CommandRunner;
  referenceScreenshotPaths?: string[];
  onProgress?: (message: string) => void | Promise<void>;
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);
const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff]);
const GIF87A_SIGNATURE = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89A_SIGNATURE = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const RIFF_SIGNATURE = Uint8Array.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_SIGNATURE = Uint8Array.from([0x57, 0x45, 0x42, 0x50]);

function normalizeGitPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function configuredReferencePaths(paths: string[] | undefined): string[] {
  const configured = paths?.filter((path) => path.trim().length > 0) ?? [];
  return configured.length > 0
    ? configured.map(normalizeGitPath)
    : [DEFAULT_VISUAL_EVIDENCE_REFERENCE_DIR];
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const candidateRelativePath = relative(rootPath, candidatePath);
  return (
    candidateRelativePath === "" ||
    (!candidateRelativePath.startsWith("..") &&
      candidateRelativePath !== ".." &&
      !isAbsolute(candidateRelativePath))
  );
}

function isImagePath(path: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

function isAllowedReferencePath(
  evidencePath: string,
  referencePaths: string[],
): boolean {
  const normalizedEvidencePath = normalizeGitPath(evidencePath);
  return referencePaths.some((referencePath) => {
    const normalizedReferencePath = normalizeGitPath(referencePath);
    if (isImagePath(normalizedReferencePath)) {
      return normalizedEvidencePath === normalizedReferencePath;
    }
    return (
      normalizedEvidencePath === normalizedReferencePath ||
      normalizedEvidencePath.startsWith(`${normalizedReferencePath}/`)
    );
  });
}

function hasByteSignature(
  bytes: Uint8Array,
  signature: Uint8Array,
  offset = 0,
): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function hasSupportedImageMagic(bytes: Uint8Array): boolean {
  return (
    hasByteSignature(bytes, PNG_SIGNATURE) ||
    hasByteSignature(bytes, JPEG_SIGNATURE) ||
    hasByteSignature(bytes, GIF87A_SIGNATURE) ||
    hasByteSignature(bytes, GIF89A_SIGNATURE) ||
    (hasByteSignature(bytes, RIFF_SIGNATURE) &&
      hasByteSignature(bytes, WEBP_SIGNATURE, 8))
  );
}

async function resolveEvidencePath(
  repoRoot: string,
  screenshotPath: string,
): Promise<{ absolutePath: string; gitPath: string }> {
  const absoluteRoot = resolve(repoRoot);
  const candidatePath = isAbsolute(screenshotPath)
    ? screenshotPath
    : resolve(absoluteRoot, screenshotPath);
  const gitPath = normalizeGitPath(relative(absoluteRoot, candidatePath));
  if (gitPath === "" || gitPath.startsWith("../") || gitPath === "..") {
    throw new Error(
      `Visual evidence screenshot path must stay within the repo root: ${screenshotPath}`,
    );
  }

  let canonicalRoot: string;
  let canonicalCandidate: string;
  try {
    [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(absoluteRoot),
      realpath(candidatePath),
    ]);
  } catch (error) {
    throw new Error(
      `Visual evidence screenshot file is missing: ${screenshotPath}`,
      {
        cause: error,
      },
    );
  }
  if (!isWithinRoot(canonicalRoot, canonicalCandidate)) {
    throw new Error(
      `Visual evidence screenshot path must stay within the repo root: ${screenshotPath}`,
    );
  }
  return { absolutePath: candidatePath, gitPath };
}

function assertScreenshotLikeEvidence(
  screenshotPath: string,
  bytes: Uint8Array,
): void {
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extname(screenshotPath).toLowerCase())) {
    throw new Error(
      `Visual evidence screenshot must use one of ${Array.from(SUPPORTED_IMAGE_EXTENSIONS).join(", ")}: ${screenshotPath}`,
    );
  }
  if (!hasSupportedImageMagic(bytes)) {
    throw new Error(
      `Visual evidence screenshot must contain PNG, JPEG, GIF, or WebP image bytes: ${screenshotPath}`,
    );
  }
}

async function assertCommittedInHead(
  runner: CommandRunner,
  repoRoot: string,
  gitPath: string,
): Promise<void> {
  const lsTree = await runner.run(
    "git",
    ["ls-tree", "-r", "--name-only", "HEAD", "--", gitPath],
    { cwd: repoRoot },
  );
  if (lsTree.code !== 0) {
    throw new Error(
      `git ls-tree failed while checking visual evidence ${gitPath}: ${lsTree.stderr || lsTree.stdout}`,
    );
  }
  if (!lsTree.stdout.split(/\r?\n/u).includes(gitPath)) {
    throw new Error(
      `Visual evidence screenshot is not committed in HEAD: ${gitPath}`,
    );
  }

  for (const args of [
    ["diff", "--quiet", "--", gitPath],
    ["diff", "--cached", "--quiet", "--", gitPath],
  ]) {
    const diff = await runner.run("git", args, { cwd: repoRoot });
    if (diff.code === 0) continue;
    if (diff.code === 1) {
      throw new Error(
        `Visual evidence screenshot has uncommitted changes: ${gitPath}`,
      );
    }
    throw new Error(
      `git ${args.join(" ")} failed while checking visual evidence ${gitPath}: ${diff.stderr || diff.stdout}`,
    );
  }
}

export async function validateVisualEvidenceReferences(
  input: ValidateVisualEvidenceReferencesInput,
): Promise<AgentIssueVisualEvidence[]> {
  const evidence = input.evidence ?? [];
  if (evidence.length === 0) return [];

  const referencePaths = configuredReferencePaths(
    input.referenceScreenshotPaths,
  );
  for (const entry of evidence) {
    if (!isAllowedReferencePath(entry.screenshotPath, referencePaths)) {
      throw new Error(
        `Visual evidence must be a committed reference screenshot under ${referencePaths.join(", ")}: ${entry.screenshotPath}`,
      );
    }

    const { absolutePath, gitPath } = await resolveEvidencePath(
      input.repoRoot,
      entry.screenshotPath,
    );
    assertScreenshotLikeEvidence(
      entry.screenshotPath,
      await readFile(absolutePath),
    );
    await assertCommittedInHead(input.runner, input.repoRoot, gitPath);
  }

  await input.onProgress?.(
    `validated ${evidence.length} committed visual evidence reference screenshot${evidence.length === 1 ? "" : "s"}`,
  );
  return evidence;
}
