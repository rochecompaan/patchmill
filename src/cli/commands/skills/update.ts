import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  buildSkillPackMetadata,
  projectSkillPath,
  type SkillPackMetadataFile,
  type SkillPackSkill,
} from "../../../workflow/skill-pack.ts";
import {
  assertSkillFile,
  collectSourceFiles,
  comparePaths,
  defaultSkillSourceRoots,
  hashFile,
  makeOwnerWritableRecursive,
  pathExists,
  sourceRootFor,
  type SkillInstallerDependencies,
  type SourceRoots,
} from "../init/skill-installer.ts";

export type SkillPackUpdateResult =
  | { status: "up-to-date"; version: string }
  | {
      status: "updated";
      fromVersion: string;
      toVersion: string;
      updatedFiles: number;
      removedFiles: number;
    };

export type SkillPackUpdateOptions = {
  repoRoot: string;
  sourceRoots?: SourceRoots;
  packSkills?: SkillPackSkill[];
  installedAt?: string;
  dependencies?: SkillInstallerDependencies;
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

const MISSING_METADATA_MESSAGE =
  "No Patchmill-managed project-local skill pack found. Run `patchmill init` first,\n" +
  "or reinstall project-local skills.";

async function readInstalledMetadata(
  repoRoot: string,
  dependencies: SkillInstallerDependencies,
): Promise<unknown> {
  const metadataPath = resolve(
    repoRoot,
    DEFAULT_PROJECT_SKILL_DIR,
    SKILL_PACK_METADATA_FILE,
  );
  try {
    return JSON.parse(await dependencies.readFile(metadataPath, "utf8"));
  } catch {
    throw new Error(MISSING_METADATA_MESSAGE);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProjectSkillFilePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`) &&
    !path.split("/").includes("..")
  );
}

function assertPatchmillManagedProjectLocal(
  metadata: unknown,
): asserts metadata is SkillPackMetadataFile {
  if (!isRecord(metadata) || !isRecord(metadata.pack)) {
    throw new Error(MISSING_METADATA_MESSAGE);
  }
  if (
    metadata.pack.name !== PATCHMILL_RECOMMENDED_SKILL_PACK.name ||
    metadata.skillDir !== DEFAULT_PROJECT_SKILL_DIR ||
    metadata.metadataFile !== SKILL_PACK_METADATA_FILE ||
    !Array.isArray(metadata.files) ||
    metadata.files.some(
      (file) =>
        !isRecord(file) ||
        !isProjectSkillFilePath(file.path) ||
        typeof file.sha256 !== "string",
    )
  ) {
    throw new Error(MISSING_METADATA_MESSAGE);
  }
}

async function collectBundledPackFiles(options: {
  sourceRoots: SourceRoots;
  packSkills: SkillPackSkill[];
  dependencies: SkillInstallerDependencies;
}): Promise<Array<{ path: string; sha256: string }>> {
  const files: Array<{ path: string; sha256: string }> = [];
  for (const skill of options.packSkills) {
    const sourceDir = join(
      sourceRootFor(skill, options.sourceRoots),
      skill.name,
    );
    await assertSkillFile(
      join(sourceDir, "SKILL.md"),
      `${skill.name}/SKILL.md`,
      options.dependencies,
    );
    files.push(
      ...(await collectSourceFiles(
        sourceDir,
        sourceDir,
        projectSkillPath(skill.name),
        skill.name,
        options.dependencies,
      )),
    );
  }
  files.sort((a, b) => comparePaths(a.path, b.path));
  return files;
}

async function customizedManagedFiles(
  repoRoot: string,
  metadata: SkillPackMetadataFile,
  dependencies: SkillInstallerDependencies,
): Promise<string[]> {
  const changed: string[] = [];
  for (const file of metadata.files) {
    const absolutePath = resolve(repoRoot, file.path);
    if (!(await pathExists(absolutePath, dependencies))) {
      changed.push(`${file.path} (missing)`);
      continue;
    }
    try {
      if ((await hashFile(absolutePath, dependencies)) !== file.sha256) {
        changed.push(file.path);
      }
    } catch {
      changed.push(file.path);
    }
  }
  return changed;
}

async function unmanagedNewFileCollisions(
  repoRoot: string,
  oldFiles: Array<{ path: string; sha256: string }>,
  newFiles: Array<{ path: string; sha256: string }>,
  dependencies: SkillInstallerDependencies,
): Promise<string[]> {
  const oldPaths = new Set(oldFiles.map((file) => file.path));
  const collisions: string[] = [];
  for (const file of newFiles) {
    if (oldPaths.has(file.path)) continue;
    if (await pathExists(resolve(repoRoot, file.path), dependencies)) {
      collisions.push(file.path);
    }
  }
  return collisions;
}

function sameFiles(
  left: Array<{ path: string; sha256: string }>,
  right: Array<{ path: string; sha256: string }>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countUpdatedFiles(
  oldFiles: Array<{ path: string; sha256: string }>,
  newFiles: Array<{ path: string; sha256: string }>,
): number {
  const oldByPath = new Map(oldFiles.map((file) => [file.path, file.sha256]));
  return newFiles.filter((file) => oldByPath.get(file.path) !== file.sha256)
    .length;
}

async function copyBundledSkills(options: {
  repoRoot: string;
  sourceRoots: SourceRoots;
  packSkills: SkillPackSkill[];
  dependencies: SkillInstallerDependencies;
}): Promise<void> {
  for (const skill of options.packSkills) {
    const sourceDir = join(
      sourceRootFor(skill, options.sourceRoots),
      skill.name,
    );
    const targetDir = resolve(options.repoRoot, projectSkillPath(skill.name));
    await options.dependencies.mkdir(dirname(targetDir), { recursive: true });
    await options.dependencies.cp(sourceDir, targetDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    await makeOwnerWritableRecursive(targetDir, options.dependencies);
  }
}

async function removeObsoleteManagedFiles(options: {
  repoRoot: string;
  oldFiles: Array<{ path: string; sha256: string }>;
  newFiles: Array<{ path: string; sha256: string }>;
  dependencies: SkillInstallerDependencies;
}): Promise<number> {
  const newPaths = new Set(options.newFiles.map((file) => file.path));
  const obsolete = options.oldFiles.filter((file) => !newPaths.has(file.path));
  for (const file of obsolete) {
    await options.dependencies.rm(resolve(options.repoRoot, file.path), {
      force: true,
    });
  }
  return obsolete.length;
}

export async function updateProjectSkills(
  options: SkillPackUpdateOptions,
): Promise<SkillPackUpdateResult> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const sourceRoots = options.sourceRoots ?? defaultSkillSourceRoots();
  const packSkills =
    options.packSkills ?? PATCHMILL_RECOMMENDED_SKILL_PACK.skills;
  const metadata = await readInstalledMetadata(options.repoRoot, dependencies);
  assertPatchmillManagedProjectLocal(metadata);

  const changed = await customizedManagedFiles(
    options.repoRoot,
    metadata,
    dependencies,
  );
  if (changed.length > 0) {
    throw new Error(
      [
        "Refusing to update customized project-local skills:",
        ...changed.map((path) => `- ${path}`),
      ].join("\n"),
    );
  }

  const newFiles = await collectBundledPackFiles({
    sourceRoots,
    packSkills,
    dependencies,
  });
  const collisions = await unmanagedNewFileCollisions(
    options.repoRoot,
    metadata.files,
    newFiles,
    dependencies,
  );
  if (collisions.length > 0) {
    throw new Error(
      [
        "Refusing to overwrite unmanaged project-local skill files:",
        ...collisions.map((path) => `- ${path}`),
      ].join("\n"),
    );
  }

  const newMetadata = buildSkillPackMetadata(newFiles, {
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillDir: DEFAULT_PROJECT_SKILL_DIR,
  });
  if (
    metadata.pack.version === newMetadata.pack.version &&
    JSON.stringify(metadata.pack.source) ===
      JSON.stringify(newMetadata.pack.source) &&
    sameFiles(metadata.files, newMetadata.files)
  ) {
    return { status: "up-to-date", version: newMetadata.pack.version };
  }

  const updatedFiles = countUpdatedFiles(metadata.files, newMetadata.files);
  const removedFiles = await removeObsoleteManagedFiles({
    repoRoot: options.repoRoot,
    oldFiles: metadata.files,
    newFiles: newMetadata.files,
    dependencies,
  });
  await copyBundledSkills({
    repoRoot: options.repoRoot,
    sourceRoots,
    packSkills,
    dependencies,
  });
  await dependencies.writeFile(
    resolve(
      options.repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      SKILL_PACK_METADATA_FILE,
    ),
    `${JSON.stringify(newMetadata, null, 2)}\n`,
  );

  return {
    status: "updated",
    fromVersion: metadata.pack.version,
    toVersion: newMetadata.pack.version,
    updatedFiles,
    removedFiles,
  };
}
