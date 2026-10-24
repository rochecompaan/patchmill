import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  BUNDLED_PATCHMILL_SKILLS,
  bundledSkillByKey,
} from "./bundled-skills.ts";
import {
  INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
  requiredRuntimeFiles,
} from "./skill-runtime-requirements.ts";

export { INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL } from "./skill-runtime-requirements.ts";
import type { PatchmillSkillsConfig } from "./skills.ts";

export const DEFAULT_PROJECT_SKILL_DIR = ".patchmill/skills";
export const SKILL_PACK_METADATA_FILE = "patchmill-skill-pack.json";
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

export type SkillPackUpstreamSource = {
  repository: string;
  commit: string;
  files: Array<{ sourcePath: string; targetPath: string }>;
  license: { name: string; sourcePath: string; targetPath?: string };
};
export type SkillPackSkill = {
  name: string;
  source: "patchmill" | "superpowers" | "simple-english";
  upstreamSources?: SkillPackUpstreamSource[];
};
export type SkillPackMetadataSkill = {
  name: string;
  source: SkillPackSkill["source"];
  requiredFiles: string[];
  upstreamSources?: Array<{
    repository: string;
    commit: string;
    files: Array<{ sourcePath: string; installedPath: string }>;
    license: { name: string; sourcePath: string; installedPath?: string };
  }>;
};

export type SkillPack = {
  name: "patchmill-recommended";
  version: string;
  source: SkillPackSource;
  additionalSources: SkillPackSource[];
  skills: SkillPackSkill[];
};

export type SkillPackMetadataFile = {
  pack: {
    name: string;
    version: string;
    source: SkillPackSource;
    /** Written since 2026.09.2; absent in metadata installed by older packs. */
    additionalSources?: SkillPackSource[];
  };
  installedAt: "<generated-by-init>" | string;
  skillDir: string;
  metadataFile: typeof SKILL_PACK_METADATA_FILE;
  files: Array<{ path: string; sha256: string }>;
  /** Absent only in metadata from older managed packs. */
  skills?: SkillPackMetadataSkill[];
};

export function requiredSkillFiles(skillName: string): string[] {
  return requiredRuntimeFiles(skillName).map((requirement) => requirement.path);
}

export const PATCHMILL_RECOMMENDED_SKILL_PACK: SkillPack = {
  name: "patchmill-recommended",
  version: "2026.10.2",
  source: {
    type: "github-release",
    repository: "obra/superpowers",
    tag: "v7.0.1",
    tarballUrl:
      "https://github.com/obra/superpowers/archive/refs/tags/v7.0.1.tar.gz",
  },
  additionalSources: [
    {
      type: "github-release",
      repository: "AminBlg/SimpleEnglish",
      tag: "v1.2.0",
      tarballUrl:
        "https://github.com/AminBlg/SimpleEnglish/archive/refs/tags/v1.2.0.tar.gz",
    },
  ],
  skills: [
    { name: bundledTriageSkill.globalName, source: "patchmill" },
    {
      name: INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
      source: "patchmill",
    },
    { name: "module-size", source: "patchmill" },
    { name: PATCHMILL_VISUAL_EVIDENCE_SKILL, source: "patchmill" },
    { name: PATCHMILL_PLANNING_SKILL, source: "patchmill" },
    {
      name: "frontend-design",
      source: "patchmill",
      upstreamSources: [
        {
          repository: "anthropics/skills",
          commit: "41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f",
          files: [
            {
              sourcePath: "skills/frontend-design/SKILL.md",
              targetPath: "SKILL.md",
            },
            {
              sourcePath: "skills/frontend-design/LICENSE.txt",
              targetPath: "LICENSE.txt",
            },
          ],
          license: {
            name: "Apache-2.0",
            sourcePath: "skills/frontend-design/LICENSE.txt",
            targetPath: "LICENSE.txt",
          },
        },
      ],
    },
    {
      name: "patchmill-frontend-review",
      source: "patchmill",
      upstreamSources: [
        {
          repository: "vercel-labs/agent-skills",
          commit: "ba46938889d4e58635362fb8f618e1178ac3ec46",
          files: [
            {
              sourcePath: "skills/web-design-guidelines/SKILL.md",
              targetPath: "references/upstream-web-design-guidelines.md",
            },
          ],
          license: { name: "MIT", sourcePath: "README.md#license" },
        },
        {
          repository: "vercel-labs/web-interface-guidelines",
          commit: "e3d624baaf29dc1fc645aff3e38f03e564d2d6b1",
          files: [
            {
              sourcePath: "command.md",
              targetPath: "references/web-interface-guidelines.md",
            },
            { sourcePath: "LICENSE", targetPath: "LICENSE" },
          ],
          license: {
            name: "MIT",
            sourcePath: "LICENSE",
            targetPath: "LICENSE",
          },
        },
      ],
    },
    { name: "simple-english", source: "simple-english" },
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

  const triage = bundledProjectLocalConfig.triage;
  const visualEvidence = bundledProjectLocalConfig.visualEvidence;
  if (triage === undefined || visualEvidence === undefined) {
    throw new Error("Bundled project-local skill config is incomplete");
  }
  return {
    triage,
    planning: projectSkillPath(PATCHMILL_PLANNING_SKILL, skillDir),
    implementation: projectSkillPath(
      INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
      skillDir,
    ),
    visualEvidence,
  };
}

/** Matches the byte-view input accepted by createHash.update. */
type HashContentInput = Parameters<ReturnType<typeof createHash>["update"]>[0];

export function hashContent(content: HashContentInput): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashText(text: string): string {
  return hashContent(text);
}

function metadataSkill(
  skill: SkillPackSkill,
  skillDir: string,
): SkillPackMetadataSkill {
  const installed = (path: string) =>
    posix.normalize(`${skillDir}/${skill.name}/${path}`);
  return {
    name: skill.name,
    source: skill.source,
    requiredFiles: requiredRuntimeFiles(skill.name).map(({ path }) =>
      installed(path),
    ),
    ...(skill.upstreamSources === undefined
      ? {}
      : {
          upstreamSources: skill.upstreamSources.map((source) => ({
            repository: source.repository,
            commit: source.commit,
            files: source.files.map((file) => ({
              sourcePath: file.sourcePath,
              installedPath: installed(file.targetPath),
            })),
            license: {
              name: source.license.name,
              sourcePath: source.license.sourcePath,
              ...(source.license.targetPath === undefined
                ? {}
                : { installedPath: installed(source.license.targetPath) }),
            },
          })),
        }),
  };
}

export function buildSkillPackMetadata(
  files: Array<{ path: string; sha256: string }>,
  options: {
    installedAt?: string;
    skillDir?: string;
    skills?: SkillPackSkill[];
  } = {},
): SkillPackMetadataFile {
  const skillDir = trimTrailingSkillDirSlashes(
    options.skillDir ?? DEFAULT_PROJECT_SKILL_DIR,
  );
  return {
    pack: {
      name: PATCHMILL_RECOMMENDED_SKILL_PACK.name,
      version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
      source: PATCHMILL_RECOMMENDED_SKILL_PACK.source,
      additionalSources: PATCHMILL_RECOMMENDED_SKILL_PACK.additionalSources.map(
        (source) => ({ ...source }),
      ),
    },
    installedAt: options.installedAt ?? "<generated-by-init>",
    skillDir,
    skills: (options.skills ?? PATCHMILL_RECOMMENDED_SKILL_PACK.skills).map(
      (skill) => metadataSkill(skill, skillDir),
    ),
    metadataFile: SKILL_PACK_METADATA_FILE,
    files: files.map((file) => ({ ...file })),
  };
}
