import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  SKILL_PACK_METADATA_FILE,
} from "./skill-pack.ts";

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
  const configuredPaths = skills.flatMap((skill) => {
    const [flag, path] = skillInvocationArgs(skill, repoRoot);
    return flag === "--skill" && path ? [path] : [];
  });

  if (
    !configuredPaths.some((path) =>
      pathStartsWith(
        resolve(path),
        resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR),
      ),
    )
  ) {
    return configuredPaths;
  }

  return uniqueSkillPaths([
    ...configuredPaths,
    ...projectLocalPackSkillPaths(repoRoot),
  ]);
}

function uniqueSkillPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function pathStartsWith(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}\\`)
  );
}

function isPathInside(parent: string, child: string): boolean {
  const pathRelative = relative(parent, child);
  return (
    pathRelative === "" ||
    (!pathRelative.startsWith("..") && !isAbsolute(pathRelative))
  );
}

function resolveProjectLocalMetadataFilePath(
  filePath: string,
  repoRoot: string,
  projectLocalRoot: string,
): string | null {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (isAbsolute(normalizedPath) || win32.isAbsolute(filePath)) {
    return null;
  }

  if (!normalizedPath.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`)) {
    return null;
  }

  const resolvedPath = resolve(repoRoot, normalizedPath);
  return isPathInside(projectLocalRoot, resolvedPath) ? resolvedPath : null;
}

function projectLocalPackSkillPaths(repoRoot: string): string[] {
  const projectLocalRoot = resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
  const metadataSkillPaths = projectLocalMetadataSkillPaths(
    repoRoot,
    projectLocalRoot,
  );
  return (
    metadataSkillPaths ?? discoveredProjectLocalSkillPaths(projectLocalRoot)
  );
}

function projectLocalMetadataSkillPaths(
  repoRoot: string,
  projectLocalRoot: string,
): string[] | null {
  const metadataPath = join(projectLocalRoot, SKILL_PACK_METADATA_FILE);

  let metadataContent: string;
  try {
    metadataContent = readFileSync(metadataPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(
      `project-local skill pack metadata unreadable: ${metadataPath}`,
      { cause: error },
    );
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataContent);
  } catch (error) {
    throw new Error(
      `project-local skill pack metadata malformed: ${metadataPath}`,
      { cause: error },
    );
  }

  if (!metadata || typeof metadata !== "object") {
    throw new Error(
      `project-local skill pack metadata malformed: ${metadataPath}`,
    );
  }

  const files = (metadata as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    throw new Error(
      `project-local skill pack metadata malformed: ${metadataPath}`,
    );
  }

  return files.flatMap((file) => {
    if (!file || typeof file !== "object") return [];

    const filePath = (file as { path?: unknown }).path;
    if (typeof filePath !== "string") return [];

    if (!isSkillFilePath(filePath)) return [];

    const resolvedPath = resolveProjectLocalMetadataFilePath(
      filePath,
      repoRoot,
      projectLocalRoot,
    );
    return resolvedPath ? [resolvedPath] : [];
  });
}

function discoveredProjectLocalSkillPaths(projectLocalRoot: string): string[] {
  try {
    const entries = readdirSync(projectLocalRoot, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    return entries.flatMap((entry) => {
      const entryPath = join(projectLocalRoot, entry.name);
      if (entry.isDirectory()) {
        return discoveredProjectLocalSkillPaths(entryPath);
      }
      return entry.isFile() && entry.name === SKILL_FILE_NAME
        ? [entryPath]
        : [];
    });
  } catch {
    return [];
  }
}

export function bundledTriageSkillPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "skills", "patchmill-issue-triage", "SKILL.md");
}
