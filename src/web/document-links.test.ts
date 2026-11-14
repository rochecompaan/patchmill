import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { runCommand } from "../process/command.ts";
import { readDocumentLinks } from "./document-links.ts";

test("document links use existing trees, immutable commits, custom paths, and provider URL shapes", async (t) => {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-board-git-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  const config = structuredClone(DEFAULT_CONFIG);
  config.paths.specsDir = "custom specs";
  await fs.mkdir(join(repoRoot, "custom specs"));
  const path = "custom specs/2026-11-01-issue-9-old-title-design.md";
  await fs.writeFile(join(repoRoot, path), "base");
  git("add", ".");
  git("commit", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", base);
  git("checkout", "-b", "agent/issue-9-new-title");
  await fs.writeFile(join(repoRoot, path), "branch");
  git("commit", "-am", "Issue");
  const head = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/agent/issue-9-new-title", head);
  const commands: string[][] = [];
  const options = {
    repoRoot,
    config,
    issue: 9,
    branches: ["missing", "agent/issue-9-new-title"],
    baseBranch: "main",
    repositoryUrl: "https://host/fork/repo",
    provider: "github-gh" as const,
    runner: ((cmd, args, opts) => {
      commands.push([cmd, ...args]);
      return runCommand(cmd, args, opts);
    }) as typeof runCommand,
  };
  assert.deepEqual(await readDocumentLinks(options), [
    {
      kind: "spec",
      url: `https://host/fork/repo/blob/${head}/custom%20specs/2026-11-01-issue-9-old-title-design.md`,
    },
  ]);
  assert.deepEqual(
    await readDocumentLinks({
      ...options,
      branches: [],
      provider: "forgejo-tea",
    }),
    [
      {
        kind: "spec",
        url: `https://host/fork/repo/src/commit/${base}/custom%20specs/2026-11-01-issue-9-old-title-design.md`,
      },
    ],
  );
  assert.deepEqual(await readDocumentLinks({ ...options, issue: 10 }), []);
  assert.ok(
    commands.every(
      (cmd) =>
        !cmd.some((arg) => ["fetch", "checkout", "worktree"].includes(arg)),
    ),
  );
  config.paths.specsDir = "../private";
  await assert.rejects(readDocumentLinks(options));
});
