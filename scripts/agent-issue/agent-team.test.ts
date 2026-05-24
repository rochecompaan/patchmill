import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentTeam } from "./agent-team.ts";

async function repoRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "agent-team-repo-"));
}

async function writeProjectTeam(
  root: string,
  name: string,
  body: unknown,
): Promise<string> {
  const dir = join(root, ".pi", "agent-teams");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  await writeFile(path, JSON.stringify(body), "utf8");
  return path;
}

async function writeGlobalTeam(
  home: string,
  name: string,
  body: unknown,
): Promise<string> {
  const dir = join(home, ".pi", "agent", "agent-teams");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  await writeFile(path, JSON.stringify(body), "utf8");
  return path;
}

const validTeam = (workerModel = "openai-codex/gpt-5.4") => ({
  name: "economy",
  agents: {
    worker: { model: workerModel, thinking: "medium" },
    reviewer: { model: "openai-codex/gpt-5.5", thinking: "high" },
  },
});

test("resolveAgentTeam loads worker and reviewer roles from a project-local team file", async () => {
  const root = await repoRoot();
  const path = await writeProjectTeam(root, "economy", {
    name: "economy",
    agents: {
      worker: { model: "openai-codex/gpt-5.4", thinking: "medium" },
      reviewer: { model: "openai-codex/gpt-5.5", thinking: "high" },
      scout: { model: "openai-codex/gpt-5.4-mini", thinking: "low" },
    },
  });

  const team = await resolveAgentTeam(root, "economy");

  assert.deepEqual(team, {
    name: "economy",
    path,
    roles: {
      worker: { model: "openai-codex/gpt-5.4", thinking: "medium" },
      reviewer: { model: "openai-codex/gpt-5.5", thinking: "high" },
    },
  });
});

test("resolveAgentTeam loads a global team when no project-local team exists", async () => {
  const root = await repoRoot();
  const home = await mkdtemp(join(tmpdir(), "agent-team-home-"));
  const path = await writeGlobalTeam(home, "economy", validTeam());

  const team = await resolveAgentTeam(root, "economy", home);

  assert.equal(team.path, path);
  assert.equal(team.roles.worker.model, "openai-codex/gpt-5.4");
});

test("resolveAgentTeam prefers a project-local team over a global team", async () => {
  const root = await repoRoot();
  const home = await mkdtemp(join(tmpdir(), "agent-team-home-"));
  const projectPath = await writeProjectTeam(
    root,
    "economy",
    validTeam("openai-codex/gpt-5.4-project"),
  );
  await writeGlobalTeam(
    home,
    "economy",
    validTeam("openai-codex/gpt-5.4-global"),
  );

  const team = await resolveAgentTeam(root, "economy", home);

  assert.equal(team.path, projectPath);
  assert.equal(team.roles.worker.model, "openai-codex/gpt-5.4-project");
});

test("resolveAgentTeam rejects unsafe team names before reading files", async () => {
  const root = await repoRoot();

  await assert.rejects(
    () => resolveAgentTeam(root, "../economy"),
    /Agent team name must use only letters, numbers, dots, underscores, and hyphens/,
  );
});

test("resolveAgentTeam rejects missing team files with searched paths", async () => {
  const root = await repoRoot();
  const home = await mkdtemp(join(tmpdir(), "agent-team-home-"));

  await assert.rejects(
    () => resolveAgentTeam(root, "missing", home),
    /Agent team missing not found.*\.pi\/agent-teams\/missing\.json.*\.pi\/agent\/agent-teams\/missing\.json/s,
  );
});

test("resolveAgentTeam rejects malformed JSON", async () => {
  const root = await repoRoot();
  const dir = join(root, ".pi", "agent-teams");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "broken.json"), "{ nope", "utf8");

  await assert.rejects(
    () => resolveAgentTeam(root, "broken"),
    /Agent team broken contains invalid JSON/,
  );
});

test("resolveAgentTeam rejects missing required roles", async () => {
  const root = await repoRoot();
  await writeProjectTeam(root, "incomplete", {
    name: "incomplete",
    agents: {
      worker: { model: "openai-codex/gpt-5.4", thinking: "medium" },
    },
  });

  await assert.rejects(
    () => resolveAgentTeam(root, "incomplete"),
    /Agent team incomplete is missing required reviewer role/,
  );
});

test("resolveAgentTeam rejects roles without model strings", async () => {
  const root = await repoRoot();
  await writeProjectTeam(root, "bad-role", {
    name: "bad-role",
    agents: {
      worker: { thinking: "medium" },
      reviewer: { model: "openai-codex/gpt-5.5", thinking: "high" },
    },
  });

  await assert.rejects(
    () => resolveAgentTeam(root, "bad-role"),
    /Agent team bad-role has invalid worker model/,
  );
});
