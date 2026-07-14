import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BundledPatchmillSkillKey = "triage" | "visualEvidence";

export type BundledPatchmillSkill = {
  key: BundledPatchmillSkillKey;
  configReference: string;
  globalName: string;
  dirName: string;
  requiredFiles: string[];
  recommendedProjectLocal?: true;
  projectSkillConfigKey?: "triage" | "visualEvidence";
};

export const BUNDLED_PATCHMILL_SKILLS = [
  {
    key: "triage",
    configReference: "patchmill:bundled-issue-triage",
    globalName: "patchmill-issue-triage",
    dirName: "patchmill-issue-triage",
    requiredFiles: ["SKILL.md"],
    recommendedProjectLocal: true,
    projectSkillConfigKey: "triage",
  },
  {
    key: "visualEvidence",
    configReference: "patchmill:bundled-visual-evidence",
    globalName: "patchmill-visual-evidence",
    dirName: "patchmill-visual-evidence",
    requiredFiles: ["SKILL.md", "scripts/capture-visual-evidence.cjs"],
    recommendedProjectLocal: true,
    projectSkillConfigKey: "visualEvidence",
  },
] as const satisfies readonly BundledPatchmillSkill[];

export function bundledSkillByKey(
  key: BundledPatchmillSkillKey,
): BundledPatchmillSkill | undefined {
  return BUNDLED_PATCHMILL_SKILLS.find((skill) => skill.key === key);
}

export function bundledSkillByConfigReference(
  reference: string,
): BundledPatchmillSkill | undefined {
  return BUNDLED_PATCHMILL_SKILLS.find(
    (skill) => skill.configReference === reference,
  );
}

export function bundledSkillByName(
  name: string,
): BundledPatchmillSkill | undefined {
  return BUNDLED_PATCHMILL_SKILLS.find(
    (skill) => skill.globalName === name || skill.dirName === name,
  );
}

export function bundledSkillDir(entry: BundledPatchmillSkill): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourceTreePath = join(here, "..", "..", "skills", entry.dirName);
  const builtPackagePath = join(
    here,
    "..",
    "..",
    "..",
    "skills",
    entry.dirName,
  );

  return existsSync(sourceTreePath) ? sourceTreePath : builtPackagePath;
}

export function bundledSkillPath(entry: BundledPatchmillSkill): string {
  return join(bundledSkillDir(entry), "SKILL.md");
}

export function bundledSkillPathForReference(
  reference: string,
): string | undefined {
  const entry = bundledSkillByConfigReference(reference);
  return entry ? bundledSkillPath(entry) : undefined;
}

export function requiredFilesForBundledSkillName(name: string): string[] {
  return bundledSkillByName(name)?.requiredFiles ?? ["SKILL.md"];
}
