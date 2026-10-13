import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  type SkillPackMetadataFile,
} from "../../../workflow/skill-pack.ts";

export const MISSING_METADATA_MESSAGE =
  "No Patchmill-managed project-local skill pack found. Run `patchmill init` first,\n" +
  "or reinstall project-local skills.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
function managedPath(value: unknown): value is string {
  return (
    nonempty(value) &&
    value.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`) &&
    !value.includes("\\") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}
function packSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "github-release" &&
    nonempty(value.repository) &&
    nonempty(value.tag) &&
    nonempty(value.tarballUrl)
  );
}
function upstreamFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonempty(value.sourcePath) &&
    managedPath(value.installedPath)
  );
}
function upstreamLicense(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonempty(value.name) &&
    nonempty(value.sourcePath) &&
    (value.installedPath === undefined || managedPath(value.installedPath))
  );
}
function upstreamSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonempty(value.repository) &&
    nonempty(value.commit) &&
    Array.isArray(value.files) &&
    value.files.length > 0 &&
    value.files.every(upstreamFile) &&
    upstreamLicense(value.license)
  );
}
function metadataSkill(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonempty(value.name) &&
    (value.source === "patchmill" ||
      value.source === "superpowers" ||
      value.source === "simple-english") &&
    Array.isArray(value.requiredFiles) &&
    value.requiredFiles.length > 0 &&
    value.requiredFiles.every(managedPath) &&
    (value.upstreamSources === undefined ||
      (Array.isArray(value.upstreamSources) &&
        value.upstreamSources.every(upstreamSource)))
  );
}

/** Updates intentionally manage only the default project-local directory. */
export function assertPatchmillManagedProjectLocal(
  metadata: unknown,
): asserts metadata is SkillPackMetadataFile {
  if (
    !isRecord(metadata) ||
    !isRecord(metadata.pack) ||
    metadata.pack.name !== PATCHMILL_RECOMMENDED_SKILL_PACK.name ||
    !nonempty(metadata.pack.version) ||
    !packSource(metadata.pack.source) ||
    !(
      metadata.pack.additionalSources === undefined ||
      (Array.isArray(metadata.pack.additionalSources) &&
        metadata.pack.additionalSources.every(packSource))
    ) ||
    metadata.skillDir !== DEFAULT_PROJECT_SKILL_DIR ||
    metadata.metadataFile !== SKILL_PACK_METADATA_FILE ||
    !(
      metadata.skills === undefined ||
      (Array.isArray(metadata.skills) && metadata.skills.every(metadataSkill))
    ) ||
    !Array.isArray(metadata.files) ||
    !metadata.files.every(
      (file) =>
        isRecord(file) &&
        managedPath(file.path) &&
        typeof file.sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(file.sha256),
    )
  ) {
    throw new Error(MISSING_METADATA_MESSAGE);
  }
}
