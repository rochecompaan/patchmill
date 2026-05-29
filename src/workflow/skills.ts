import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export type PatchmillSkillsConfig = {
  triage: string;
  planning: string;
  implementation: string;
  toolchain?: string;
  review?: string;
  visualEvidence?: string;
  landing?: string;
};

export const PATCHMILL_SKILL_KEYS = [
  "triage",
  "planning",
  "implementation",
  "toolchain",
  "review",
  "visualEvidence",
  "landing",
] as const;

export type PatchmillSkillKey = (typeof PATCHMILL_SKILL_KEYS)[number];

export type PartialPatchmillSkillsConfig = Partial<PatchmillSkillsConfig>;

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const SKILL_NAMESPACE_PATTERN = /^[a-z0-9-]+:.+$/iu;
const SKILL_FILE_NAME = "SKILL.md";

export const DEFAULT_PATCHMILL_SKILLS: PatchmillSkillsConfig = {
  triage: "patchmill-issue-triage",
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
};

export function cloneSkillsConfig(
  config: PatchmillSkillsConfig,
): PatchmillSkillsConfig {
  return { ...config };
}

export function mergeSkillsConfig(
  base: PatchmillSkillsConfig,
  update: PartialPatchmillSkillsConfig | undefined,
): PatchmillSkillsConfig {
  if (!update) return { ...base };

  const merged = { ...base };

  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) {
      merged[key as PatchmillSkillKey] = value;
    }
  }

  return merged;
}

export function renderConfiguredSkillLine(
  prefix: string,
  skill: string | undefined,
): string {
  if (!skill) return "";
  return `${prefix}: \`${skill}\`.`;
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

export function skillInvocationArgs(
  skill: string | undefined,
  repoRoot: string,
): string[] {
  if (!skill) return [];
  if (skill === DEFAULT_PATCHMILL_SKILLS.triage) {
    return ["--skill", bundledTriageSkillPath()];
  }
  if (!isPathLikeSkill(skill)) return [];

  return ["--skill", resolvePathLikeSkillPath(skill, repoRoot)];
}

export function skillInvocationPaths(
  skills: Array<string | undefined>,
  repoRoot: string,
): string[] {
  return skills.flatMap((skill) => {
    const [flag, path] = skillInvocationArgs(skill, repoRoot);
    return flag === "--skill" && path ? [path] : [];
  });
}

export function bundledTriageSkillPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "skills", "patchmill-issue-triage", "SKILL.md");
}
