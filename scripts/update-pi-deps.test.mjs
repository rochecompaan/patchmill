import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawn } from "node:child_process";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(rootDir, "scripts/update-pi-deps.mjs");

function runUpdateScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

test("update CLI creates parent directories for successful summaries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "patchmill-pi-deps-test-"));
  const summaryPath = join(tempDir, "nested", "summary.json");

  try {
    const result = await runUpdateScript([
      "--mode",
      "manual",
      "--target-version",
      "0.80.10",
      "--validate-only",
      "--skip-nix-hash",
      "--summary-json",
      summaryPath,
    ]);

    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.equal(summary.validateOnly, true);
    assert.equal(summary.noUpdate, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("update CLI records actionable failures in the summary", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "patchmill-pi-deps-test-"));
  const summaryPath = join(tempDir, "nested", "summary.json");

  try {
    const result = await runUpdateScript([
      "--mode",
      "manual",
      "--pi-coding-agent-version",
      "0.80.10",
      "--summary-json",
      summaryPath,
    ]);

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /pi-tui manual version must be an exact version/,
    );
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.equal(summary.validateOnly, false);
    assert.deepEqual(summary.targets, {});
    assert.deepEqual(summary.changedFiles, []);
    assert.match(
      summary.error,
      /pi-tui manual version must be an exact version/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
