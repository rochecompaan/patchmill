import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import {
  DefaultPackageManager,
  hasTrustRequiringProjectResources,
  loadProjectContextFiles,
  loadSkills,
  SettingsManager,
  type MissingSourceAction,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import {
  doctorPiResourceProfiles,
  type PatchmillPiResourceProfile,
} from "../../../pi/resource-profiles.ts";
import { localPiAgentDir } from "../init/pi-agent-settings.ts";
import type { DoctorCheckResult } from "./checks.ts";

export type DoctorPiResourceSection = {
  heading: "Context" | "Skills" | "Prompts" | "Extensions";
  items: string[];
};

export type DoctorPiResourceBlock = {
  label: string;
  sections: DoctorPiResourceSection[];
};

export type DoctorPiExtensionResource = {
  path: string;
  metadata?: Pick<ResolvedResource["metadata"], "source" | "origin">;
};

export type DoctorPiResourceReport = {
  blocks: DoctorPiResourceBlock[];
  check?: DoctorCheckResult;
};

export type DoctorPiResourceProvider = (
  repoRoot: string,
) => Promise<DoctorPiResourceReport>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function slashPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function displayPath(path: string, repoRoot: string): string {
  const resolvedPath = resolve(path);
  const resolvedRepoRoot = resolve(repoRoot);
  if (isInside(resolvedRepoRoot, resolvedPath)) {
    const rel = relative(resolvedRepoRoot, resolvedPath);
    return slashPath(rel || basename(resolvedPath));
  }

  const home = homedir();
  if (isInside(home, resolvedPath)) {
    return slashPath(join("~", relative(home, resolvedPath)));
  }

  return slashPath(path);
}

function compactExtensionPathLabel(path: string): string {
  const normalizedPath = slashPath(path);
  const parsed = parse(normalizedPath);
  return parsed.base === "index.ts" || parsed.base === "index.js"
    ? basename(dirname(normalizedPath))
    : parsed.base;
}

function compactExtensionLabel(resource: DoctorPiExtensionResource): string {
  const pathLabel = compactExtensionPathLabel(resource.path);
  return resource.metadata?.origin === "package"
    ? `${resource.metadata.source}: ${pathLabel}`
    : pathLabel;
}

export function compactProfileBlock(input: {
  label: string;
  contextFiles: string[];
  skillNames: string[];
  promptNames: string[];
  extensionResources: DoctorPiExtensionResource[];
  repoRoot: string;
}): DoctorPiResourceBlock {
  const sections: DoctorPiResourceSection[] = [];

  const context = input.contextFiles.map((path) =>
    displayPath(path, input.repoRoot),
  );
  if (context.length > 0) sections.push({ heading: "Context", items: context });

  const skills = uniqueSorted(input.skillNames);
  if (skills.length > 0) sections.push({ heading: "Skills", items: skills });

  const prompts = uniqueSorted(input.promptNames.map((name) => `/${name}`));
  if (prompts.length > 0) sections.push({ heading: "Prompts", items: prompts });

  const extensions = uniqueSorted(
    input.extensionResources.map(compactExtensionLabel),
  );
  if (extensions.length > 0) {
    sections.push({ heading: "Extensions", items: extensions });
  }

  return { label: input.label, sections };
}

export function formatPiResourceBlocks(
  blocks: DoctorPiResourceBlock[],
): string[] {
  return blocks.flatMap((block, blockIndex) => [
    ...(blockIndex === 0 ? [] : [""]),
    `[Pi resources: ${block.label}]`,
    "",
    ...block.sections.flatMap((section, sectionIndex) => [
      ...(sectionIndex === 0 ? [] : [""]),
      `[${section.heading}]`,
      `  ${section.items.join(", ")}`,
    ]),
  ]);
}

export function piResourceWarningCheck(
  warnings: string[],
): DoctorCheckResult | undefined {
  const uniqueWarnings = uniqueSorted(warnings);
  if (uniqueWarnings.length === 0) return undefined;
  return {
    name: "pi resources",
    status: "warn",
    message: uniqueWarnings.join("; "),
    remediation: [
      "Patchmill doctor listed Pi resources without installing missing packages or executing extensions.",
      "Install or update skipped Pi package sources outside doctor, and inspect or fix the listed static Pi resource diagnostics, then rerun:",
      "  patchmill doctor",
    ],
  };
}

export function piResourceDiscoveryFailureCheck(
  error: unknown,
): DoctorCheckResult {
  return {
    name: "pi resources",
    status: "warn",
    message: `could not list Pi resources: ${errorMessage(error)}`,
    remediation: [
      "Patchmill doctor could not list Pi's startup resources.",
      "The readiness checks still ran; fix the Pi resource discovery error, then rerun:",
      "  patchmill doctor",
    ],
  };
}

function canonicalPath(path: string): string {
  const resolvedPath = resolve(path);
  try {
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function readSavedProjectTrustDecision(
  repoRoot: string,
  agentDir: string,
): boolean | null {
  const trustPath = join(resolve(agentDir), "trust.json");
  if (!existsSync(trustPath)) return null;

  const parsed = JSON.parse(readFileSync(trustPath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid trust store ${trustPath}: expected an object`);
  }

  const data = parsed as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(
        `Invalid trust store ${trustPath}: value for ${JSON.stringify(key)} must be true, false, or null`,
      );
    }
  }

  let currentDir = canonicalPath(repoRoot);
  while (true) {
    const value = data[currentDir];
    if (value === true || value === false) return value;

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function projectTrustedForResourceListing(
  repoRoot: string,
  agentDir: string,
): boolean {
  if (!hasTrustRequiringProjectResources(repoRoot)) return true;

  const savedDecision = readSavedProjectTrustDecision(repoRoot, agentDir);
  if (savedDecision !== null) return savedDecision;

  const globalOnlySettings = SettingsManager.create(repoRoot, agentDir, {
    projectTrusted: false,
  });
  return globalOnlySettings.getDefaultProjectTrust() === "always";
}

function enabledPaths(resources: ResolvedResource[]): string[] {
  return resources
    .filter((resource) => resource.enabled)
    .map((resource) => resource.path);
}

function enabledExtensionResources(
  resources: ResolvedResource[],
): DoctorPiExtensionResource[] {
  return resources
    .filter((resource) => resource.enabled)
    .map((resource) => ({
      path: resource.path,
      metadata: {
        source: resource.metadata.source,
        origin: resource.metadata.origin,
      },
    }));
}

function localExtensionResources(paths: string[]): DoctorPiExtensionResource[] {
  return paths.map((path) => ({ path }));
}

function promptName(path: string): string {
  return basename(path).replace(/\.md$/u, "");
}

function contextFilePaths(input: {
  repoRoot: string;
  agentDir: string;
}): string[] {
  return loadProjectContextFiles({
    cwd: input.repoRoot,
    agentDir: input.agentDir,
  }).map((file) => file.path);
}

type StaticBasePiResources = {
  contextFiles: string[];
  skillPaths: string[];
  promptNames: string[];
  extensionResources: DoctorPiExtensionResource[];
};

async function resolveStaticBaseResources(input: {
  repoRoot: string;
  agentDir: string;
  warnings: string[];
}): Promise<StaticBasePiResources> {
  const projectTrusted = projectTrustedForResourceListing(
    input.repoRoot,
    input.agentDir,
  );
  const settingsManager = SettingsManager.create(
    input.repoRoot,
    input.agentDir,
    {
      projectTrusted,
    },
  );
  const packageManager = new DefaultPackageManager({
    cwd: input.repoRoot,
    agentDir: input.agentDir,
    settingsManager,
  });

  const onMissing = async (source: string): Promise<MissingSourceAction> => {
    input.warnings.push(`skipped missing package ${source}`);
    return "skip";
  };

  const resolved = await packageManager.resolve(onMissing);

  return {
    contextFiles: contextFilePaths({
      repoRoot: input.repoRoot,
      agentDir: input.agentDir,
    }),
    skillPaths: enabledPaths(resolved.skills),
    promptNames: enabledPaths(resolved.prompts).map(promptName),
    extensionResources: enabledExtensionResources(resolved.extensions),
  };
}

function profileStaticResources(input: {
  repoRoot: string;
  agentDir: string;
  profile: PatchmillPiResourceProfile;
  baseResources: StaticBasePiResources;
  warnings: string[];
}): {
  contextFiles: string[];
  skillNames: string[];
  promptNames: string[];
  extensionResources: DoctorPiExtensionResource[];
} {
  const skills = loadSkills({
    cwd: input.repoRoot,
    agentDir: input.agentDir,
    includeDefaults: false,
    skillPaths: [
      ...input.baseResources.skillPaths,
      ...input.profile.additionalSkillPaths,
    ],
  });
  input.warnings.push(
    ...skills.diagnostics.map((diagnostic) =>
      diagnostic.path
        ? `skills: ${diagnostic.message} (${diagnostic.path})`
        : `skills: ${diagnostic.message}`,
    ),
  );

  return {
    contextFiles: input.profile.noContextFiles
      ? []
      : input.baseResources.contextFiles,
    skillNames: skills.skills.map((skill) => skill.name),
    promptNames: input.profile.noPromptTemplates
      ? []
      : input.baseResources.promptNames,
    extensionResources: [
      ...input.baseResources.extensionResources,
      ...localExtensionResources(input.profile.additionalExtensionPaths),
    ],
  };
}

export async function loadDoctorPiResources(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): Promise<DoctorPiResourceReport> {
  const agentDir = localPiAgentDir(repoRoot);
  const warnings: string[] = [];

  try {
    const loaded = await loadPatchmillConfigState(repoRoot, env, []);
    const baseResources = await resolveStaticBaseResources({
      repoRoot,
      agentDir,
      warnings,
    });
    const blocks: DoctorPiResourceBlock[] = [];
    for (const profile of doctorPiResourceProfiles(
      loaded.config.skills,
      repoRoot,
    )) {
      const resources = profileStaticResources({
        repoRoot,
        agentDir,
        profile,
        baseResources,
        warnings,
      });
      const block = compactProfileBlock({
        label: profile.label,
        repoRoot,
        ...resources,
      });
      if (block.sections.length > 0) blocks.push(block);
    }

    return { blocks, check: piResourceWarningCheck(warnings) };
  } catch (error) {
    return { blocks: [], check: piResourceDiscoveryFailureCheck(error) };
  }
}
