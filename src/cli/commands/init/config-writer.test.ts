import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  CONFIG_FILE_NAME,
  buildInitialConfig,
  configFileExists,
  inferHostProviderFromRemote,
  writeInitialConfig,
} from "./config-writer.ts";

const PROJECT_LOCAL_SKILLS = {
  triage: ".patchmill/skills/patchmill-issue-triage",
  planning: ".patchmill/skills/writing-plans",
  implementation: ".patchmill/skills/subagent-driven-development",
  visualEvidence: ".patchmill/skills/patchmill-visual-evidence",
};

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

test("buildInitialConfig includes provided skills", () => {
  assert.deepEqual(buildInitialConfig({ skills: PROJECT_LOCAL_SKILLS }), {
    host: {
      provider: "forgejo-tea",
      login: "triage-agent",
    },
    skills: PROJECT_LOCAL_SKILLS,
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

test("writeInitialConfig writes selected skills", async () => {
  const repoRoot = await tempRepo();
  const result = await writeInitialConfig(repoRoot, {
    skills: PROJECT_LOCAL_SKILLS,
  });

  const expectedConfig = buildInitialConfig({ skills: PROJECT_LOCAL_SKILLS });

  assert.deepEqual(result, {
    status: "created",
    path: join(repoRoot, CONFIG_FILE_NAME),
    config: expectedConfig,
  });
  assert.equal(
    await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8"),
    `${JSON.stringify(expectedConfig, null, 2)}\n`,
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

test("configFileExists reports whether patchmill config is present", async () => {
  const repoRoot = await tempRepo();

  assert.equal(await configFileExists(repoRoot), false);

  await writeFile(join(repoRoot, CONFIG_FILE_NAME), "{}\n");

  assert.equal(await configFileExists(repoRoot), true);
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
