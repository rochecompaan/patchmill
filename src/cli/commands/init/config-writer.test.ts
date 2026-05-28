import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  CONFIG_FILE_NAME,
  buildInitialConfig,
  inferHostProviderFromRemote,
  writeInitialConfig,
} from "./config-writer.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-init-"));
}

test("buildInitialConfig returns minimal default config", () => {
  assert.deepEqual(buildInitialConfig(), {
    host: {
      provider: "forgejo-tea",
      login: "triage-agent",
    },
  });
});

test("buildInitialConfig defaults GitHub host login to empty", () => {
  assert.deepEqual(buildInitialConfig({ provider: "github-gh" }), {
    host: {
      provider: "github-gh",
      login: "",
    },
  });
});

test("inferHostProviderFromRemote recognizes Forgejo-like remotes", () => {
  assert.equal(
    inferHostProviderFromRemote("git@forgejo.example.com:owner/repo.git"),
    "forgejo-tea",
  );
  assert.equal(
    inferHostProviderFromRemote("https://codeberg.org/owner/repo.git"),
    "forgejo-tea",
  );
});

test("inferHostProviderFromRemote recognizes GitHub HTTPS remotes", () => {
  assert.equal(
    inferHostProviderFromRemote(
      "https://github.com/rochecompaan/patchmill.git",
    ),
    "github-gh",
  );
});

test("inferHostProviderFromRemote recognizes GitHub SCP-like remotes", () => {
  assert.equal(
    inferHostProviderFromRemote("git@github.com:rochecompaan/patchmill.git"),
    "github-gh",
  );
});

test("inferHostProviderFromRemote keeps non-GitHub remotes on Forgejo", () => {
  assert.equal(
    inferHostProviderFromRemote("git@git.example.com:owner/repo.git"),
    "forgejo-tea",
  );
});

test("inferHostProviderFromRemote falls back to forgejo-tea for unknown remotes", () => {
  assert.equal(
    inferHostProviderFromRemote("git@example.com:owner/repo.git"),
    "forgejo-tea",
  );
});

test("writeInitialConfig writes pretty minimal JSON", async () => {
  const repoRoot = await tempRepo();
  const result = await writeInitialConfig(repoRoot, {});

  assert.deepEqual(result, {
    status: "created",
    path: join(repoRoot, CONFIG_FILE_NAME),
    config: buildInitialConfig(),
  });
  assert.equal(
    await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8"),
    `${JSON.stringify(buildInitialConfig(), null, 2)}\n`,
  );
});

test("writeInitialConfig refuses to overwrite existing config", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, CONFIG_FILE_NAME), "{}\n");

  const result = await writeInitialConfig(repoRoot, {});

  assert.deepEqual(result, {
    status: "exists",
    path: join(repoRoot, CONFIG_FILE_NAME),
  });
  assert.equal(
    await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8"),
    "{}\n",
  );
});

test("writeInitialConfig reads origin remote from git config when present", async () => {
  const repoRoot = await tempRepo();
  await mkdir(join(repoRoot, ".git"));
  await writeFile(
    join(repoRoot, ".git", "config"),
    `[remote "origin"]\n\turl = git@forgejo.example.com:owner/repo.git\n`,
  );

  const result = await writeInitialConfig(repoRoot, {});

  assert.equal(result.status, "created");
  assert.deepEqual(
    JSON.parse(await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8")),
    buildInitialConfig(),
  );
});
