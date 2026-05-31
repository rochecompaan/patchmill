import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as T;
}

test("release-please manifest starts from the package version", () => {
  const packageJson = readJson<{ version: string }>("package.json");
  const manifest = readJson<Record<string, string>>(
    ".release-please-manifest.json",
  );

  assert.equal(manifest["."], packageJson.version);
});

test("release-please config manages the root node package and Nix version", () => {
  const config = readJson<{
    packages?: Record<
      string,
      {
        "release-type"?: string;
        "package-name"?: string;
        "include-component-in-tag"?: boolean;
        "extra-files"?: Array<{ type?: string; path?: string }>;
      }
    >;
  }>("release-please-config.json");

  assert.deepEqual(config.packages?.["."], {
    "release-type": "node",
    "package-name": "@rochecompaan/patchmill",
    "include-component-in-tag": false,
    "extra-files": [{ type: "generic", path: "nix/package.nix" }],
  });
});

test("Nix package version is marked for release-please updates", () => {
  const packageJson = readJson<{ version: string }>("package.json");
  const nixPackage = readFileSync(join(repoRoot, "nix/package.nix"), "utf8");

  assert.match(
    nixPackage,
    new RegExp(
      `version = "${packageJson.version}"; # x-release-please-version`,
      "u",
    ),
  );
});

test("release workflow opens release PRs and publishes created releases", () => {
  const workflow = readFileSync(
    join(repoRoot, ".github/workflows/release-please.yml"),
    "utf8",
  );

  assert.match(workflow, /googleapis\/release-please-action@v4/u);
  assert.match(workflow, /contents: write/u);
  assert.match(workflow, /pull-requests: write/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(
    workflow,
    /if: \$\{\{ steps\.release\.outputs\.release_created \}\}/u,
  );
  assert.match(workflow, /npm publish --provenance --access public/u);
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/u);
});
