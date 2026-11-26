import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCommand } from "../../../process/command.ts";

import * as agent from "./agent-dir.ts";

test("provisions the reviewer without rewriting unchanged files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-agent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await agent.provisionAgentDir(root, "custom/agent", null);
  const file = join(root, "custom/agent/agents/reviewer.md");
  assert.equal(await readFile(file, "utf8"), agent.reviewerAgent(null));
  const before = (await stat(file)).mtimeMs;
  await agent.provisionAgentDir(root, "custom/agent", null);
  assert.equal((await stat(file)).mtimeMs, before);
  await writeFile(file, "damaged");
  await agent.provisionAgentDir(root, "custom/agent", null);
  assert.equal(await readFile(file, "utf8"), agent.reviewerAgent(null));
});

test("provisionReviewerAgent writes only the reviewer and reports changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-reviewer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "custom/agent/agents/reviewer.md");
  assert.equal(
    await agent.provisionReviewerAgent(root, "custom/agent", null),
    "written",
  );
  assert.equal(await readFile(file, "utf8"), agent.reviewerAgent(null));
  await assert.rejects(
    stat(join(root, "custom/agent/agents/patchmill-implementation.md")),
  );
  const before = (await stat(file)).mtimeMs;
  assert.equal(
    await agent.provisionReviewerAgent(root, "custom/agent", null),
    "unchanged",
  );
  assert.equal((await stat(file)).mtimeMs, before);
  await writeFile(file, "damaged");
  assert.equal(
    await agent.provisionReviewerAgent(root, "custom/agent", null),
    "written",
  );
  assert.equal(await readFile(file, "utf8"), agent.reviewerAgent(null));
});

test("appends missing excludes through Git common metadata in a linked checkout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-excludes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function git(args: string[]) {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.code, 0, result.stderr);
  }
  await git(["init"]);
  // Emulate Git's linked-worktree metadata without creating another worktree.
  const metadata = join(root, ".git/worktrees/linked");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(metadata, { recursive: true });
  const linked = join(root, "linked");
  await mkdir(linked);
  await writeFile(join(linked, ".git"), `gitdir: ${metadata}\n`);
  await writeFile(join(metadata, "commondir"), "../..\n");
  await writeFile(join(metadata, "HEAD"), "ref: refs/heads/linked\n");
  const exclude = join(root, ".git/info/exclude");
  await writeFile(exclude, "# keep\n.worktrees/\ncustom-without-newline");
  assert.deepEqual(
    await agent.ensureLocalExcludes(linked, [".worktrees/", "agent/", "runs/"]),
    ["agent/", "runs/"],
  );
  assert.equal(
    await readFile(exclude, "utf8"),
    "# keep\n.worktrees/\ncustom-without-newline\nagent/\nruns/\n",
  );
  const before = (await stat(exclude)).mtimeMs;
  assert.deepEqual(
    await agent.ensureLocalExcludes(linked, ["agent/", "runs/"]),
    [],
  );
  assert.equal((await stat(exclude)).mtimeMs, before);
  const plain = await mkdtemp(join(tmpdir(), "patchmill-no-git-"));
  t.after(() => rm(plain, { recursive: true, force: true }));
  await assert.rejects(agent.ensureLocalExcludes(plain, ["runs/"]));
  await assert.rejects(stat(join(plain, ".git")));
});

test("provisioning writes and repairs the implementation worker without rewriting it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "agent/agents/patchmill-implementation.md");
  await agent.provisionAgentDir(root, "agent", null);
  const content = await readFile(file, "utf8");
  assert.match(content, /name: patchmill-implementation/);
  const tools =
    /^tools: read, grep, find, ls, bash, edit, write, subagent, bg_wait, subagent_supervisor$/m;
  assert.match(content, tools);
  const skills = join(root, "skills");
  await mkdir(skills);
  await agent.provisionAgentDir(root, "skilled", null, [skills]);
  const skilled = await readFile(
    join(root, "skilled/agents/patchmill-implementation.md"),
    "utf8",
  );
  assert.match(skilled, /^skillPath: /m);
  assert.match(skilled, tools);
  const before = (await stat(file)).mtimeMs;
  await agent.provisionAgentDir(root, "agent", null);
  assert.equal((await stat(file)).mtimeMs, before);
  await writeFile(file, "damaged");
  await agent.provisionAgentDir(root, "agent", null);
  assert.equal(await readFile(file, "utf8"), content);
});

test("provisionAgentDir writes the subagent limits", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-limits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await agent.provisionAgentDir(root, "agent", 120);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(root, "agent/extensions/subagent/config.json"),
        "utf8",
      ),
    ),
    { timeoutMs: 7_200_000, checkpointBeforeDeadlineMs: 300_000 },
  );
});

test("managed agents carry the subagent deadline", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-deadline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = ["reviewer.md", "patchmill-implementation.md"].map((name) =>
    join(root, "agent/agents", name),
  );
  await agent.provisionAgentDir(root, "agent", null);
  for (const file of files)
    assert.match(await readFile(file, "utf8"), /^timeoutMs: 2147483647$/m);
  await agent.provisionAgentDir(root, "agent", 120);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.match(content, /^timeoutMs: 7200000$/m);
    assert.doesNotMatch(content, /2147483647/);
  }
});
