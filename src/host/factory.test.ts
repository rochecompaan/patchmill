import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIssueHostProvider,
  createPullRequestHost,
  createRepositorySetupHostProvider,
} from "./factory.ts";
import { ForgejoTeaPullRequestHost } from "./forgejo-tea-pull-requests.ts";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import { GitHubGhPullRequestHost } from "./github-gh-pull-requests.ts";
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

test("createPullRequestHost constructs provider-specific planning adapters", () => {
  const github = createPullRequestHost({
    runner,
    repoRoot: "/repo",
    remote: "upstream",
    host: { provider: "github-gh", login: "ignored" },
  });
  const forgejo = createPullRequestHost({
    runner,
    repoRoot: "/repo",
    remote: "fork",
    host: { provider: "forgejo-tea", login: "planning-agent" },
  });
  assert.ok(github instanceof GitHubGhPullRequestHost);
  assert.equal(github.id, "github-gh");
  assert.ok(forgejo instanceof ForgejoTeaPullRequestHost);
  assert.equal(forgejo.id, "forgejo-tea");
});

test("createRepositorySetupHostProvider exposes setup repository capabilities", () => {
  const provider = createRepositorySetupHostProvider({
    runner,
    repoRoot: "/repo",
    host: { provider: "github-gh", login: "" },
  });

  assert.equal(typeof provider.getRepository, "function");
  assert.equal(typeof provider.createPublicRepo, "function");
  assert.equal(typeof provider.deleteRepo, "function");
  assert.equal(typeof provider.cloneCommand, "function");
  assert.equal(typeof provider.listLabels, "function");
  assert.equal(typeof provider.createLabel, "function");
  assert.equal(typeof provider.createIssue, "function");
});
