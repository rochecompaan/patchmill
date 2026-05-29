import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
  projectSkillPath,
  type SkillPackSkill,
} from "../../../workflow/skill-pack.ts";
import { bundledTriageSkillPath } from "../../../workflow/skills.ts";
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
    "triage" | "planning" | "implementation"
  >;
  installedSkills: string[];
  metadataPath: string;
};

export function defaultSkillSourceRoots(): SourceRoots {
  const superpowersRoot = dirname(require.resolve("superpowers/package.json"));
  return {
    patchmillSkillsDir: resolve(dirname(bundledTriageSkillPath()), ".."),
    superpowersSkillsDir: join(superpowersRoot, "skills"),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sourceRootFor(skill: SkillPackSkill, roots: SourceRoots): string {
  return skill.source === "patchmill"
    ? roots.patchmillSkillsDir
    : roots.superpowersSkillsDir;
}

async function assertSkillFile(
  path: string,
  displayPath: string,
): Promise<void> {
  try {
    const skillFile = await stat(path);
    if (!skillFile.isFile()) {
      throw new Error("Skill path is not a file");
    }
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`Missing required skill file: ${displayPath}`);
  }
}

function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function collectSourceFiles(
  skillRoot: string,
  currentDir: string,
  targetRelativeDir: string,
  displayRoot: string,
): Promise<Array<{ path: string; sha256: string }>> {
  const files: Array<{ path: string; sha256: string }> = [];
  const entries = await readdir(currentDir, { withFileTypes: true });
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
        )),
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported skill source entry: ${displayPath}`);
    }

    files.push({
      path: metadataPath,
      sha256: await hashFile(entryPath),
    });
  }

  return files;
}

export async function installProjectSkills(options: {
  repoRoot: string;
  skillDir?: string;
  sourceRoots?: SourceRoots;
  packSkills?: SkillPackSkill[];
  installedAt?: string;
}): Promise<ProjectSkillInstallResult> {
  const skillDir = options.skillDir ?? DEFAULT_PROJECT_SKILL_DIR;
  const sourceRoots = options.sourceRoots ?? defaultSkillSourceRoots();
  const packSkills =
    options.packSkills ?? PATCHMILL_RECOMMENDED_SKILL_PACK.skills;
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
    await assertSkillFile(
      join(sourceDir, "SKILL.md"),
      `${skill.name}/SKILL.md`,
    );

    const targetRelativeDir = projectSkillPath(skill.name, skillDir);
    const targetDir = resolve(options.repoRoot, targetRelativeDir);
    if (await pathExists(targetDir)) {
      throw new Error(
        `Refusing to overwrite existing skill path: ${targetRelativeDir}`,
      );
    }

    const sourceFiles = await collectSourceFiles(
      sourceDir,
      sourceDir,
      targetRelativeDir,
      skill.name,
    );

    installationPlan.push({
      sourceDir,
      targetDir,
      targetRelativeDir,
      files: sourceFiles,
    });
  }

  if (await pathExists(metadataPath)) {
    throw new Error(
      `Refusing to overwrite existing skill path: ${projectSkillPath(SKILL_PACK_METADATA_FILE, skillDir)}`,
    );
  }

  for (const plan of installationPlan) {
    files.push(...plan.files);
  }

  for (const { sourceDir, targetDir, targetRelativeDir } of installationPlan) {
    await mkdir(dirname(targetDir), { recursive: true });
    await cp(sourceDir, targetDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });

    installedSkills.push(targetRelativeDir);
  }

  files.sort((a, b) => comparePaths(a.path, b.path));

  const metadata = buildSkillPackMetadata(files, {
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillDir,
  });
  await mkdir(absoluteSkillDir, { recursive: true });
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    flag: "wx",
  });

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
  Pick<PatchmillSkillsConfig, "triage" | "planning" | "implementation">
> {
  const skillConfig = buildRecommendedProjectSkillConfig(skillDir);
  for (const skillPath of [
    skillConfig.triage,
    skillConfig.planning,
    skillConfig.implementation,
  ]) {
    const displayPath = `${skillPath}/SKILL.md`;
    await assertSkillFile(resolve(repoRoot, displayPath), displayPath);
  }

  return skillConfig;
}
