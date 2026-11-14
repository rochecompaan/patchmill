import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";

import * as installer from "./skill-installer.ts";

async function packageFixture(
  t: { after: (fn: () => Promise<void>) => void },
  withDesign = true,
) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-resource-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "package");
  await mkdir(packageRoot);
  await cp(join(process.cwd(), "skills"), join(packageRoot, "skills"), {
    recursive: true,
  });
  await writeFile(join(packageRoot, "package.json"), '{"version":"fixture"}');
  for (const name of [
    "superpowers",
    "simple-english",
    ...(withDesign ? ["mattpocock-skills"] : []),
  ]) {
    await cp(
      join(process.cwd(), "node_modules", name),
      join(packageRoot, "node_modules", name),
      { recursive: true },
    );
  }
  return { root, packageRoot };
}

test("installs complete real packs with hashes, repairs files and preserves unchanged bytes and mtimes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillDir = ".patchmill/skills";
  const options = { repoRoot: root, skillDir, packageRoot: process.cwd() };
  const first = await installer.installSkills(options);
  assert.ok(first.written > 20);
  const destination = join(root, skillDir);
  const manifestPath = join(destination, "patchmill-skill-pack.json");
  const manifestBytes = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestBytes);
  const require = createRequire(join(process.cwd(), "package.json"));
  const packs = [
    [process.cwd(), installer.PATCHMILL_SKILLS, "patchmill"],
    [
      dirname(require.resolve("superpowers/package.json")),
      installer.SUPERPOWERS_SKILLS,
      "superpowers",
    ],
    [
      dirname(require.resolve("simple-english/package.json")),
      installer.SIMPLE_ENGLISH_SKILLS,
      "simpleEnglish",
    ],
  ] as const;
  const expected: string[] = [];
  async function checkTree(source: string, target: string) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(target, entry.name);
      if (entry.isDirectory()) await checkTree(from, to);
      else {
        assert.deepEqual(await readFile(to), await readFile(from));
        expected.push(relative(destination, to));
      }
    }
  }
  for (const [packRoot, names, key] of packs) {
    assert.equal(
      manifest.sources[key],
      JSON.parse(await readFile(join(packRoot, "package.json"), "utf8"))
        .version,
    );
    for (const name of names)
      await checkTree(join(packRoot, "skills", name), join(destination, name));
  }
  const designRoot = dirname(require.resolve("mattpocock-skills/package.json"));
  assert.equal(
    manifest.sources.mattPocock,
    JSON.parse(await readFile(join(designRoot, "package.json"), "utf8"))
      .version,
  );
  for (const name of ["domain-modeling", "codebase-design"]) {
    await checkTree(
      join(designRoot, "skills/engineering", name),
      join(destination, name),
    );
    assert.deepEqual(
      await readFile(join(destination, name, "LICENSE")),
      await readFile(join(designRoot, "LICENSE")),
    );
    expected.push(`${name}/LICENSE`);
  }
  // These resources guard the R51 regressions through actual installation.
  await stat(join(destination, "using-git-worktrees/SKILL.md"));
  await stat(join(destination, "finishing-a-development-branch/SKILL.md"));
  await stat(
    join(destination, "subagent-driven-development/implementer-prompt.md"),
  );
  // Planning and implementation stop when these frontend files are missing.
  for (const path of [
    "frontend-design/SKILL.md",
    "frontend-design/LICENSE.txt",
    "patchmill-frontend-review/SKILL.md",
    "patchmill-frontend-review/LICENSE",
    "patchmill-frontend-review/references/web-interface-guidelines.md",
  ])
    await stat(join(destination, path));
  assert.deepEqual(
    manifest.files.map((file: { path: string }) => file.path).sort(),
    expected.sort(),
  );
  for (const file of manifest.files) {
    assert.equal(
      file.sha256,
      createHash("sha256")
        .update(await readFile(join(destination, file.path)))
        .digest("hex"),
    );
  }
  const paths = [
    manifestPath,
    ...expected.map((path) => join(destination, path)),
  ];
  const times = await Promise.all(
    paths.map(async (path) => (await stat(path)).mtimeMs),
  );
  await writeFile(join(destination, "unrelated.txt"), "keep");
  assert.deepEqual(await installer.installSkills(options), {
    written: 0,
    unchanged: first.written,
  });
  assert.deepEqual(
    await Promise.all(paths.map(async (path) => (await stat(path)).mtimeMs)),
    times,
  );
  assert.equal(await readFile(manifestPath, "utf8"), manifestBytes);
  await writeFile(join(destination, "codebase-design/DEEPENING.md"), "damage");
  await rm(join(destination, "domain-modeling/LICENSE"));
  assert.equal((await installer.installSkills(options)).written, 2);
  assert.deepEqual(
    await readFile(join(destination, "codebase-design/DEEPENING.md")),
    await readFile(
      join(designRoot, "skills/engineering/codebase-design/DEEPENING.md"),
    ),
  );
  assert.deepEqual(
    await readFile(join(destination, "domain-modeling/LICENSE")),
    await readFile(join(designRoot, "LICENSE")),
  );
  await writeFile(paths[1]!, "damaged");
  assert.equal((await installer.installSkills(options)).written, 1);
  assert.equal(
    await readFile(join(destination, "unrelated.txt"), "utf8"),
    "keep",
  );
});

test("resolves from the supplied package and copies read-only executable resources as writable files", async (t) => {
  const { root, packageRoot } = await packageFixture(t);
  const designRoot = join(packageRoot, "node_modules/mattpocock-skills");
  await writeFile(
    join(designRoot, "package.json"),
    '{"version":"fixture-design"}',
  );
  const designSource = join(
    designRoot,
    "skills/engineering/codebase-design/DEEPENING.md",
  );
  await writeFile(designSource, "package-local design resource\n");
  await chmod(designSource, 0o444);
  await chmod(join(designRoot, "LICENSE"), 0o444);
  const source = join(packageRoot, "skills/module-size/tool.sh");
  await writeFile(source, "#!/bin/sh\necho resource\n");
  await chmod(source, 0o555);
  const options = { repoRoot: root, skillDir: "installed", packageRoot };
  await installer.installSkills(options);
  const target = join(root, "installed/module-size/tool.sh");
  assert.equal((await stat(target)).mode & 0o700, 0o700);
  await writeFile(target, "damage");
  await installer.installSkills(options);
  assert.equal(await readFile(target, "utf8"), "#!/bin/sh\necho resource\n");
  assert.equal((await stat(source)).mode & 0o777, 0o555);
  assert.equal(
    JSON.parse(
      await readFile(join(root, "installed/patchmill-skill-pack.json"), "utf8"),
    ).sources.patchmill,
    "fixture",
  );
  assert.equal(
    await readFile(
      join(root, "installed/codebase-design/DEEPENING.md"),
      "utf8",
    ),
    "package-local design resource\n",
  );
  assert.equal((await stat(designSource)).mode & 0o777, 0o444);
  assert.equal(
    (await stat(join(root, "installed/domain-modeling/LICENSE"))).mode & 0o600,
    0o600,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(root, "installed/patchmill-skill-pack.json"), "utf8"),
    ).sources.mattPocock,
    "fixture-design",
  );
});

test("rejects an absent package-local design dependency", async (t) => {
  const { root, packageRoot } = await packageFixture(t, false);
  await assert.rejects(
    installer.installSkills({
      repoRoot: root,
      skillDir: "installed",
      packageRoot,
    }),
    { code: "MODULE_NOT_FOUND" },
  );
});
