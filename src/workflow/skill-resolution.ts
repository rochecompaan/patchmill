import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  hashContent,
  type SkillPackMetadataFile,
} from "./skill-pack.ts";

export type SkillResolutionStatus = "pass" | "warn" | "fail";

export type SkillResolutionDiagnostic = {
  status: SkillResolutionStatus;
  summary: string;
};

export type SkillInvocationResolution = {
  paths: string[];
  diagnostics: SkillResolutionDiagnostic[];
  configuredProjectLocalPaths: string[];
  usedProjectLocalPack: boolean;
};

export const BUNDLED_TRIAGE_SKILL_REFERENCE = "patchmill:bundled-issue-triage";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const SKILL_NAMESPACE_PATTERN = /^[a-z0-9-]+:.+$/iu;
const SKILL_FILE_NAME = "SKILL.md";
const PROJECT_LOCAL_CUSTOMIZED_SUMMARY =
  "project-local skill pack customized from installed pack";

export function bundledTriageSkillPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "skills", "patchmill-issue-triage", "SKILL.md");
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
  if (isAbsolute(normalizedPath) || win32.isAbsolute(filePath)) return null;
  if (!normalizedPath.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`)) return null;

  const resolvedPath = resolve(repoRoot, normalizedPath);
  return isPathInside(projectLocalRoot, resolvedPath) ? resolvedPath : null;
}

function validMetadata(
  value: unknown,
  repoRoot: string,
  projectLocalRoot: string,
): value is SkillPackMetadataFile {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<SkillPackMetadataFile> & {
    pack?: { source?: Record<string, unknown> };
  };

  return (
    candidate.pack?.name === PATCHMILL_RECOMMENDED_SKILL_PACK.name &&
    candidate.pack.version === PATCHMILL_RECOMMENDED_SKILL_PACK.version &&
    candidate.pack.source?.type ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.type &&
    candidate.pack.source?.repository ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.repository &&
    candidate.pack.source?.tag ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.tag &&
    candidate.pack.source?.tarballUrl ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.tarballUrl &&
    typeof candidate.installedAt === "string" &&
    candidate.skillDir === DEFAULT_PROJECT_SKILL_DIR &&
    candidate.metadataFile === SKILL_PACK_METADATA_FILE &&
    Array.isArray(candidate.files) &&
    candidate.files.every(
      (file) =>
        file &&
        typeof file.path === "string" &&
        typeof file.sha256 === "string" &&
        resolveProjectLocalMetadataFilePath(
          file.path,
          repoRoot,
          projectLocalRoot,
        ) !== null,
    )
  );
}

function metadataSkillPaths(
  metadata: SkillPackMetadataFile,
  repoRoot: string,
  projectLocalRoot: string,
): string[] {
  return metadata.files
    .filter((file) => isSkillFilePath(file.path))
    .flatMap((file) => {
      const resolvedPath = resolveProjectLocalMetadataFilePath(
        file.path,
        repoRoot,
        projectLocalRoot,
      );
      return resolvedPath ? [resolvedPath] : [];
    });
}

function projectLocalCustomizationDiagnostics(
  metadata: SkillPackMetadataFile,
  repoRoot: string,
  projectLocalRoot: string,
): SkillResolutionDiagnostic[] {
  for (const file of metadata.files) {
    const resolvedPath = resolveProjectLocalMetadataFilePath(
      file.path,
      repoRoot,
      projectLocalRoot,
    );
    if (!resolvedPath) {
      return [
        {
          status: "warn",
          summary: PROJECT_LOCAL_CUSTOMIZED_SUMMARY,
        },
      ];
    }

    try {
      if (hashContent(readFileSync(resolvedPath)) !== file.sha256) {
        return [
          {
            status: "warn",
            summary: PROJECT_LOCAL_CUSTOMIZED_SUMMARY,
          },
        ];
      }
    } catch {
      return [
        {
          status: "warn",
          summary: PROJECT_LOCAL_CUSTOMIZED_SUMMARY,
        },
      ];
    }
  }

  return [];
}

function projectLocalPackResolution(
  repoRoot: string,
  configuredProjectLocalPaths: string[],
): {
  paths: string[];
  diagnostics: SkillResolutionDiagnostic[];
  usedMetadata: boolean;
} {
  const projectLocalRoot = resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
  const metadataPath = join(projectLocalRoot, SKILL_PACK_METADATA_FILE);

  let metadataContent: string;
  try {
    metadataContent = readFileSync(metadataPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      paths: configuredProjectLocalPaths,
      diagnostics: [
        {
          status: "warn",
          summary:
            code === "ENOENT"
              ? "project-local skill pack metadata missing; using configured project-local skill paths only"
              : `project-local skill pack metadata unreadable; using configured project-local skill paths only: ${String(error)}`,
        },
      ],
      usedMetadata: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataContent);
  } catch (error) {
    return {
      paths: configuredProjectLocalPaths,
      diagnostics: [
        {
          status: "warn",
          summary: `project-local skill pack metadata malformed; using configured project-local skill paths only: ${String(error)}`,
        },
      ],
      usedMetadata: false,
    };
  }

  if (!validMetadata(parsed, repoRoot, projectLocalRoot)) {
    return {
      paths: configuredProjectLocalPaths,
      diagnostics: [
        {
          status: "warn",
          summary:
            "project-local skill pack metadata malformed; using configured project-local skill paths only",
        },
      ],
      usedMetadata: false,
    };
  }

  return {
    paths: metadataSkillPaths(parsed, repoRoot, projectLocalRoot),
    diagnostics: [
      { status: "pass", summary: "project-local metadata verified" },
      ...projectLocalCustomizationDiagnostics(
        parsed,
        repoRoot,
        projectLocalRoot,
      ),
    ],
    usedMetadata: true,
  };
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

export function resolveConfiguredSkillInvocation(
  skills: Array<string | undefined>,
  repoRoot: string,
): SkillInvocationResolution {
  const diagnostics: SkillResolutionDiagnostic[] = [];
  const configuredPaths = skills.flatMap((skill) => {
    if (!skill) return [];
    if (skill === BUNDLED_TRIAGE_SKILL_REFERENCE) {
      return [bundledTriageSkillPath()];
    }
    if (!isPathLikeSkill(skill)) return [];
    return [resolvePathLikeSkillPath(skill, repoRoot)];
  });

  const projectLocalRoot = resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
  const configuredProjectLocalPaths = configuredPaths.filter((path) =>
    pathStartsWith(resolve(path), projectLocalRoot),
  );

  if (configuredProjectLocalPaths.length === 0) {
    return {
      paths: unique(configuredPaths),
      diagnostics,
      configuredProjectLocalPaths,
      usedProjectLocalPack: false,
    };
  }

  const pack = projectLocalPackResolution(
    repoRoot,
    configuredProjectLocalPaths,
  );
  diagnostics.push(...pack.diagnostics);

  return {
    paths: pack.usedMetadata
      ? unique([...pack.paths, ...configuredPaths])
      : unique(configuredPaths),
    diagnostics,
    configuredProjectLocalPaths: unique(configuredProjectLocalPaths),
    usedProjectLocalPack: true,
  };
}

export function skillInvocationPaths(
  skills: Array<string | undefined>,
  repoRoot: string,
): string[] {
  return resolveConfiguredSkillInvocation(skills, repoRoot).paths;
}

export function skillInvocationArgs(
  skill: string | undefined,
  repoRoot: string,
): string[] {
  return skillInvocationPaths([skill], repoRoot).flatMap((path) => [
    "--skill",
    path,
  ]);
}
