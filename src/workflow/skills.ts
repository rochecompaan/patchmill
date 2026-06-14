import { BUNDLED_TRIAGE_SKILL_REFERENCE } from "./skill-resolution.ts";

export type PatchmillSkillsConfig = {
  triage: string;
  planning: string;
  implementation: string;
  developmentEnvironment?: string;
  toolchain?: string;
  review?: string;
  visualEvidence?: string;
  landing?: string;
};

export const PATCHMILL_SKILL_KEYS = [
  "triage",
  "planning",
  "implementation",
  "developmentEnvironment",
  "toolchain",
  "review",
  "visualEvidence",
  "landing",
] as const;

export type PatchmillSkillKey = (typeof PATCHMILL_SKILL_KEYS)[number];

export type PartialPatchmillSkillsConfig = Partial<PatchmillSkillsConfig>;

export { BUNDLED_TRIAGE_SKILL_REFERENCE };

export const DEFAULT_PATCHMILL_SKILLS: PatchmillSkillsConfig = {
  triage: BUNDLED_TRIAGE_SKILL_REFERENCE,
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
};

export const GLOBAL_PATCHMILL_SKILLS: PatchmillSkillsConfig = {
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

export {
  bundledTriageSkillPath,
  isNamespaceStyleSkill,
  isPathLikeSkill,
  resolveConfiguredSkillInvocation,
  resolvePathLikeSkillPath,
  skillInvocationArgs,
  skillInvocationPaths,
  type SkillInvocationResolution,
  type SkillResolutionDiagnostic,
  type SkillResolutionStatus,
} from "./skill-resolution.ts";
