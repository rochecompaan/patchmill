import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type NpmPackEntry = {
  files?: Array<{ path: string }>;
};

test("npm pack dry-run includes bundled triage skill", () => {
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
  assert.equal(
    packEntries[0]?.files?.some(
      (file) => file.path === "skills/patchmill-issue-triage/SKILL.md",
    ) ?? false,
    true,
  );
});
