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

test("upgrades a prior pack to complete design skills", async (t) => {
  const { repoRoot, run, skills } = await setup(t);
  await installSkills({
    repoRoot,
    skillDir: SKILL_DIR,
    packageRoot: process.cwd(),
  });
  const manifestPath = join(skills, "patchmill-skill-pack.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const name of ["domain-modeling", "codebase-design"]) {
    await rm(join(skills, name), { recursive: true, force: true });
    manifest.files = manifest.files.filter(
      (file: { path: string }) => !file.path.startsWith(`${name}/`),
    );
  }
  delete manifest.sources.mattPocock;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(skills, "user-note.txt"), "keep\n");
  assert.equal(await run(), 0);
  for (const path of [
    "domain-modeling/SKILL.md",
    "domain-modeling/LICENSE",
    "codebase-design/DEEPENING.md",
    "codebase-design/LICENSE",
  ])
    assert.equal(await exists(join(skills, path)), true, path);
  assert.equal(await readFile(join(skills, "user-note.txt"), "utf8"), "keep\n");
});

test("protects customized design resources during update", async (t) => {
  const { repoRoot, run, skills, errors } = await setup(t);
  await installSkills({
    repoRoot,
    skillDir: SKILL_DIR,
    packageRoot: process.cwd(),
  });
  const manifestPath = join(skills, "patchmill-skill-pack.json");
  const before = await readFile(manifestPath, "utf8");
  await writeFile(join(skills, "codebase-design/DEEPENING.md"), "local edit\n");
  await rm(join(skills, "domain-modeling/LICENSE"));
  assert.equal(await run(), 1);
  assert.match(errors.join("\n"), /codebase-design\/DEEPENING.md/);
  assert.match(errors.join("\n"), /domain-modeling\/LICENSE/);
  assert.equal(
    await readFile(join(skills, "codebase-design/DEEPENING.md"), "utf8"),
    "local edit\n",
  );
  assert.equal(await readFile(manifestPath, "utf8"), before);
});

test("upgrades a prior pack with complete show-me resources and stable hashes", async (t) => {
  const { repoRoot, run, skills, lines } = await setup(t);
  await installSkills({
    repoRoot,
    skillDir: SKILL_DIR,
    packageRoot: process.cwd(),
  });
  const manifestPath = join(skills, "patchmill-skill-pack.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await rm(join(skills, "show-me"), { recursive: true, force: true });
  manifest.files = manifest.files.filter(
    (file: { path: string }) => !file.path.startsWith("show-me/"),
  );
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(skills, "user-note.txt"), "keep\n");
  assert.equal(await run(), 0);
  const updatedBytes = await readFile(manifestPath, "utf8");
  const updated = JSON.parse(updatedBytes);
  for (const path of [
    "show-me/SKILL.md",
    "show-me/agents/openai.yaml",
    "show-me/LICENSE",
  ]) {
    const bytes = await readFile(join(skills, path));
    assert.equal(
      updated.files.find((file: { path: string }) => file.path === path)
        ?.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
  }
  assert.equal(await readFile(join(skills, "user-note.txt"), "utf8"), "keep\n");
  lines.length = 0;
  assert.equal(await run(), 0);
  assert.match(lines.join("\n"), /already up to date/);
  assert.equal(await readFile(manifestPath, "utf8"), updatedBytes);
});

test("protects edited show-me guidance and a missing license during update", async (t) => {
  const { repoRoot, run, skills, errors } = await setup(t);
  await installSkills({
    repoRoot,
    skillDir: SKILL_DIR,
    packageRoot: process.cwd(),
  });
  const manifestPath = join(skills, "patchmill-skill-pack.json");
  const before = await readFile(manifestPath, "utf8");
  await writeFile(
    join(skills, "show-me/SKILL.md"),
    "local conceptual guidance\n",
  );
  await rm(join(skills, "show-me/LICENSE"));
  assert.equal(await run(), 1);
  assert.match(errors.join("\n"), /show-me\/SKILL\.md/);
  assert.match(errors.join("\n"), /show-me\/LICENSE \(missing\)/);
  assert.equal(
    await readFile(join(skills, "show-me/SKILL.md"), "utf8"),
    "local conceptual guidance\n",
  );
  assert.equal(await exists(join(skills, "show-me/LICENSE")), false);
  assert.equal(await readFile(manifestPath, "utf8"), before);
});

test("rejects unknown subcommands", async (t) => {
  const { run, errors } = await setup(t);
  assert.equal(await run(["upgrade"]), 1);
  assert.match(errors.join("\n"), /Usage: patchmill skills update/);
});
