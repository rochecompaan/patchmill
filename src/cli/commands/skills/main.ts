import { createHash } from "node:crypto";
import { readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot } from "../../../package-root.ts";
import type { CliOutput } from "../../main.ts";
import {
  installSkills,
  type SkillPackManifest,
} from "../init/skill-installer.ts";

const HELP = "Usage: patchmill skills update";
const SKILL_DIR = ".patchmill/skills";
const MANIFEST = "patchmill-skill-pack.json";

type Options = {
  repoRoot?: string;
  packageRoot?: string;
  output?: CliOutput;
};

async function readManifest(path: string): Promise<SkillPackManifest> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SkillPackManifest;
  } catch {
    throw new Error(
      `No Patchmill skill pack manifest at ${join(SKILL_DIR, MANIFEST)}. Run patchmill init first.`,
    );
  }
}

async function editedFiles(
  skills: string,
  manifest: SkillPackManifest,
): Promise<string[]> {
  const edited: string[] = [];
  for (const file of manifest.files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(skills, file.path));
    } catch {
      edited.push(`${file.path} (missing)`);
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      edited.push(file.path);
  }
  return edited;
}

// Remove a dropped file and any directories it leaves empty.
async function removeManagedFile(skills: string, path: string): Promise<void> {
  await rm(join(skills, path), { force: true });
  for (let dir = dirname(path); dir !== "."; dir = dirname(dir)) {
    try {
      await rmdir(join(skills, dir));
    } catch {
      return;
    }
  }
}

export async function main(
  args: string[] = process.argv.slice(2),
  options: Options = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!)) {
    output.stdout(HELP);
    return 0;
  }
  if (args.length !== 1 || args[0] !== "update") {
    output.stderr(HELP);
    return 1;
  }
  try {
    const repoRoot = options.repoRoot ?? process.cwd();
    const skills = join(repoRoot, SKILL_DIR);
    const manifestPath = join(skills, MANIFEST);
    const before = await readManifest(manifestPath);
    const edited = await editedFiles(skills, before);
    if (edited.length > 0) {
      output.stderr(
        [
          "Refusing to update customized project-local skills:",
          ...edited.map((path) => `- ${path}`),
          "Restore or move these files, then rerun patchmill skills update.",
        ].join("\n"),
      );
      return 1;
    }
    const counts = await installSkills({
      repoRoot,
      skillDir: SKILL_DIR,
      packageRoot:
        options.packageRoot ??
        findPackageRoot(dirname(fileURLToPath(import.meta.url))),
    });
    const after = await readManifest(manifestPath);
    const kept = new Set(after.files.map((file) => file.path));
    const dropped = before.files.filter((file) => !kept.has(file.path));
    for (const file of dropped) await removeManagedFile(skills, file.path);
    if (counts.written === 0 && dropped.length === 0) {
      output.stdout("Patchmill skill pack is already up to date.");
      return 0;
    }
    output.stdout(
      `Updated Patchmill skill pack ${before.sources.patchmill} -> ${after.sources.patchmill}.`,
    );
    output.stdout(
      `Skills: ${counts.written} written, ${counts.unchanged} unchanged, ${dropped.length} removed`,
    );
    output.stdout("Run git diff to review changes.");
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
