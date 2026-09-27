import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as repack from "./repack-simple-english.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function makeTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "repack-simple-english-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writePayloadEntry(sourceDir, entry) {
  const target = join(sourceDir, entry);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${entry} contents\n`);
}

test("keeps the existing vendored package when a payload copy fails", async (t) => {
  assert.equal(typeof repack.installSimpleEnglishPackage, "function");
  const root = await makeTempDir(t);
  const vendorDir = join(root, "vendor", "simple-english");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(join(vendorDir, "sentinel.txt"), "previous package\n");

  const sourceDir = join(await makeTempDir(t), "extracted");
  await writePayloadEntry(sourceDir, "skills/simple-english/SKILL.md");
  await writePayloadEntry(sourceDir, "README.md");
  // LICENSE intentionally missing so the payload copy fails.

  await assert.rejects(
    repack.installSimpleEnglishPackage({ rootDir: root, sourceDir }),
    /ENOENT/u,
  );
  assert.equal(
    await readFile(join(vendorDir, "sentinel.txt"), "utf8"),
    "previous package\n",
    "existing vendor package must survive a failed repack",
  );
  assert.deepEqual(
    await readdir(join(root, "vendor")),
    ["simple-english"],
    "no staging directories left behind",
  );
});

test("replaces the vendored package with a fully staged payload", async (t) => {
  assert.equal(typeof repack.installSimpleEnglishPackage, "function");
  const root = await makeTempDir(t);
  const vendorDir = join(root, "vendor", "simple-english");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(join(vendorDir, "stale.txt"), "stale\n");

  const sourceDir = join(await makeTempDir(t), "extracted");
  await writePayloadEntry(sourceDir, "skills/simple-english/SKILL.md");
  await writePayloadEntry(sourceDir, "README.md");
  await writePayloadEntry(sourceDir, "LICENSE");

  const installed = await repack.installSimpleEnglishPackage({
    rootDir: root,
    sourceDir,
  });
  assert.equal(installed, vendorDir);
  assert.equal(
    await readFile(join(vendorDir, "skills/simple-english/SKILL.md"), "utf8"),
    "skills/simple-english/SKILL.md contents\n",
  );
  const packageJson = JSON.parse(
    await readFile(join(vendorDir, "package.json"), "utf8"),
  );
  assert.equal(packageJson.name, "simple-english");
  assert.equal(
    packageJson.version,
    repack.SIMPLE_ENGLISH_TAG.replace(/^v/u, ""),
  );
  assert.deepEqual(await readdir(join(root, "vendor")), ["simple-english"]);
  await assert.rejects(readFile(join(vendorDir, "stale.txt"), "utf8"), {
    code: "ENOENT",
  });
});

test("module imports cleanly when process.argv[1] is undefined", () => {
  const scriptUrl = pathToFileURL(
    join(rootDir, "scripts/repack-simple-english.mjs"),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(scriptUrl)}); console.log("import-ok", typeof m.repackSimpleEnglish);`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /import-ok function/u);
});
