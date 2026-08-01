import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertInstalledPiSubagentsMatchesRootPin,
  isExactNpmVersion,
  piSubagentsExtensionFiles,
  readInstalledPiSubagentsManifest,
  readRootPiSubagentsPin,
  resolvePiSubagentsPackageRoot,
} from "./pi-subagents-package.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("root pi-subagents dependency is an exact installed pin", () => {
  const pin = readRootPiSubagentsPin(join(rootDir, "package.json"));
  assert.equal(isExactNpmVersion(pin), true);
  assertInstalledPiSubagentsMatchesRootPin(join(rootDir, "package.json"));
});

test("lockfiles agree with the root pi-subagents pin", () => {
  const pin = readRootPiSubagentsPin(join(rootDir, "package.json"));
  for (const filename of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const lockfile = readJson(join(rootDir, filename)) as {
      packages?: Record<
        string,
        { version?: string; dependencies?: Record<string, string> }
      >;
    };
    assert.equal(lockfile.packages?.[""]?.dependencies?.["pi-subagents"], pin);
    assert.equal(
      lockfile.packages?.["node_modules/pi-subagents"]?.version,
      pin,
    );
  }
});

test("installed pi-subagents manifest declares existing extension files", () => {
  const packageRoot = resolvePiSubagentsPackageRoot();
  assert.equal(packageRoot.endsWith("pi-subagents"), true);
  const manifest = readInstalledPiSubagentsManifest();
  assert.equal(
    manifest.version,
    readRootPiSubagentsPin(join(rootDir, "package.json")),
  );
  assert.ok(Array.isArray(manifest.pi?.extensions));
  assert.ok((manifest.pi?.extensions ?? []).length > 0);
  for (const extensionFile of piSubagentsExtensionFiles()) {
    assert.equal(extensionFile.startsWith(packageRoot), true);
    assert.equal(
      existsSync(extensionFile),
      true,
      `missing extension ${extensionFile}`,
    );
    assert.equal(
      statSync(extensionFile).isFile(),
      true,
      `not a file ${extensionFile}`,
    );
  }
});

test("pi loads the resolved pi-subagents extension package without model execution", () => {
  const result = spawnSync(
    "./node_modules/.bin/pi",
    ["--offline", "-e", resolvePiSubagentsPackageRoot(), "--help"],
    { cwd: rootDir, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /extension load failed|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
  );
});
