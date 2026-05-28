import assert from "node:assert/strict";
import { test } from "node:test";
import { createIssueHostProvider } from "./factory.ts";
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
