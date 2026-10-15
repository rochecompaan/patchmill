import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingRunner } from "../../test-support/recording-runner.ts";
import { CommandFailedError } from "../process/command.ts";
import { createHostForProvider } from "./factory.ts";
import { GitHubHost } from "./github-gh.ts";

const closed = {
  number: 1,
  url: "https://example/1",
  state: "CLOSED",
  isDraft: false,
  body: "closed",
  headRefName: "agent/issue-3-x",
};
const open = {
  number: 2,
  url: "https://example/2",
  state: "OPEN",
  isDraft: true,
  body: "open",
  headRefName: "agent/issue-3-x",
};

test("findPullRequestByHead prefers the open draft and uses repo cwd", async () => {
  const runner = recordingRunner([
    { match: /gh pr list/, result: { stdout: JSON.stringify([closed, open]) } },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.deepEqual(await host.findPullRequestByHead("agent/issue-3-x"), {
    number: 2,
    url: "https://example/2",
    state: "open",
    draft: true,
    body: "open",
    headBranch: "agent/issue-3-x",
  });
  assert.deepEqual(runner.calls, [
    [
      "gh",
      "pr",
      "list",
      "--head",
      "agent/issue-3-x",
      "--state",
      "all",
      "--limit",
      "20",
      "--json",
      "number,url,state,isDraft,body,headRefName",
    ],
  ]);
  assert.equal(runner.options[0]?.cwd, "/repo");
});

test("findPullRequestByHead ignores other heads and prefers merged to closed", async () => {
  const runner = recordingRunner([
    {
      match: /gh pr list/,
      result: {
        stdout: JSON.stringify([
          closed,
          { ...closed, number: 3, state: "MERGED" },
          { ...open, headRefName: "other" },
        ]),
      },
    },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.deepEqual(await host.findPullRequestByHead("agent/issue-3-x"), {
    number: 3,
    url: "https://example/1",
    state: "merged",
    draft: false,
    body: "closed",
    headBranch: "agent/issue-3-x",
  });
});

test("findPullRequestByHead returns undefined for an empty list", async () => {
  const runner = recordingRunner([
    { match: /gh pr list/, result: { stdout: "[]" } },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.equal(await host.findPullRequestByHead("agent/issue-3-x"), undefined);
});

test("setLabels omits an empty remove list", async () => {
  const runner = recordingRunner([{ match: /gh issue edit/, result: {} }]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  await host.setLabels(3, ["a"], []);
  assert.deepEqual(runner.calls, [
    ["gh", "issue", "edit", "3", "--add-label", "a"],
  ]);
});

test("setLabels makes no call for two empty lists", async () => {
  const runner = recordingRunner([]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  await host.setLabels(3, [], []);
  assert.deepEqual(runner.calls, []);
});

test("viewIssue maps labels, authors, comments, and state", async () => {
  const runner = recordingRunner([
    {
      match: /gh issue view/,
      result: {
        stdout: JSON.stringify({
          number: 3,
          title: "Fix",
          body: "Details",
          labels: [{ name: "bug" }],
          state: "OPEN",
          url: "https://example/3",
          author: { login: "octocat" },
          createdAt: "today",
          comments: [
            { author: { login: "reviewer" }, body: "yes", createdAt: "later" },
          ],
        }),
      },
    },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.deepEqual(await host.viewIssue(3), {
    number: 3,
    title: "Fix",
    body: "Details",
    labels: ["bug"],
    state: "open",
    url: "https://example/3",
    author: "octocat",
    createdAt: "today",
    comments: [{ author: "reviewer", body: "yes", createdAt: "later" }],
  });
  assert.deepEqual(runner.calls, [
    [
      "gh",
      "issue",
      "view",
      "3",
      "--json",
      "number,title,body,labels,state,url,author,createdAt,comments",
    ],
  ]);
});

test("checkCli reports auth failure and stops before user lookup", async () => {
  const runner = recordingRunner([
    { match: /gh --version/, result: {} },
    { match: /gh auth status/, result: { code: 1, stderr: "not logged in\n" } },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.deepEqual(await host.checkCli(), {
    ok: false,
    message: "gh auth status failed: not logged in",
  });
  assert.deepEqual(runner.calls, [
    ["gh", "--version"],
    ["gh", "auth", "status"],
  ]);
});

test("checkCli reports the trimmed authenticated login", async () => {
  const runner = recordingRunner([
    { match: /gh --version/, result: {} },
    { match: /gh auth status/, result: {} },
    { match: /gh api user --jq .login/, result: { stdout: "octocat\n" } },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.deepEqual(await host.checkCli(), {
    ok: true,
    message: "gh authenticated as octocat",
    login: "octocat",
  });
  assert.deepEqual(runner.calls, [
    ["gh", "--version"],
    ["gh", "auth", "status"],
    ["gh", "api", "user", "--jq", ".login"],
  ]);
});

test("commentIssue sends the body through stdin", async () => {
  const runner = recordingRunner([{ match: /gh issue comment/, result: {} }]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  await host.commentIssue(3, "hello");
  assert.deepEqual(runner.calls, [
    ["gh", "issue", "comment", "3", "--body-file", "-"],
  ]);
  assert.deepEqual(runner.options, [{ cwd: "/repo", stdin: "hello" }]);
});

test("listOpenIssues throws CommandFailedError for gh failure", async () => {
  const runner = recordingRunner([
    {
      match: /gh issue list/,
      result: { code: 1, stderr: "permission denied" },
    },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  await assert.rejects(host.listOpenIssues(), (error) => {
    assert.ok(error instanceof CommandFailedError);
    assert.match(error.message, /gh issue list/);
    assert.match(error.message, /permission denied/);
    return true;
  });
  assert.deepEqual(runner.calls, [
    [
      "gh",
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,body,labels,state,url,author,createdAt",
    ],
  ]);
});

test("repository maps owner, name, and default branch", async () => {
  const runner = recordingRunner([
    {
      match: /gh repo view/,
      result: {
        stdout: JSON.stringify({
          nameWithOwner: "o/r",
          defaultBranchRef: { name: "main" },
        }),
      },
    },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.deepEqual(await host.repository(), {
    owner: "o",
    repo: "r",
    defaultBranch: "main",
  });
  assert.deepEqual(runner.calls, [
    ["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
  ]);
});

test("setup repository lookup distinguishes absence and maps URLs; labels strip hash", async () => {
  const runner = recordingRunner([
    {
      match: /gh repo view o\/missing/,
      result: { code: 1, stderr: "Could not resolve to a Repository" },
    },
    {
      match: /gh repo view o\/r/,
      result: {
        stdout: JSON.stringify({
          url: "https://github.com/o/r",
          sshUrl: "git@github.com:o/r.git",
        }),
      },
    },
    { match: /gh label create/, result: {} },
  ]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.equal(
    await host.getRepository({
      owner: "o",
      repo: "missing",
      slug: "o/missing",
    }),
    undefined,
  );
  const target = { owner: "o", repo: "r", slug: "o/r" };
  assert.deepEqual(await host.getRepository(target), {
    publicUrl: "https://github.com/o/r",
    gitRemoteUrl: "git@github.com:o/r.git",
  });
  await host.createLabel(target, {
    name: "bug",
    color: "#0e8a16",
    description: "A bug",
  });
  assert.deepEqual(runner.calls, [
    ["gh", "repo", "view", "o/missing", "--json", "url,sshUrl"],
    ["gh", "repo", "view", "o/r", "--json", "url,sshUrl"],
    [
      "gh",
      "label",
      "create",
      "bug",
      "--color",
      "0e8a16",
      "--description",
      "A bug",
      "--repo",
      "o/r",
    ],
  ]);
});

test("recordingRunner reuses responses with global regexes", async () => {
  const runner = recordingRunner([
    { match: /gh --version/g, result: { stdout: "gh version 2\n" } },
  ]);
  for (let i = 0; i < 3; i++) {
    assert.equal((await runner("gh", ["--version"])).stdout, "gh version 2\n");
  }
});

test("factory selects GitHub and rejects the unsupported Forgejo provider", () => {
  const runner = recordingRunner([]);
  const host = new GitHubHost({ runner, repoRoot: "/repo" });
  assert.ok(
    createHostForProvider("github-gh", "octocat", runner, "/repo") instanceof
      host.constructor,
  );
  assert.throws(
    () => createHostForProvider("forgejo-tea", "octocat", runner, "/repo"),
    { message: "Unsupported host provider: forgejo-tea" },
  );
});
