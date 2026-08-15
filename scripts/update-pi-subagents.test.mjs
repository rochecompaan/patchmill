import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getCurrentPiSubagentsVersion } from "./pi-subagents-upgrade-lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(rootDir, "scripts/update-pi-subagents.mjs");

function runUpdateScript(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
      ...options,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

test("update CLI validates the current pin without Git on PATH", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "patchmill-subagents-test-"));
  const summaryPath = join(tempDir, "nested", "summary.json");

  try {
    const packageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    );
    const currentVersion = getCurrentPiSubagentsVersion(packageJson);
    const result = await runUpdateScript(
      [
        "--mode",
        "manual",
        "--pi-subagents-version",
        currentVersion,
        "--validate-only",
        "--summary-json",
        summaryPath,
      ],
      { env: { ...process.env, PATH: tempDir } },
    );

    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.equal(summary.currentVersion, currentVersion);
    assert.equal(summary.targetVersion, currentVersion);
    assert.equal(summary.validateOnly, true);
    assert.equal(summary.noUpdate, true);
    assert.deepEqual(summary.changedFiles, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("update CLI records parse failures in the summary", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "patchmill-subagents-test-"));
  const summaryPath = join(tempDir, "nested", "summary.json");

  try {
    const result = await runUpdateScript([
      "--summary-json",
      summaryPath,
      "--mode",
      "invalid",
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /--mode must be scheduled or manual/);
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.match(summary.error, /--mode must be scheduled or manual/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("update CLI records invalid requested versions in the summary", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "patchmill-subagents-test-"));
  const summaryPath = join(tempDir, "nested", "summary.json");

  try {
    const result = await runUpdateScript([
      "--mode",
      "manual",
      "--pi-subagents-version",
      "^0.39.0",
      "--validate-only",
      "--summary-json",
      summaryPath,
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /must be a stable X\.Y\.Z version/);
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.match(summary.error, /must be a stable X\.Y\.Z version/);
    assert.deepEqual(summary.changedFiles, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
