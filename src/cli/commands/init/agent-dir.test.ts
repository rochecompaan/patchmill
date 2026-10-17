import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCommand } from "../../../process/command.ts";

import * as agent from "./agent-dir.ts";

test("provisions the reviewer without rewriting unchanged files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-agent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await agent.provisionAgentDir(root, "custom/agent");
  const file = join(root, "custom/agent/agents/reviewer.md");
  assert.equal(await readFile(file, "utf8"), agent.REVIEWER_AGENT);
  const before = (await stat(file)).mtimeMs;
  await agent.provisionAgentDir(root, "custom/agent");
  assert.equal((await stat(file)).mtimeMs, before);
  await writeFile(file, "damaged");
  await agent.provisionAgentDir(root, "custom/agent");
  assert.equal(await readFile(file, "utf8"), agent.REVIEWER_AGENT);
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
