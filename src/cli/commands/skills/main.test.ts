import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { installSkills } from "../init/skill-installer.ts";
import { main } from "./main.ts";

const SKILL_DIR = ".patchmill/skills";

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-skills-update-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const lines: string[] = [];
  const errors: string[] = [];
  const run = (args = ["update"]) =>
    main(args, {
      repoRoot,
      packageRoot: process.cwd(),
      output: { stdout: (l) => lines.push(l), stderr: (l) => errors.push(l) },
    });
  return { repoRoot, lines, errors, run, skills: join(repoRoot, SKILL_DIR) };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

test("refuses to update before patchmill init installed the pack", async (t) => {
  const { run, errors } = await setup(t);
  assert.equal(await run(), 1);
  assert.match(errors.join("\n"), /patchmill init/);
});

test("refuses to overwrite edited or missing managed files", async (t) => {
  const { repoRoot, run, errors, skills } = await setup(t);
  await installSkills({
    repoRoot,
    skillDir: SKILL_DIR,
    packageRoot: process.cwd(),
  });
  const edited = join(skills, "patchmill-planning/SKILL.md");
  await writeFile(edited, "local edit\n");
  await rm(join(skills, "module-size/SKILL.md"));
  assert.equal(await run(), 1);
  const message = errors.join("\n");
  assert.match(message, /patchmill-planning\/SKILL\.md/);
  assert.match(message, /module-size\/SKILL\.md \(missing\)/);
  assert.equal(await readFile(edited, "utf8"), "local edit\n");
});

test("updates the pack and removes files dropped from it", async (t) => {
  const { repoRoot, run, lines, skills } = await setup(t);
  await installSkills({
    repoRoot,
    skillDir: SKILL_DIR,
    packageRoot: process.cwd(),
  });
  const manifestPath = join(skills, "patchmill-skill-pack.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const obsolete = "retired-skill/SKILL.md";
  const bytes = "retired\n";
  await mkdir(join(skills, "retired-skill"));
  await writeFile(join(skills, obsolete), bytes);
  manifest.files.push({
    path: obsolete,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  manifest.sources.patchmill = "0.0.1";
  await writeFile(manifestPath, JSON.stringify(manifest));

  assert.equal(await run(), 0);
  assert.equal(await exists(join(skills, obsolete)), false);
  assert.equal(await exists(join(skills, "retired-skill")), false);
  const output = lines.join("\n");
  assert.match(output, /0\.0\.1 -> /);
  assert.match(output, /1 removed/);
  const updated = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(!updated.files.some((f: { path: string }) => f.path === obsolete));
});

test("reports an unchanged pack as up to date", async (t) => {
  const { repoRoot, run, lines } = await setup(t);
  await installSkills({
    repoRoot,
    skillDir: SKILL_DIR,
    packageRoot: process.cwd(),
  });
  assert.equal(await run(), 0);
  assert.match(lines.join("\n"), /already up to date/);
});

test("rejects unknown subcommands", async (t) => {
  const { run, errors } = await setup(t);
  assert.equal(await run(["upgrade"]), 1);
  assert.match(errors.join("\n"), /Usage: patchmill skills update/);
});
