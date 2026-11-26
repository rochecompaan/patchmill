import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { runCommand } from "../../../process/command.ts";
import { provisionReviewerAgent, reviewerAgent } from "../init/agent-dir.ts";
import { checkReviewerRole } from "./reviewer-role.ts";

const agentDir = "custom/agent";
const SHADOW = "---\nname: reviewer\ndescription: x\ntools: read\n---\nhi\n";

function restoreEnv(t: TestContext, key: string) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const earlier = process.env[key];
  t.after(() => {
    if (had) process.env[key] = earlier;
    else delete process.env[key];
  });
}

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), "patchmill-reviewer-role-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const home = join(base, "home");
  await mkdir(root);
  await mkdir(home);
  const git = await runCommand("git", ["init", "-q"], { cwd: root });
  assert.equal(git.code, 0, git.stderr);
  restoreEnv(t, "HOME");
  process.env.HOME = home;
  const managed = join(root, agentDir, "agents/reviewer.md");
  return { base, root, home, managed };
}

const check = (repoRoot: string, timeoutMinutes: number | null = null) =>
  checkReviewerRole({ repoRoot, agentDir, timeoutMinutes });

async function settings(root: string, content: string) {
  await writeFile(join(root, agentDir, "settings.json"), content);
}

test("passes for the provisioned reviewer", async (t) => {
  const f = await fixture(t);
  await provisionReviewerAgent(f.root, agentDir, null);
  assert.deepEqual(await check(f.root), { ok: true });
});

test("passes through a symlinked repository path", async (t) => {
  const f = await fixture(t);
  await provisionReviewerAgent(f.root, agentDir, null);
  const link = join(f.base, "link");
  await symlink(f.root, link);
  assert.deepEqual(await check(link), { ok: true });
});

test("missing is repairable", async (t) => {
  const f = await fixture(t);
  const result = await check(f.root);
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.repairable, true);
  assert.match(
    result.message,
    /Missing reviewer: .*custom\/agent\/agents\/reviewer\.md.*--fix/,
  );
});

test("stale is repairable", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, agentDir, "agents"), { recursive: true });
  await writeFile(f.managed, `${reviewerAgent(null)}\n`);
  const result = await check(f.root);
  assert.ok(!result.ok);
  assert.equal(result.repairable, true);
  assert.match(result.message, /Stale reviewer/);
});

test("a project definition shadows the managed reviewer", async (t) => {
  const f = await fixture(t);
  await provisionReviewerAgent(f.root, agentDir, null);
  const shadow = join(f.root, ".pi/agents/reviewer.md");
  await mkdir(join(f.root, ".pi/agents"), { recursive: true });
  await writeFile(shadow, SHADOW);
  const result = await check(f.root);
  assert.ok(!result.ok);
  assert.equal(result.repairable, false);
  assert.ok(result.message.includes(shadow), result.message);
  assert.match(result.message, /project/);
  await stat(shadow);
});

test("a home definition shadows the managed reviewer", async (t) => {
  const f = await fixture(t);
  await provisionReviewerAgent(f.root, agentDir, null);
  const shadow = join(f.home, ".agents/reviewer.md");
  await mkdir(join(f.home, ".agents"), { recursive: true });
  await writeFile(shadow, SHADOW);
  const result = await check(f.root);
  assert.ok(!result.ok);
  assert.equal(result.repairable, false);
  assert.ok(result.message.includes(shadow), result.message);
});

test("an agentOverrides tools entry fails the tools check", async (t) => {
  const f = await fixture(t);
  await provisionReviewerAgent(f.root, agentDir, null);
  await settings(
    f.root,
    JSON.stringify({
      subagents: { agentOverrides: { reviewer: { tools: ["read"] } } },
    }),
  );
  const result = await check(f.root);
  assert.ok(!result.ok);
  assert.equal(result.repairable, false);
  assert.match(result.message, /effective tools: read(,|$)/);
});

test("a disabled reviewer is not resolved", async (t) => {
  const f = await fixture(t);
  await provisionReviewerAgent(f.root, agentDir, null);
  await settings(
    f.root,
    JSON.stringify({
      subagents: { agentOverrides: { reviewer: { disabled: true } } },
    }),
  );
  const result = await check(f.root);
  assert.ok(!result.ok);
  assert.equal(result.repairable, false);
  assert.match(result.message, /missing_agent/);
});

test("restores PI_CODING_AGENT_DIR", async (t) => {
  const f = await fixture(t);
  restoreEnv(t, "PI_CODING_AGENT_DIR");
  process.env.PI_CODING_AGENT_DIR = "/earlier";
  await provisionReviewerAgent(f.root, agentDir, null);
  assert.deepEqual(await check(f.root), { ok: true });
  assert.equal(process.env.PI_CODING_AGENT_DIR, "/earlier");
  await settings(f.root, "{");
  await assert.rejects(check(f.root));
  assert.equal(process.env.PI_CODING_AGENT_DIR, "/earlier");
});

test("a reviewer written for another cap is stale", async (t) => {
  const f = await fixture(t);
  await provisionReviewerAgent(f.root, agentDir, 120);
  const result = await check(f.root, null);
  assert.ok(!result.ok);
  assert.equal(result.repairable, true);
  assert.match(result.message, /Stale reviewer/);
});
