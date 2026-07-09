import { existsSync } from "node:fs";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PROJECT_SKILL_DIR } from "./skill-pack.ts";

export type SkillResolutionStatus = "pass" | "warn" | "fail";

export type SkillResolutionDiagnostic = {
  status: SkillResolutionStatus;
  summary: string;
};

export type SkillInvocationResolution = {
  paths: string[];
  diagnostics: SkillResolutionDiagnostic[];
  configuredProjectLocalPaths: string[];
  usedProjectLocalPack: boolean;
};

export const BUNDLED_TRIAGE_SKILL_REFERENCE = "patchmill:bundled-issue-triage";
export const BUNDLED_ARTIFACT_EXTRACTION_SKILL_REFERENCE =
  "patchmill:bundled-artifact-extraction";
export const BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE =
  "patchmill:bundled-visual-evidence";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const SKILL_NAMESPACE_PATTERN = /^[a-z0-9-]+:.+$/iu;
const SKILL_FILE_NAME = "SKILL.md";

function bundledSkillPath(skillDirName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourceTreePath = join(
    here,
    "..",
    "..",
    "skills",
    skillDirName,
    "SKILL.md",
  );
  const builtPackagePath = join(
    here,
    "..",
    "..",
    "..",
    "skills",
    skillDirName,
    "SKILL.md",
  );

  return existsSync(sourceTreePath) ? sourceTreePath : builtPackagePath;
}

export function bundledTriageSkillPath(): string {
  return bundledSkillPath("patchmill-issue-triage");
}

export function bundledArtifactExtractionSkillPath(): string {
  return bundledSkillPath("patchmill-artifact-extraction");
}

export function bundledVisualEvidenceSkillPath(): string {
  return bundledSkillPath("patchmill-visual-evidence");
}

export function isNamespaceStyleSkill(skill: string): boolean {
  return (
    SKILL_NAMESPACE_PATTERN.test(skill) &&
    !WINDOWS_ABSOLUTE_PATH_PATTERN.test(skill)
  );
}

export function isPathLikeSkill(skill: string): boolean {
  if (
    skill.startsWith(".") ||
    skill.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(skill)
  ) {
    return true;
  }

  return /[\\/]/u.test(skill) && !isNamespaceStyleSkill(skill);
}

function isSkillFilePath(skill: string): boolean {
  const normalizedPath = skill.replaceAll("\\", "/");
  return (
    normalizedPath === SKILL_FILE_NAME ||
    normalizedPath.endsWith(`/${SKILL_FILE_NAME}`)
  );
}

export function resolvePathLikeSkillPath(
  skill: string,
  repoRoot: string,
): string {
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(skill)) {
    return isSkillFilePath(skill)
      ? win32.normalize(skill)
      : win32.join(skill, SKILL_FILE_NAME);
  }

  const normalizedPath = skill.replaceAll("\\", "/");
  if (isSkillFilePath(normalizedPath)) {
    return normalizedPath.startsWith("/")
      ? resolve(normalizedPath)
      : resolve(repoRoot, normalizedPath);
  }

  return normalizedPath.startsWith("/")
    ? resolve(normalizedPath, SKILL_FILE_NAME)
    : resolve(repoRoot, normalizedPath, SKILL_FILE_NAME);
}

function pathStartsWith(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}\\`)
  );
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

export function resolveConfiguredSkillInvocation(
  skills: Array<string | undefined>,
  repoRoot: string,
): SkillInvocationResolution {
  const diagnostics: SkillResolutionDiagnostic[] = [];
  const configuredPaths = skills.flatMap((skill) => {
    if (!skill) return [];
    if (skill === BUNDLED_TRIAGE_SKILL_REFERENCE) {
      return [bundledTriageSkillPath()];
    }
    if (skill === BUNDLED_ARTIFACT_EXTRACTION_SKILL_REFERENCE) {
      return [bundledArtifactExtractionSkillPath()];
    }
    if (skill === BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE) {
      return [bundledVisualEvidenceSkillPath()];
    }
    if (!isPathLikeSkill(skill)) return [];
    return [resolvePathLikeSkillPath(skill, repoRoot)];
  });

  const projectLocalRoot = resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
  const configuredProjectLocalPaths = configuredPaths.filter((path) =>
    pathStartsWith(resolve(path), projectLocalRoot),
  );

  if (configuredProjectLocalPaths.length === 0) {
    return {
      paths: unique(configuredPaths),
      diagnostics,
      configuredProjectLocalPaths,
      usedProjectLocalPack: false,
    };
  }

  return {
    paths: unique(configuredPaths),
    diagnostics,
    configuredProjectLocalPaths: unique(configuredProjectLocalPaths),
    usedProjectLocalPack: true,
  };
}

export function skillInvocationPaths(
  skills: Array<string | undefined>,
  repoRoot: string,
): string[] {
  return resolveConfiguredSkillInvocation(skills, repoRoot).paths;
}

export function skillInvocationArgs(
  skill: string | undefined,
  repoRoot: string,
): string[] {
  return skillInvocationPaths([skill], repoRoot).flatMap((path) => [
    "--skill",
    path,
  ]);
}
