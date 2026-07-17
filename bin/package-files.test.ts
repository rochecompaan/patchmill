import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type NpmPackEntry = {
  files?: Array<{ path: string }>;
};

test("package metadata identifies Patchmill as Apache-2.0", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ) as {
    bin?: { patchmill?: string };
    license?: string;
    scripts?: { prepack?: string };
  };
  const license = readFileSync(join(repoRoot, "LICENSE"), "utf8");
  const thirdPartyNotices = readFileSync(
    join(repoRoot, "THIRD_PARTY_NOTICES.md"),
    "utf8",
  );

  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(packageJson.bin?.patchmill, "dist/bin/patchmill.js");
  assert.equal(packageJson.scripts?.prepack, "npm run build");
  assert.match(license, /^Copyright 2026 Roché Compaan\n/u);
  assert.match(license, /Apache License\n\s+Version 2\.0, January 2004/u);
  assert.match(
    thirdPartyNotices,
    /License: Apache License 2\.0 \(`LICENSE`\)/u,
  );
  assert.match(thirdPartyNotices, /## Superpowers skill wrappers/u);
  assert.match(
    thirdPartyNotices,
    /Repository: <https:\/\/github\.com\/obra\/superpowers>/u,
  );
  assert.match(thirdPartyNotices, /License: MIT License/u);
  assert.match(thirdPartyNotices, /skills\/patchmill-planning/u);
});

test("npm pack dry-run includes bundled runtime resources and notices", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmCache = mkdtempSync(join(tmpdir(), "patchmill-npm-cache-"));
  const result = spawnSync(
    npmCommand,
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: npmCache,
      },
    },
  );
  rmSync(npmCache, { force: true, recursive: true });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packEntries = JSON.parse(result.stdout) as NpmPackEntry[];
  const files = new Set(packEntries[0]?.files?.map((file) => file.path) ?? []);
  assert.equal(files.has("skills/patchmill-issue-triage/SKILL.md"), true);
  assert.equal(files.has("skills/module-size/SKILL.md"), true);
  assert.equal(files.has("skills/patchmill-planning/SKILL.md"), true);
  assert.equal(files.has("skills/brainstorming/SKILL.md"), false);
  assert.equal(files.has("skills/writing-plans/SKILL.md"), false);
  assert.equal(files.has("skills/test-driven-development/SKILL.md"), false);
  assert.equal(files.has("extensions/todos.ts"), true);
  assert.equal(files.has("CHANGELOG.md"), true);
  assert.equal(files.has("LICENSES/Apache-2.0.txt"), false);
  assert.equal(files.has("THIRD_PARTY_NOTICES.md"), true);
  assert.equal(files.has("tsconfig.build.json"), true);
});
