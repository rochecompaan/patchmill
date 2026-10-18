import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  localPiAgentDir,
  piAgentEnv,
  readLocalPiDefaultModel,
  writeLocalPiDefaultModel,
} from "./pi-agent-settings.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-pi-agent-settings-"));
}

test("localPiAgentDir resolves the repository-local Pi agent directory", async () => {
  const repoRoot = await tempRepo();

  assert.equal(
    localPiAgentDir(repoRoot),
    join(repoRoot, ".patchmill", "pi-agent"),
  );
});

test("piAgentEnv returns the PI_CODING_AGENT_DIR override", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);

  assert.deepEqual(piAgentEnv(agentDir), {
    PI_CODING_AGENT_DIR: agentDir,
  });
});

test("writeLocalPiDefaultModel creates settings.json with provider and model", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);

  await writeLocalPiDefaultModel(agentDir, {
    provider: "openai-codex",
    modelId: "gpt-5.5",
  });

  assert.deepEqual(
    JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")),
    {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    },
  );
});

test("writeLocalPiDefaultModel preserves unrelated settings", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ theme: "dark", defaultThinkingLevel: "high" }, null, 2),
  );

  await writeLocalPiDefaultModel(agentDir, {
    provider: "anthropic",
    modelId: "claude-opus-4-1",
  });

  assert.deepEqual(
    JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")),
    {
      theme: "dark",
      defaultThinkingLevel: "high",
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4-1",
    },
  );
});

test("writeLocalPiDefaultModel rejects invalid JSON without overwriting it", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);
  const settingsPath = join(agentDir, "settings.json");
  await mkdir(agentDir, { recursive: true });
  await writeFile(settingsPath, "{not json", "utf8");

  await assert.rejects(
    writeLocalPiDefaultModel(agentDir, {
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
    }),
    /Could not parse local Pi settings/u,
  );
  assert.equal(await readFile(settingsPath, "utf8"), "{not json");
});

test("readLocalPiDefaultModel returns the persisted provider and model", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4-1",
    }),
  );

  assert.deepEqual(await readLocalPiDefaultModel(agentDir), {
    provider: "anthropic",
    modelId: "claude-opus-4-1",
  });
});
