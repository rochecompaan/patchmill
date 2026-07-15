import { bundledSkillByKey } from "./bundled-skills.ts";
import {
  BUNDLED_TRIAGE_SKILL_REFERENCE,
  BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE,
} from "./skill-resolution.ts";

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

export const DEPRECATED_PATCHMILL_SKILL_KEYS = ["artifactExtraction"] as const;

export type DeprecatedPatchmillSkillKey =
  (typeof DEPRECATED_PATCHMILL_SKILL_KEYS)[number];

export type PartialPatchmillSkillsConfig = Partial<PatchmillSkillsConfig>;

export {
  BUNDLED_TRIAGE_SKILL_REFERENCE,
  BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE,
};

const bundledTriageSkill = bundledSkillByKey("triage");
const bundledVisualEvidenceSkill = bundledSkillByKey("visualEvidence");

if (!bundledTriageSkill || !bundledVisualEvidenceSkill) {
  throw new Error(
    "Bundled Patchmill skill registry is missing required skills",
  );
}

export const DEFAULT_PATCHMILL_SKILLS: PatchmillSkillsConfig = {
  triage: bundledTriageSkill.configReference,
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
  visualEvidence: bundledVisualEvidenceSkill.configReference,
};

export const GLOBAL_PATCHMILL_SKILLS: PatchmillSkillsConfig = {
  triage: bundledTriageSkill.globalName,
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
  visualEvidence: bundledVisualEvidenceSkill.globalName,
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
  bundledVisualEvidenceSkillPath,
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
