import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHostProvider, createIssueHostProvider } from "./factory.ts";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import { GitHubGhHostProvider } from "./github-gh.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";

const runner: CommandRunner = {
  async run() {
    return { code: 0, stdout: "", stderr: "" };
  },
};

test("createIssueHostProvider constructs Forgejo tea provider", () => {
  const provider = createIssueHostProvider({
    runner,
    repoRoot: "/repo",
    host: { provider: "forgejo-tea", login: "triage-agent" },
  });

  assert.ok(provider instanceof ForgejoTeaHostProvider);
  assert.equal(provider.id, "forgejo-tea");
});

test("createIssueHostProvider constructs GitHub gh provider", () => {
  const provider = createIssueHostProvider({
    runner,
    repoRoot: "/repo",
    host: { provider: "github-gh", login: "triage-agent" },
  });

  assert.ok(provider instanceof GitHubGhHostProvider);
  assert.equal(provider.id, "github-gh");
});

test("createGitHostProvider exposes generic repository capabilities", () => {
  const provider = createGitHostProvider({
    runner,
    repoRoot: "/repo",
    host: { provider: "github-gh", login: "" },
  });

  assert.equal(typeof provider.repoExists, "function");
  assert.equal(typeof provider.createPublicRepo, "function");
  assert.equal(typeof provider.deleteRepo, "function");
  assert.equal(typeof provider.gitRemoteUrl, "function");
  assert.equal(typeof provider.publicRepoUrl, "function");
  assert.equal(typeof provider.cloneCommand, "function");
  assert.equal(typeof provider.createIssue, "function");
});
