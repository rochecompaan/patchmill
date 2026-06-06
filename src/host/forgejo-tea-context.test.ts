import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withTeaContext } from "./forgejo-tea-context.ts";

async function gitRepoWithOrigin(remoteUrl: string): Promise<string> {
  const repoRoot = join(
    tmpdir(),
    `patchmill-tea-context-${Date.now()}-${Math.random()}`,
  );
  await mkdir(join(repoRoot, ".git"), { recursive: true });
  await writeFile(
    join(repoRoot, ".git", "config"),
    `[remote "origin"]\n\turl = ${remoteUrl}\n`,
  );
  return repoRoot;
}

test("withTeaContext adds repo from origin remote", async () => {
  const repoRoot = await gitRepoWithOrigin("git@example.test:OWNER/REPO.git");

  assert.deepEqual(withTeaContext(["issues", "list"], repoRoot), [
    "issues",
    "list",
    "--repo",
    "OWNER/REPO",
  ]);

  await rm(repoRoot, { recursive: true, force: true });
});

test("withTeaContext adds login before -- body separator", async () => {
  const repoRoot = await gitRepoWithOrigin(
    "https://forgejo.example/OWNER/REPO.git",
  );

  assert.deepEqual(
    withTeaContext(["comment", "1", "--", "hello"], repoRoot, "demo"),
    ["comment", "1", "--repo", "OWNER/REPO", "--login", "demo", "--", "hello"],
  );

  await rm(repoRoot, { recursive: true, force: true });
});
