import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../package-root.ts";
import {
  skillInvocationPaths,
  type PatchmillSkillsConfig,
} from "../workflow/skills.ts";
import {
  piSubagentsExtensionFiles,
  resolvePiSubagentsPackageRoot,
} from "./pi-subagents-package.ts";

const PI_SUBAGENTS_PACKAGE_ROOT = resolvePiSubagentsPackageRoot();
piSubagentsExtensionFiles();
function requireRegularFile(path: string): string {
  const stats = fs.statSync(path);
  if (!stats.isFile()) {
    throw new Error(`Patchmill extension is not a regular file: ${path}`);
  }
  return path;
}

const PATCHMILL_PACKAGE_ROOT = findPackageRoot(
  dirname(fileURLToPath(import.meta.url)),
);
const PATCHMILL_TODOS_EXTENSION = requireRegularFile(
  join(PATCHMILL_PACKAGE_ROOT, "extensions", "todos.ts"),
);

export type PatchmillPiResourceProfileId =
  | "run-once-planning"
  | "run-once-development-environment"
  | "run-once-implementation"
  | "triage";

export type PatchmillPiResourceProfile = {
  id: PatchmillPiResourceProfileId;
  label: string;
  noContextFiles: boolean;
  noPromptTemplates: boolean;
  additionalExtensionPaths: string[];
  additionalSkillPaths: string[];
};

function runOnceExtensionPaths(): string[] {
  return [PI_SUBAGENTS_PACKAGE_ROOT, PATCHMILL_TODOS_EXTENSION];
}

function profile(
  input: Omit<PatchmillPiResourceProfile, "additionalSkillPaths"> & {
    skills: Array<string | undefined>;
    repoRoot: string;
  },
): PatchmillPiResourceProfile {
  return {
    id: input.id,
    label: input.label,
    noContextFiles: input.noContextFiles,
    noPromptTemplates: input.noPromptTemplates,
    additionalExtensionPaths: input.additionalExtensionPaths,
    additionalSkillPaths: skillInvocationPaths(input.skills, input.repoRoot),
  };
}

export function runOncePlanningPiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "run-once-planning",
    label: "run-once planning",
    noContextFiles: false,
    noPromptTemplates: false,
    additionalExtensionPaths: runOnceExtensionPaths(),
    skills: [skills.planning],
    repoRoot,
  });
}

export function runOnceDevelopmentEnvironmentPiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "run-once-development-environment",
    label: "run-once development-environment",
    noContextFiles: false,
    noPromptTemplates: false,
    additionalExtensionPaths: runOnceExtensionPaths(),
    skills: [skills.toolchain, skills.developmentEnvironment],
    repoRoot,
  });
}

export function runOnceImplementationPiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "run-once-implementation",
    label: "run-once implementation",
    noContextFiles: false,
    noPromptTemplates: false,
    additionalExtensionPaths: runOnceExtensionPaths(),
    skills: [
      skills.toolchain,
      skills.implementation,
      skills.review,
      skills.visualEvidence,
      skills.landing,
    ],
    repoRoot,
  });
}

export function triagePiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "triage",
    label: "triage",
    noContextFiles: true,
    noPromptTemplates: false,
    additionalExtensionPaths: [],
    skills: [skills.triage],
    repoRoot,
  });
}

export function doctorPiResourceProfiles(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile[] {
  return [
    runOncePlanningPiProfile(skills, repoRoot),
    runOnceDevelopmentEnvironmentPiProfile(skills, repoRoot),
    runOnceImplementationPiProfile(skills, repoRoot),
    triagePiProfile(skills, repoRoot),
  ];
}

export function profileContextArgs(
  profile: PatchmillPiResourceProfile,
): string[] {
  return profile.noContextFiles ? ["--no-context-files"] : [];
}

export function profilePromptTemplateArgs(
  profile: PatchmillPiResourceProfile,
): string[] {
  return profile.noPromptTemplates ? ["--no-prompt-templates"] : [];
}

export function profileExtensionArgs(
  profile: PatchmillPiResourceProfile,
): string[] {
  return profile.additionalExtensionPaths.flatMap((path) => ["-e", path]);
}

export function profileSkillArgs(
  profile: PatchmillPiResourceProfile,
): string[] {
  return profile.additionalSkillPaths.flatMap((path) => ["--skill", path]);
}
