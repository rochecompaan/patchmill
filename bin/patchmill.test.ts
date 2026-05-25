import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HELP_TEXT } from "../src/cli/main.ts";

test("patchmill executes when invoked through a symlink", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fixtureDir = mkdtempSync(join(tmpdir(), "patchmill-"));
  const symlinkPath = join(fixtureDir, "patchmill-link.ts");

  try {
    symlinkSync(join(repoRoot, "bin", "patchmill.ts"), symlinkPath, "file");

    const result = spawnSync(process.execPath, [symlinkPath, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${HELP_TEXT}\n`);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
