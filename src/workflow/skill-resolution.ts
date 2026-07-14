import { statSync } from "node:fs";
import { resolve, win32 } from "node:path";
import {
  bundledSkillByKey,
  bundledSkillPath,
  bundledSkillPathForReference,
} from "./bundled-skills.ts";
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

const bundledTriageSkill = bundledSkillByKey("triage");
const bundledVisualEvidenceSkill = bundledSkillByKey("visualEvidence");

if (!bundledTriageSkill || !bundledVisualEvidenceSkill) {
  throw new Error(
    "Bundled Patchmill skill registry is missing required skills",
  );
}

export const BUNDLED_TRIAGE_SKILL_REFERENCE =
  bundledTriageSkill.configReference;
export const BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE =
  bundledVisualEvidenceSkill.configReference;

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const SKILL_NAMESPACE_PATTERN = /^[a-z0-9-]+:.+$/iu;
const SKILL_FILE_NAME = "SKILL.md";

export function bundledTriageSkillPath(): string {
  return bundledSkillPath(bundledTriageSkill);
}

export function bundledVisualEvidenceSkillPath(): string {
  return bundledSkillPath(bundledVisualEvidenceSkill);
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

function readableDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function projectLocalSkillRoot(repoRoot: string): string {
  return resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
}

function isProjectLocalSkillPath(path: string, repoRoot: string): boolean {
  return pathStartsWith(resolve(path), projectLocalSkillRoot(repoRoot));
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
    const bundledPath = bundledSkillPathForReference(skill);
    if (bundledPath) return [bundledPath];
    if (!isPathLikeSkill(skill)) return [];
    return [resolvePathLikeSkillPath(skill, repoRoot)];
  });

  const projectLocalRoot = projectLocalSkillRoot(repoRoot);
  const projectLocalRootAvailable = readableDirectory(projectLocalRoot);
  const configuredProjectLocalPaths = configuredPaths.filter((path) =>
    isProjectLocalSkillPath(path, repoRoot),
  );
  const configuredOutsideProjectLocalPaths = configuredPaths.filter(
    (path) =>
      !projectLocalRootAvailable || !isProjectLocalSkillPath(path, repoRoot),
  );

  return {
    paths: unique([
      ...(projectLocalRootAvailable ? [projectLocalRoot] : []),
      ...configuredOutsideProjectLocalPaths,
    ]),
    diagnostics,
    configuredProjectLocalPaths: unique(configuredProjectLocalPaths),
    usedProjectLocalPack: projectLocalRootAvailable,
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
