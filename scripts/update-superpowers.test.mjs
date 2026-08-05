import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  runSuperpowersUpgrade,
  validationCommands,
} from "./update-superpowers.mjs";

const rootDir = process.cwd();
const release = (tag) => ({
  tag_name: tag,
  name: tag,
  html_url: `https://github.com/obra/superpowers/releases/tag/${tag}`,
  published_at: "2026-07-24T00:00:00Z",
  body: `Notes for ${tag}`,
  draft: false,
  prerelease: false,
});

test("validate-only no-update checks the installed repository without commands", async (t) => {
  try {
    await access(join(rootDir, ".patchmill/skills/patchmill-skill-pack.json"));
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip(
        "project-local managed skills are not included in packaged source",
      );
      return;
    }
    throw error;
  }
  const summary = await runSuperpowersUpgrade(
    ["--mode", "manual", "--superpowers-version", "6.0.3", "--validate-only"],
    {
      rootDir,
      fetchImpl: async () => new Response(JSON.stringify([release("v6.0.3")])),
      runCommand: async () => assert.fail("must not run commands"),
    },
  );
  assert.equal(summary.noUpdate, true);
  assert.equal(summary.currentVersion, "6.0.3");
  assert.deepEqual(summary.changedFiles, []);
  assert.equal(validationCommands[0], "npm ci");
});

test("writes parse failures to the requested summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-superpowers-summary-"));
  const summaryPath = join(dir, "summary.json");
  try {
    await assert.rejects(
      runSuperpowersUpgrade(["--mode", "bad", "--summary-json", summaryPath], {
        rootDir,
      }),
      /--mode must be scheduled or manual/,
    );
    assert.match(
      JSON.parse(await readFile(summaryPath, "utf8")).error,
      /--mode must be scheduled or manual/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
