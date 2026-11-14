import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const PATCHMILL_SKILLS = [
  "patchmill-issue-triage",
  "patchmill-planning",
  "patchmill-implementation",
  "patchmill-visual-evidence",
  "patchmill-frontend-review",
  "frontend-design",
  "module-size",
  "patchmill-cleanup",
  "patchmill-label",
  "patchmill-plan",
];
export const SUPERPOWERS_SKILLS = [
  "brainstorming",
  "writing-plans",
  "executing-plans",
  "subagent-driven-development",
  "dispatching-parallel-agents",
  "test-driven-development",
  "systematic-debugging",
  "verification-before-completion",
  "requesting-code-review",
  "receiving-code-review",
  "using-git-worktrees",
  "finishing-a-development-branch",
  "using-superpowers",
];
export const SIMPLE_ENGLISH_SKILLS = ["simple-english"];
export const MATT_POCOCK_SKILLS = ["domain-modeling", "codebase-design"];
export type SkillPackManifest = {
  installedAt: string;
  sources: {
    patchmill: string;
    superpowers: string;
    simpleEnglish: string;
    mattPocock: string;
  };
  files: Array<{ path: string; sha256: string }>;
};

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function installSkills(options: {
  repoRoot: string;
  skillDir: string;
  packageRoot: string;
}): Promise<{ written: number; unchanged: number }> {
  const { repoRoot, skillDir, packageRoot } = options;
  const require = createRequire(join(packageRoot, "package.json"));
  const superpowers = dirname(require.resolve("superpowers/package.json"));
  const simpleEnglish = dirname(require.resolve("simple-english/package.json"));
  const mattPocock = dirname(require.resolve("mattpocock-skills/package.json"));
  const destination = join(repoRoot, skillDir);
  const counts = { written: 0, unchanged: 0 };
  const files: SkillPackManifest["files"] = [];
  async function copyFile(source: string, path: string): Promise<void> {
    const bytes = await readFile(source);
    files.push({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const to = join(destination, path);
    const old = await readOptional(to);
    const mode = ((await stat(source)).mode & 0o777) | 0o600;
    const modeChanged =
      old !== undefined && ((await stat(to)).mode & 0o777) !== mode;
    if (old?.equals(bytes) && !modeChanged) counts.unchanged++;
    else {
      if (old) await chmod(to, mode);
      if (!old?.equals(bytes)) await writeFile(to, bytes, { mode });
      await chmod(to, mode);
      counts.written++;
    }
  }
  async function copyDirectory(
    source: string,
    relative: string,
  ): Promise<void> {
    await mkdir(join(destination, relative), { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const from = join(source, entry.name);
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await copyDirectory(from, path);
      else await copyFile(from, path);
    }
  }
  async function version(root: string): Promise<string> {
    return (
      JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
  }
  for (const [root, names] of [
    [packageRoot, PATCHMILL_SKILLS],
    [superpowers, SUPERPOWERS_SKILLS],
    [simpleEnglish, SIMPLE_ENGLISH_SKILLS],
  ] as const) {
    for (const name of names)
      await copyDirectory(join(root, "skills", name), name);
  }
  for (const name of MATT_POCOCK_SKILLS) {
    await copyDirectory(join(mattPocock, "skills/engineering", name), name);
    await copyFile(join(mattPocock, "LICENSE"), join(name, "LICENSE"));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const sources = {
    patchmill: await version(packageRoot),
    superpowers: await version(superpowers),
    simpleEnglish: await version(simpleEnglish),
    mattPocock: await version(mattPocock),
  };
  const manifestPath = join(destination, "patchmill-skill-pack.json");
  const previous = await readOptional(manifestPath);
  let old: SkillPackManifest | undefined;
  try {
    if (previous) old = JSON.parse(previous.toString()) as SkillPackManifest;
  } catch {
    // Replace an invalid managed manifest.
  }
  if (
    old &&
    JSON.stringify(old.sources) === JSON.stringify(sources) &&
    JSON.stringify(old.files) === JSON.stringify(files)
  ) {
    counts.unchanged++;
  } else {
    const manifest: SkillPackManifest = {
      installedAt: new Date().toISOString(),
      sources,
      files,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    counts.written++;
  }
  return counts;
}
