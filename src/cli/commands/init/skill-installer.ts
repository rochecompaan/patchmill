import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  BUNDLED_PATCHMILL_SKILLS,
  bundledSkillByKey,
  bundledSkillDir,
} from "../../../workflow/bundled-skills.ts";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_PLANNING_SKILL,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL,
  SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
  projectSkillPath,
  requiredSkillFiles,
  type SkillPackSkill,
} from "../../../workflow/skill-pack.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";

const require = createRequire(import.meta.url);

export type SourceRoots = {
  patchmillSkillsDir: string;
  superpowersSkillsDir: string;
};

export type ProjectSkillInstallResult = {
  skillDir: string;
  skillConfig: Pick<
    PatchmillSkillsConfig,
    "triage" | "planning" | "implementation" | "visualEvidence"
  >;
  installedSkills: string[];
  metadataPath: string;
};

export type SkillInstallerDependencies = {
  access: typeof access;
  chmod: typeof chmod;
  cp: typeof cp;
  mkdtemp: typeof mkdtemp;
  mkdir: typeof mkdir;
  readdir: typeof readdir;
  readFile: typeof readFile;
  rename: typeof rename;
  rm: typeof rm;
  stat: typeof stat;
  writeFile: typeof writeFile;
};

const defaultDependencies: SkillInstallerDependencies = {
  access,
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
};

export function defaultSkillSourceRoots(): SourceRoots {
  const superpowersRoot = dirname(require.resolve("superpowers/package.json"));
  const bundledTriageSkill = bundledSkillByKey("triage");
  if (!bundledTriageSkill) {
    throw new Error("Bundled Patchmill skill registry is missing triage skill");
  }
  return {
    patchmillSkillsDir: resolve(bundledSkillDir(bundledTriageSkill), ".."),
    superpowersSkillsDir: join(superpowersRoot, "skills"),
  };
}

export async function pathExists(
  path: string,
  dependencies: SkillInstallerDependencies = defaultDependencies,
): Promise<boolean> {
  try {
    await dependencies.access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function sourceRootFor(
  skill: SkillPackSkill,
  roots: SourceRoots,
): string {
  return skill.source === "patchmill"
    ? roots.patchmillSkillsDir
    : roots.superpowersSkillsDir;
}

export async function assertSkillFile(
  path: string,
  displayPath: string,
  dependencies: SkillInstallerDependencies = defaultDependencies,
  options: { executable?: boolean } = {},
): Promise<void> {
  try {
    const skillFile = await dependencies.stat(path);
    if (!skillFile.isFile()) {
      throw new Error("Skill path is not a file");
    }
    await dependencies.access(path, constants.R_OK);
  } catch {
    throw new Error(`Missing required skill file: ${displayPath}`);
  }

  if (options.executable) {
    try {
      await dependencies.access(path, constants.X_OK);
    } catch {
      throw new Error(`Missing required executable skill file: ${displayPath}`);
    }
  }
}

export function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

async function assertRequiredSkillFiles(
  skillName: string,
  skillDir: string,
  displayRoot: string,
  dependencies: SkillInstallerDependencies = defaultDependencies,
): Promise<void> {
  for (const relativeFile of requiredSkillFiles(skillName)) {
    const displayPath = `${displayRoot}/${relativeFile}`;
    await assertSkillFile(
      join(skillDir, relativeFile),
      displayPath,
      dependencies,
    );
  }
}

export async function hashFile(
  path: string,
  dependencies: SkillInstallerDependencies = defaultDependencies,
): Promise<string> {
  return createHash("sha256")
    .update(await dependencies.readFile(path))
    .digest("hex");
}

export async function collectSourceFiles(
  skillRoot: string,
  currentDir: string,
  targetRelativeDir: string,
  displayRoot: string,
  dependencies: SkillInstallerDependencies = defaultDependencies,
): Promise<Array<{ path: string; sha256: string }>> {
  const files: Array<{ path: string; sha256: string }> = [];
  const entries = await dependencies.readdir(currentDir, {
    withFileTypes: true,
  });
  entries.sort((a, b) => comparePaths(a.name, b.name));

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    const relativePath = relative(skillRoot, entryPath).split(sep).join("/");
    const metadataPath = `${targetRelativeDir}/${relativePath}`;
    const displayPath = `${displayRoot}/${relativePath}`;

    if (entry.isDirectory()) {
      files.push(
        ...(await collectSourceFiles(
          skillRoot,
          entryPath,
          targetRelativeDir,
          displayRoot,
          dependencies,
        )),
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported skill source entry: ${displayPath}`);
    }

    files.push({
      path: metadataPath,
      sha256: await hashFile(entryPath, dependencies),
    });
  }

  return files;
}

export async function makeOwnerWritableRecursive(
  path: string,
  dependencies: SkillInstallerDependencies = defaultDependencies,
): Promise<void> {
  const entry = await dependencies.stat(path);
  await dependencies.chmod(path, entry.mode | 0o200);

  if (!entry.isDirectory()) return;

  const children = await dependencies.readdir(path, { withFileTypes: true });
  for (const child of children) {
    await makeOwnerWritableRecursive(join(path, child.name), dependencies);
  }
}

export async function installProjectSkills(options: {
  repoRoot: string;
  skillDir?: string;
  sourceRoots?: SourceRoots;
  packSkills?: SkillPackSkill[];
  installedAt?: string;
  dependencies?: SkillInstallerDependencies;
}): Promise<ProjectSkillInstallResult> {
  const skillDir = options.skillDir ?? DEFAULT_PROJECT_SKILL_DIR;
  const sourceRoots = options.sourceRoots ?? defaultSkillSourceRoots();
  const packSkills =
    options.packSkills ?? PATCHMILL_RECOMMENDED_SKILL_PACK.skills;
  const dependencies = options.dependencies ?? defaultDependencies;
  const absoluteSkillDir = resolve(options.repoRoot, skillDir);
  const metadataPath = join(absoluteSkillDir, SKILL_PACK_METADATA_FILE);
  const installedSkills: string[] = [];
  const files: Array<{ path: string; sha256: string }> = [];
  const installationPlan: Array<{
    sourceDir: string;
    targetDir: string;
    targetRelativeDir: string;
    files: Array<{ path: string; sha256: string }>;
  }> = [];

  for (const skill of packSkills) {
    const sourceDir = join(sourceRootFor(skill, sourceRoots), skill.name);
    await assertRequiredSkillFiles(
      skill.name,
      sourceDir,
      skill.name,
      dependencies,
    );

    const targetRelativeDir = projectSkillPath(skill.name, skillDir);
    const targetDir = resolve(options.repoRoot, targetRelativeDir);
    if (await pathExists(targetDir, dependencies)) {
      throw new Error(
        `Refusing to overwrite existing skill path: ${targetRelativeDir}`,
      );
    }

    const sourceFiles = await collectSourceFiles(
      sourceDir,
      sourceDir,
      targetRelativeDir,
      skill.name,
      dependencies,
    );

    installationPlan.push({
      sourceDir,
      targetDir,
      targetRelativeDir,
      files: sourceFiles,
    });
  }

  if (await pathExists(metadataPath, dependencies)) {
    throw new Error(
      `Refusing to overwrite existing skill path: ${projectSkillPath(SKILL_PACK_METADATA_FILE, skillDir)}`,
    );
  }

  if (await pathExists(absoluteSkillDir, dependencies)) {
    throw new Error(`Refusing to overwrite existing skill path: ${skillDir}`);
  }

  for (const plan of installationPlan) {
    files.push(...plan.files);
  }

  files.sort((a, b) => comparePaths(a.path, b.path));

  const metadata = buildSkillPackMetadata(files, {
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillDir,
  });

  let stagingSkillDir: string | undefined;

  try {
    await dependencies.mkdir(dirname(absoluteSkillDir), { recursive: true });
    stagingSkillDir = await dependencies.mkdtemp(
      join(dirname(absoluteSkillDir), `${basename(absoluteSkillDir)}-staging-`),
    );

    for (const {
      sourceDir,
      targetDir,
      targetRelativeDir,
    } of installationPlan) {
      const stagedTargetDir = join(
        stagingSkillDir,
        relative(absoluteSkillDir, targetDir),
      );
      await dependencies.cp(sourceDir, stagedTargetDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await makeOwnerWritableRecursive(stagedTargetDir, dependencies);

      installedSkills.push(targetRelativeDir);
    }

    await dependencies.writeFile(
      join(stagingSkillDir, SKILL_PACK_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      {
        flag: "wx",
      },
    );

    await dependencies.rename(stagingSkillDir, absoluteSkillDir);
  } finally {
    if (stagingSkillDir !== undefined) {
      try {
        await makeOwnerWritableRecursive(stagingSkillDir, dependencies);
      } catch {
        // Best-effort cleanup preparation: the staging directory may already
        // have been renamed into place, or a partial copy may be unreadable.
      }
      await dependencies.rm(stagingSkillDir, { recursive: true, force: true });
    }
  }

  return {
    skillDir: metadata.skillDir,
    skillConfig: buildRecommendedProjectSkillConfig(metadata.skillDir),
    installedSkills,
    metadataPath,
  };
}

export async function validateExistingSkillDirectory(
  repoRoot: string,
  skillDir: string,
): Promise<
  Pick<
    PatchmillSkillsConfig,
    "triage" | "planning" | "implementation" | "visualEvidence"
  >
> {
  const skillConfig = buildRecommendedProjectSkillConfig(skillDir);
  const bundledRecommendedSkills = BUNDLED_PATCHMILL_SKILLS.flatMap((skill) =>
    skill.recommendedProjectLocal && skill.projectSkillConfigKey
      ? [
          {
            name: skill.globalName,
            skillPath: skillConfig[skill.projectSkillConfigKey],
          },
        ]
      : [],
  );

  for (const { name, skillPath } of [
    ...bundledRecommendedSkills,
    { name: PATCHMILL_PLANNING_SKILL, skillPath: skillConfig.planning },
    {
      name: "brainstorming",
      skillPath: projectSkillPath("brainstorming", skillDir),
    },
    {
      name: "writing-plans",
      skillPath: projectSkillPath("writing-plans", skillDir),
    },
    {
      name: SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
      skillPath: skillConfig.implementation,
    },
  ]) {
    await assertRequiredSkillFiles(
      name,
      resolve(repoRoot, skillPath),
      skillPath,
    );
  }

  const taskImplementationSkillPath = projectSkillPath(
    "subagent-driven-development",
    skillDir,
  );
  for (const relativeFile of [
    "SKILL.md",
    "implementer-prompt.md",
    "task-reviewer-prompt.md",
  ]) {
    await assertSkillFile(
      resolve(repoRoot, taskImplementationSkillPath, relativeFile),
      `${taskImplementationSkillPath}/${relativeFile}`,
    );
  }
  for (const relativeFile of [
    "scripts/review-package",
    "scripts/sdd-workspace",
    "scripts/task-brief",
  ]) {
    await assertSkillFile(
      resolve(repoRoot, taskImplementationSkillPath, relativeFile),
      `${taskImplementationSkillPath}/${relativeFile}`,
      defaultDependencies,
      { executable: true },
    );
  }

  const sharedPromptSkillPath = projectSkillPath(
    SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL,
    skillDir,
  );
  for (const relativeFile of [
    "prompts/final-validation-review.md",
    "prompts/fix-pr-checks.md",
    "prompts/fix-review-findings.md",
  ]) {
    await assertSkillFile(
      resolve(repoRoot, sharedPromptSkillPath, relativeFile),
      `${sharedPromptSkillPath}/${relativeFile}`,
    );
  }

  return skillConfig;
}
