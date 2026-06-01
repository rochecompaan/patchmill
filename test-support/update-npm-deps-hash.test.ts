import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const staleHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const expectedHash = "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

test("update-npm-deps-hash extracts the fixed-output got hash only", async () => {
  const repoRoot = await createScriptFixture();
  const binDir = await createFakeNix(
    repoRoot,
    `const text = readPackage();
if (text.includes(${JSON.stringify(expectedHash)})) process.exit(0);
console.error(\`ERROR: npmDepsHash is out of date

To fix the issue:
1. Use lib.fakeHash as the npmDepsHash value
2. Build the derivation and wait for it to fail with a hash mismatch
3. Copy the 'got: sha256-' value back into the npmDepsHash field

error: hash mismatch in fixed-output derivation
         specified: ${staleHash}
            got:    ${expectedHash}\`);
process.exit(1);
`,
  );

  const result = runUpdateScript(repoRoot, binDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    await readFile(join(repoRoot, "nix", "package.nix"), "utf8"),
    new RegExp(`npmDepsHash = "${escapeRegExp(expectedHash)}";`, "u"),
  );
});

test("update-npm-deps-hash uses fake hash when dependency lock comparison omits got hash", async () => {
  const repoRoot = await createScriptFixture();
  const binDir = await createFakeNix(
    repoRoot,
    `const text = readPackage();
if (text.includes(${JSON.stringify(expectedHash)})) process.exit(0);
if (text.includes("npmDepsHash = lib.fakeHash;")) {
  console.error(\`error: hash mismatch in fixed-output derivation
         specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
            got:    ${expectedHash}\`);
  process.exit(1);
}
console.error(\`ERROR: npmDepsHash is out of date
> 3. Copy the 'got: sha256-' value back into the npmDepsHash field\`);
process.exit(1);
`,
  );

  const result = runUpdateScript(repoRoot, binDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    await readFile(join(repoRoot, "nix", "package.nix"), "utf8"),
    new RegExp(`npmDepsHash = "${escapeRegExp(expectedHash)}";`, "u"),
  );
});

test("update-npm-deps-hash ignores instructional got-hash text", async () => {
  const repoRoot = await createScriptFixture();
  const binDir = await createFakeNix(
    repoRoot,
    `console.error(\`ERROR: npmDepsHash is out of date
> 3. Copy the 'got: sha256-' value back into the npmDepsHash field\`);
process.exit(1);
`,
  );

  const result = runUpdateScript(repoRoot, binDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no fixed-output hash mismatch was found/u);
  assert.match(
    await readFile(join(repoRoot, "nix", "package.nix"), "utf8"),
    new RegExp(`npmDepsHash = "${escapeRegExp(staleHash)}";`, "u"),
  );
});

async function createScriptFixture(): Promise<string> {
  const repoRoot = await mkdtempRepo();

  await mkdir(join(repoRoot, "nix"));
  await writeFile(
    join(repoRoot, "nix", "package.nix"),
    `{
  npmDepsHash = "${staleHash}";
}
`,
  );

  await mkdir(join(repoRoot, "scripts"));
  await writeFile(
    join(repoRoot, "scripts", "update-npm-deps-hash.sh"),
    await readFile(
      new URL("../scripts/update-npm-deps-hash.sh", import.meta.url),
      "utf8",
    ),
  );

  return repoRoot;
}

async function createFakeNix(
  repoRoot: string,
  behavior: string,
): Promise<string> {
  const binDir = join(repoRoot, "bin");
  await mkdir(binDir);
  const fakeNixPath = join(binDir, "nix");
  await writeFile(
    fakeNixPath,
    `#!${process.execPath}
const fs = require("node:fs");
function readPackage() {
  return fs.readFileSync("nix/package.nix", "utf8");
}
${behavior}`,
  );
  await chmod(fakeNixPath, 0o755);
  return binDir;
}

function runUpdateScript(repoRoot: string, binDir: string) {
  return spawnSync("bash", ["scripts/update-npm-deps-hash.sh"], {
    cwd: repoRoot,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  });
}

async function mkdtempRepo(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "patchmill-npm-deps-hash-"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
