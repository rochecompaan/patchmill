import { createHash, type BinaryLike } from "node:crypto";
import type { PatchmillSkillsConfig } from "./skills.ts";

export const DEFAULT_PROJECT_SKILL_DIR = ".patchmill/skills";
export const SKILL_PACK_METADATA_FILE = "patchmill-skill-pack.json";
export const SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL =
  "subagent-dev-with-codex-and-thermo-reviews";

export type SkillPackSource = {
  type: "github-release";
  repository: "obra/superpowers";
  tag: "v5.0.7";
  tarballUrl: "https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz";
};

export type SkillPackSkill = {
  name: string;
  source: "patchmill" | "superpowers";
};

export type SkillPack = {
  name: "patchmill-recommended";
  version: "2026.05";
  source: SkillPackSource;
  skills: SkillPackSkill[];
};

export type SkillPackMetadataFile = {
  pack: {
    name: SkillPack["name"];
    version: SkillPack["version"];
    source: SkillPackSource;
  };
  installedAt: "<generated-by-init>" | string;
  skillDir: string;
  metadataFile: typeof SKILL_PACK_METADATA_FILE;
  files: Array<{ path: string; sha256: string }>;
};

export const PATCHMILL_RECOMMENDED_SKILL_PACK: SkillPack = {
  name: "patchmill-recommended",
  version: "2026.05",
  source: {
    type: "github-release",
    repository: "obra/superpowers",
    tag: "v5.0.7",
    tarballUrl:
      "https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz",
  },
  skills: [
    { name: "patchmill-issue-triage", source: "patchmill" },
    {
      name: SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL,
      source: "patchmill",
    },
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
): Pick<PatchmillSkillsConfig, "triage" | "planning" | "implementation"> {
  return {
    triage: projectSkillPath("patchmill-issue-triage", skillDir),
    planning: projectSkillPath("writing-plans", skillDir),
    implementation: projectSkillPath("subagent-driven-development", skillDir),
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
