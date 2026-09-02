import type { CommandRunner } from "../command/types.ts";
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

test("createPullRequestHost passes the GitHub push remote to observable discovery commands", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const host = createPullRequestHost({
    runner: {
      async run(command, args) {
        calls.push({ command, args });
        if (command === "git")
          return {
            code: 0,
            stdout: "https://github.com/acme/patchmill.git\n",
            stderr: "",
          };
        if (args[0] === "pr") return { code: 0, stdout: "[]", stderr: "" };
        return {
          code: 0,
          stdout: JSON.stringify({
            nameWithOwner: "acme/patchmill",
            url: "https://github.com/acme/patchmill",
          }),
          stderr: "",
        };
      },
    },
    repoRoot: "/repo",
    remote: "upstream",
    host: { provider: "github-gh", login: "ignored" },
  });
  assert.ok(host instanceof GitHubGhPullRequestHost);
  await host.findPullRequests({
    targetRepository: {
      provider: "github-gh",
      host: "github.com",
      owner: "acme",
      repository: "patchmill",
    },
    baseBranch: "main",
    headRepository: {
      provider: "github-gh",
      host: "github.com",
      owner: "acme",
      repository: "patchmill",
    },
    headBranch: "planning/spec",
  });
  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "git" &&
        args.join(" ") === "remote get-url --push --all -- upstream",
    ),
  );
});

test("createPullRequestHost passes Forgejo push remote and login to observable discovery commands", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const host = createPullRequestHost({
    runner: {
      async run(command, args) {
        calls.push({ command, args });
        if (command === "git")
          return {
            code: 0,
            stdout: "https://forge.example/contributor/widgets.git\n",
            stderr: "",
          };
        if (args.some((value) => value.includes("pulls?state=all")))
          return { code: 0, stdout: "[]", stderr: "" };
        return {
          code: 0,
          stdout: JSON.stringify({
            name: "widgets",
            full_name: "platform/widgets",
            owner: { login: "platform" },
            html_url: "https://forge.example/platform/widgets",
          }),
          stderr: "",
        };
      },
    },
    repoRoot: "/repo",
    remote: "fork",
    host: { provider: "forgejo-tea", login: "planning-agent" },
  });
  assert.ok(host instanceof ForgejoTeaPullRequestHost);
  await host.findPullRequests({
    targetRepository: {
      provider: "forgejo-tea",
      host: "forge.example",
      owner: "platform",
      repository: "widgets",
    },
    baseBranch: "main",
    headRepository: {
      provider: "forgejo-tea",
      host: "forge.example",
      owner: "platform",
      repository: "widgets",
    },
    headBranch: "planning/spec",
  });
  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "git" &&
        args.join(" ") === "remote get-url --push --all -- fork",
    ),
  );
  assert.ok(
    calls
      .filter(({ command }) => command === "tea")
      .every(({ args }) => args.includes("planning-agent")),
  );
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
