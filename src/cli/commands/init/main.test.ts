import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, runInit } from "./main.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-init-main-"));
}

test("runInit prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runInit(["--help"], await tempRepo(), {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    }),
    0,
  );
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("runInit creates config and prints next step", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit([], repoRoot, {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    }),
    0,
  );

  assert.match(stdout.join("\n"), /Created patchmill\.config\.json/);
  assert.match(stdout.join("\n"), /provider: forgejo-tea/);
  assert.match(stdout.join("\n"), /patchmill doctor/);
});

test("runInit refuses existing config", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  const stdout: string[] = [];

  assert.equal(
    await runInit([], repoRoot, {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    }),
    1,
  );
  assert.match(stdout.join("\n"), /already exists/);
  assert.match(stdout.join("\n"), /did not overwrite/);
});
