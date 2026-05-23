import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";
import { loadPatchmillConfig } from "./load.ts";

test("loadPatchmillConfig returns defaults when no file or env is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "triage-agent");
  assert.equal(config.paths.runStateDir, join(dir, ".patchmill/runs"));
});

test("loadPatchmillConfig clones default arrays for each load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const first = await loadPatchmillConfig(dir, {}, []);
  const second = await loadPatchmillConfig(dir, {}, []);

  assert.notStrictEqual(first.labels.priorities, DEFAULT_PATCHMILL_CONFIG.labels.priorities);
  assert.notStrictEqual(first.labels.priorities, second.labels.priorities);
  assert.notStrictEqual(first.projectPolicy.validationCommands, DEFAULT_PATCHMILL_CONFIG.projectPolicy.validationCommands);
  assert.notStrictEqual(first.projectPolicy.validationCommands, second.projectPolicy.validationCommands);

  first.labels.priorities.push("priority:urgent");
  first.projectPolicy.validationCommands.push("npm test");

  assert.deepEqual(second.labels.priorities, DEFAULT_PATCHMILL_CONFIG.labels.priorities);
  assert.deepEqual(second.projectPolicy.validationCommands, DEFAULT_PATCHMILL_CONFIG.projectPolicy.validationCommands);
});

test("loadPatchmillConfig applies patchmill.config.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    host: { login: "bot-login" },
    pi: { team: "fast-team" },
    paths: { plansDir: "engineering/plans" }
  }));
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "bot-login");
  assert.equal(config.pi.team, "fast-team");
  assert.equal(config.paths.plansDir, join(dir, "engineering/plans"));
});

test("loadPatchmillConfig applies env overrides without CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    host: { login: "file-login" },
    pi: { team: "file-team" }
  }));
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login", PATCHMILL_AGENT_TEAM: "env-team" },
    []
  );
  assert.equal(config.host.login, "env-login");
  assert.equal(config.pi.team, "env-team");
});

test("loadPatchmillConfig applies CLI overrides last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login", PATCHMILL_AGENT_TEAM: "env-team" },
    ["--host-login", "cli-login", "--agent-team", "cli-team"]
  );
  assert.equal(config.host.login, "cli-login");
  assert.equal(config.pi.team, "cli-team");
});

test("loadPatchmillConfig absolutizes paths from a relative repo root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    paths: { worktreeDir: "custom/../trees" }
  }));
  const relativeRoot = relative(process.cwd(), dir);
  const config = await loadPatchmillConfig(relativeRoot, {}, []);
  assert.equal(config.paths.runStateDir, resolve(relativeRoot, ".patchmill/runs"));
  assert.equal(config.paths.worktreeDir, resolve(relativeRoot, "custom/../trees"));
});

test("loadPatchmillConfig reports invalid config field types", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    paths: { plansDir: null }
  }));

  await assert.rejects(
    loadPatchmillConfig(dir, {}, []),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "Error");
      assert.match(error.message, /Invalid patchmill\.config\.json: paths\.plansDir must be a string; received null/);
      return true;
    }
  );
});
