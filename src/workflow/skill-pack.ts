import { createHash, type BinaryLike } from "node:crypto";
import {
  BUNDLED_PATCHMILL_SKILLS,
  bundledSkillByKey,
  requiredFilesForBundledSkillName,
} from "./bundled-skills.ts";
import type { PatchmillSkillsConfig } from "./skills.ts";

export const DEFAULT_PROJECT_SKILL_DIR = ".patchmill/skills";
export const SKILL_PACK_METADATA_FILE = "patchmill-skill-pack.json";
export const SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL =
  "subagent-dev-with-validation-and-pr-checks";
export const SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL =
  "subagent-dev-with-codex-and-thermo-reviews";
export const SINGLE_SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL =
  "single-subagent-dev-with-codex-and-thermo-reviews";
export const PATCHMILL_PLANNING_SKILL = "patchmill-planning";
const bundledTriageSkill = bundledSkillByKey("triage");
const bundledVisualEvidenceSkill = bundledSkillByKey("visualEvidence");

if (!bundledTriageSkill || !bundledVisualEvidenceSkill) {
  throw new Error(
    "Bundled Patchmill skill registry is missing required skills",
  );
}

export const PATCHMILL_VISUAL_EVIDENCE_SKILL =
  bundledVisualEvidenceSkill.globalName;

export type SkillPackSource = {
  type: "github-release";
  repository: string;
  tag: string;
  tarballUrl: string;
};

export type SkillPackSkill = {
  name: string;
  source: "patchmill" | "superpowers";
};

export type SkillPack = {
  name: "patchmill-recommended";
  version: string;
  source: SkillPackSource;
  skills: SkillPackSkill[];
};

export type SkillPackMetadataFile = {
  pack: {
    name: string;
    version: string;
    source: SkillPackSource;
  };
  installedAt: "<generated-by-init>" | string;
  skillDir: string;
  metadataFile: typeof SKILL_PACK_METADATA_FILE;
  files: Array<{ path: string; sha256: string }>;
};

export function requiredSkillFiles(skillName: string): string[] {
  return requiredFilesForBundledSkillName(skillName);
}

export const PATCHMILL_RECOMMENDED_SKILL_PACK: SkillPack = {
  name: "patchmill-recommended",
  version: "2026.07.1",
  source: {
    type: "github-release",
    repository: "obra/superpowers",
    tag: "v6.0.3",
    tarballUrl:
      "https://github.com/obra/superpowers/archive/refs/tags/v6.0.3.tar.gz",
  },
  skills: [
    { name: bundledTriageSkill.globalName, source: "patchmill" },
    {
      name: SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
      source: "patchmill",
    },
    {
      name: SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL,
      source: "patchmill",
    },
    {
      name: SINGLE_SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL,
      source: "patchmill",
    },
    { name: "module-size", source: "patchmill" },
    { name: PATCHMILL_VISUAL_EVIDENCE_SKILL, source: "patchmill" },
    { name: PATCHMILL_PLANNING_SKILL, source: "patchmill" },
    { name: "brainstorming", source: "superpowers" },
    { name: "dispatching-parallel-agents", source: "superpowers" },
    { name: "executing-plans", source: "superpowers" },
    { name: "finishing-a-development-branch", source: "superpowers" },
    { name: "receiving-code-review", source: "superpowers" },
    { name: "requesting-code-review", source: "superpowers" },
    { name: "subagent-driven-development", source: "superpowers" },
    { name: "systematic-debugging", source: "superpowers" },
    { name: "test-driven-development", source: "superpowers" },
    { name: "using-git-worktrees", source: "superpowers" },
    { name: "using-superpowers", source: "superpowers" },
    { name: "verification-before-completion", source: "superpowers" },
    { name: "writing-plans", source: "superpowers" },
    { name: "writing-skills", source: "superpowers" },
  ],
};

function trimTrailingSkillDirSlashes(skillDir: string): string {
  return skillDir.replace(/\/+$/u, "");
}

export function projectSkillPath(
  skillName: string,
  skillDir = DEFAULT_PROJECT_SKILL_DIR,
): string {
  return `${trimTrailingSkillDirSlashes(skillDir)}/${skillName}`;
}

export function buildRecommendedProjectSkillConfig(
  skillDir = DEFAULT_PROJECT_SKILL_DIR,
): Pick<
  PatchmillSkillsConfig,
  "triage" | "planning" | "implementation" | "visualEvidence"
> {
  const bundledProjectLocalConfig = Object.fromEntries(
    BUNDLED_PATCHMILL_SKILLS.flatMap((skill) =>
      skill.recommendedProjectLocal && skill.projectSkillConfigKey
        ? [
            [
              skill.projectSkillConfigKey,
              projectSkillPath(skill.globalName, skillDir),
            ],
          ]
        : [],
    ),
  ) as Pick<PatchmillSkillsConfig, "triage" | "visualEvidence">;

  return {
    triage: bundledProjectLocalConfig.triage,
    planning: projectSkillPath(PATCHMILL_PLANNING_SKILL, skillDir),
    implementation: projectSkillPath(
      SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
      skillDir,
    ),
    visualEvidence: bundledProjectLocalConfig.visualEvidence,
  };
}

export function hashContent(content: BinaryLike): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashText(text: string): string {
  return hashContent(text);
}

export function buildSkillPackMetadata(
  files: Array<{ path: string; sha256: string }>,
  options: { installedAt?: string; skillDir?: string } = {},
): SkillPackMetadataFile {
  return {
    pack: {
      name: PATCHMILL_RECOMMENDED_SKILL_PACK.name,
      version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
      source: PATCHMILL_RECOMMENDED_SKILL_PACK.source,
    },
    installedAt: options.installedAt ?? "<generated-by-init>",
    skillDir: trimTrailingSkillDirSlashes(
      options.skillDir ?? DEFAULT_PROJECT_SKILL_DIR,
    ),
    metadataFile: SKILL_PACK_METADATA_FILE,
    files: files.map((file) => ({ ...file })),
  };
}
