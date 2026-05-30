import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type NpmPackEntry = {
  files?: Array<{ path: string }>;
};

test("package metadata identifies Patchmill as Apache-2.0", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ) as { license?: string };
  const license = readFileSync(join(repoRoot, "LICENSE"), "utf8");
  const thirdPartyNotices = readFileSync(
    join(repoRoot, "THIRD_PARTY_NOTICES.md"),
    "utf8",
  );

  assert.equal(packageJson.license, "Apache-2.0");
  assert.match(license, /^Copyright 2026 Roché Compaan\n/u);
  assert.match(license, /Apache License\n\s+Version 2\.0, January 2004/u);
  assert.match(
    thirdPartyNotices,
    /License: Apache License 2\.0 \(`LICENSE`\)/u,
  );
});

test("npm pack dry-run includes bundled runtime resources and notices", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packEntries = JSON.parse(result.stdout) as NpmPackEntry[];
  const files = new Set(packEntries[0]?.files?.map((file) => file.path) ?? []);
  assert.equal(files.has("skills/patchmill-issue-triage/SKILL.md"), true);
  assert.equal(files.has("extensions/todos.ts"), true);
  assert.equal(files.has("CHANGELOG.md"), true);
  assert.equal(files.has("LICENSES/Apache-2.0.txt"), false);
  assert.equal(files.has("THIRD_PARTY_NOTICES.md"), true);
});
