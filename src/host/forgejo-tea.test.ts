import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { recordingRunner } from "../../test-support/recording-runner.ts";
import { CommandFailedError } from "../process/command.ts";
import { createHostForProvider } from "./factory.ts";
import { ForgejoHost } from "./forgejo-tea.ts";

const target = { owner: "owner", repo: "repo", slug: "owner/repo" };
const label = { name: "bug", color: "ff0000", description: "Broken" };
const rawIssue = {
  number: 3,
  title: "Fix",
  body: "Details",
  labels: [{ name: "bug" }],
  state: "open",
  html_url: "https://host/3",
  user: { login: "author" },
  created_at: "today",
};
function fixture(
  stdout = "[]",
  login = "name",
  origin = "git@host:owner/repo.git",
) {
  const runner = recordingRunner([
    { match: /^git remote get-url origin$/, result: { stdout: origin } },
    { match: /^tea /, result: { stdout } },
  ]);
  return {
    runner,
    host: new ForgejoHost({ runner, repoRoot: "/repo", login }),
  };
}

test("clone guidance preserves the no-login command", () => {
  assert.equal(
    fixture("[]", "").host.cloneCommand(target),
    "tea clone owner/repo",
  );
});

for (const login of [
  "selected",
  'team\'s sandbox; $(printf injected)\n"quoted"\\path',
]) {
  test(`clone guidance selects the named login safely through a shell: ${JSON.stringify(login)}`, () => {
    const command = fixture("[]", login).host.cloneCommand(target);
    // Capture shell-parsed argv locally, without ever invoking the tea binary.
    const output = execFileSync(
      "/bin/sh",
      ["-c", `tea() { printf '%s\\000' "$@"; }\n${command}`],
      { encoding: "utf8" },
    );
    assert.deepEqual(output.split("\0").slice(0, -1), [
      "clone",
      "--login",
      login,
      "owner/repo",
    ]);
  });
}

test("factory constructs Forgejo", () => {
  assert.ok(
    createHostForProvider(
      "forgejo-tea",
      "name",
      recordingRunner([]),
      "/repo",
    ) instanceof ForgejoHost,
  );
});

for (const login of ["name", ""]) {
  test(`repository operations carry repo context and login ${JSON.stringify(login)}`, async () => {
    const { runner, host } = fixture("[]", login);
    await host.listOpenIssues();
    await host.listLabels();
    await host.createLabel(label);
    await host.commentIssue(3, "hello");
    await host.setLabels(3, ["bug"], ["old"]);
    await host.findPullRequestByHead("topic");
    for (const [i, call] of runner.calls.entries()) {
      assert.equal(runner.options[i]?.cwd, "/repo");
      if (call[0] !== "tea") continue;
      assert.deepEqual(
        call.slice(call.indexOf("--repo"), call.indexOf("--repo") + 2),
        ["--repo", "owner/repo"],
      );
      assert.equal(call.includes("--login"), Boolean(login));
      if (login)
        assert.deepEqual(
          call.slice(call.indexOf("--login"), call.indexOf("--login") + 2),
          ["--login", "name"],
        );
    }
    const edits = runner.calls.filter(
      (c) => c[1] === "issues" && c[2] === "edit",
    );
    assert.equal(edits.length, 2);
    assert.ok(edits[0]?.includes("--remove-labels"));
    assert.ok(!edits[0]?.includes("--add-labels"));
    assert.ok(edits[1]?.includes("--add-labels"));
    assert.ok(!edits[1]?.includes("--remove-labels"));
    assert.ok(
      runner.calls.some(
        (c) =>
          c[1] === "comment" &&
          c[2] === "3" &&
          c.slice(-2).join(" ") === "-- hello",
      ),
    );
  });
}

test("empty label edits do not even look up origin", async () => {
  const { host, runner } = fixture();
  await host.setLabels(3, [], []);
  assert.deepEqual(runner.calls, []);
});

for (const origin of [
  "https://host/owner/repo.git",
  "ssh://git@host/owner/repo.git",
  "git@host:owner/repo.git",
]) {
  test(`repository resolves ${origin}`, async () => {
    const { host } = fixture('{"default_branch":"main"}', "", origin);
    assert.deepEqual(await host.repository(), {
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
    });
  });
}
for (const origin of [
  "/tmp/repo",
  "https://host/a/b/c",
  "https://host/only",
  "nonsense",
]) {
  test(`invalid origin fails clearly: ${origin}`, async () => {
    await assert.rejects(
      fixture("[]", "", origin).host.repository(),
      /origin.*owner\/repo/i,
    );
  });
}

test("issues exclude PRs and map API fields", async () => {
  const { host } = fixture(
    JSON.stringify([rawIssue, { ...rawIssue, pull_request: {} }]),
  );
  assert.deepEqual(await host.listOpenIssues(), [
    {
      number: 3,
      title: "Fix",
      body: "Details",
      labels: ["bug"],
      state: "open",
      url: "https://host/3",
      author: "author",
      createdAt: "today",
      comments: [],
    },
  ]);
});

test("viewIssue preserves all comment pages", async () => {
  const comment = {
    user: { login: "reviewer" },
    body: "yes",
    created_at: "later",
  };
  const runner = recordingRunner([
    { match: /^git /, result: { stdout: "git@host:owner/repo.git" } },
    {
      match: /comments\?page=1&limit=50/,
      result: {
        stdout: JSON.stringify(Array.from({ length: 50 }, () => comment)),
      },
    },
    {
      match: /comments\?page=2&limit=50/,
      result: { stdout: JSON.stringify([comment]) },
    },
    { match: /issues\/3/, result: { stdout: JSON.stringify(rawIssue) } },
  ]);
  const issue = await new ForgejoHost({
    runner,
    repoRoot: "/repo",
    login: "",
  }).viewIssue(3);
  assert.equal(issue.comments.length, 51);
  assert.deepEqual(issue.comments[50], {
    author: "reviewer",
    body: "yes",
    createdAt: "later",
  });
});

const pr = {
  number: 1,
  html_url: "https://host/pr/1",
  state: "closed",
  merged: false,
  body: "body",
  title: "Change",
  head: { ref: "topic" },
};
for (const [entries, state, draft] of [
  [
    [pr, { ...pr, merged: true }, { ...pr, state: "open", draft: true }],
    "open",
    true,
  ],
  [[pr, { ...pr, merged: true }], "merged", false],
  [[{ ...pr, title: "WIP: Change" }], "closed", true],
] as const) {
  test(`PR selection prefers ${state} and maps draft`, async () => {
    const { host } = fixture(
      JSON.stringify([
        { ...pr, state: "open", head: { ref: "other" } },
        ...entries,
      ]),
    );
    assert.deepEqual(await host.findPullRequestByHead("topic"), {
      number: 1,
      url: "https://host/pr/1",
      state,
      draft,
      body: "body",
      headBranch: "topic",
    });
    assert.equal(await host.findPullRequestByHead("missing"), undefined);
  });
}

test("setup operations use explicit target without origin and valid unscoped repo commands", async () => {
  const { host, runner } = fixture(
    JSON.stringify([
      { owner: { login: "owner" }, name: "repo", url: "web", ssh: "ssh" },
    ]),
  );
  assert.deepEqual(await host.getRepository(target), {
    publicUrl: "web",
    gitRemoteUrl: "ssh",
  });
  await host.createPublicRepo(target);
  await host.deleteRepo(target);
  await host.createLabel(target, label);
  await host.listLabels(target);
  await host.createIssue(target, {
    title: "Fix",
    body: "Body",
    labels: ["bug"],
  });
  assert.ok(runner.calls.every((c) => c[0] === "tea"));
  for (const call of runner.calls.filter((c) => c[1] === "repos")) {
    assert.ok(!call.includes("--repo"));
    assert.ok(call.includes("--owner"));
    assert.deepEqual(call.slice(-2), ["--login", "name"]);
  }
  assert.ok(
    runner.calls.some((c) => c.includes("--labels") && c.includes("bug")),
  );
});

test("repository absence is only a successful empty search; command and JSON errors propagate", async () => {
  assert.equal(await fixture().host.getRepository(target), undefined);
  const runner = recordingRunner([
    { match: /tea /, result: { code: 1, stderr: "authentication failed" } },
  ]);
  const host = new ForgejoHost({ runner, repoRoot: "/repo", login: "" });
  await assert.rejects(host.getRepository(target), CommandFailedError);
  await assert.rejects(host.createPublicRepo(target), CommandFailedError);
  await assert.rejects(
    fixture("not JSON").host.listOpenIssues(),
    /invalid JSON/,
  );
});

for (const login of ["selected", ""]) {
  test(`checkCli resolves authenticated user without origin for ${login || "default"}`, async () => {
    const runner = recordingRunner([
      { match: /tea --help/, result: {} },
      {
        match: /tea logins list --output json/,
        result: {
          stdout: JSON.stringify([
            { name: "selected", user: "alice", default: false },
            { name: "other", user: "bob", default: "true" },
          ]),
        },
      },
    ]);
    assert.equal(
      (await new ForgejoHost({ runner, repoRoot: "/repo", login }).checkCli())
        .login,
      login ? "alice" : "bob",
    );
    assert.deepEqual(runner.calls, [
      ["tea", "--help"],
      ["tea", "logins", "list", "--output", "json"],
    ]);
  });
}
test("checkCli returns false for unavailable tea or missing login", async () => {
  for (const responses of [
    [{ match: /tea /, result: { code: -1, stderr: "ENOENT" } }],
    [
      { match: /tea --help/, result: {} },
      { match: /tea logins/, result: { stdout: "[]" } },
    ],
  ]) {
    const host = new ForgejoHost({
      runner: recordingRunner(responses),
      repoRoot: "/repo",
      login: "missing",
    });
    assert.equal((await host.checkCli()).ok, false);
  }
});

test("repository search checks later full pages and stops at a short final page", async () => {
  for (const found of [true, false]) {
    const runner = recordingRunner([
      {
        match: /--page 1/,
        result: {
          stdout: JSON.stringify(
            Array.from({ length: 50 }, () => ({
              owner: "owner",
              name: "similar",
              url: "other",
              ssh: "other",
            })),
          ),
        },
      },
      {
        match: /--page 2/,
        result: {
          stdout: JSON.stringify(
            found
              ? [{ owner: "owner", name: "repo", url: "web", ssh: "ssh" }]
              : [],
          ),
        },
      },
      { match: /tea repos search/, result: { stdout: "[]" } },
    ]);
    const host = new ForgejoHost({ runner, repoRoot: "/repo", login: "name" });
    assert.deepEqual(
      await host.getRepository(target),
      found ? { publicUrl: "web", gitRemoteUrl: "ssh" } : undefined,
    );
    assert.equal(runner.calls.length, 2);
    assert.ok(
      runner.calls.every(
        (c) =>
          c.includes("--owner") &&
          c.includes("--login") &&
          !c.includes("--repo"),
      ),
    );
  }
});

test("failed issue, comment, label, PR and origin commands retain operational diagnostics", async () => {
  const runner = recordingRunner([
    { match: /^git /, result: { stdout: "git@host:owner/repo.git" } },
    { match: /^tea /, result: { code: 1, stderr: "server unavailable" } },
  ]);
  const host = new ForgejoHost({ runner, repoRoot: "/repo", login: "" });
  for (const operation of [
    () => host.listOpenIssues(),
    () => host.viewIssue(3),
    () => host.commentIssue(3, "body"),
    () => host.setLabels(3, ["bug"], []),
    () => host.findPullRequestByHead("topic"),
  ]) {
    await assert.rejects(operation(), (error) => {
      assert.ok(error instanceof CommandFailedError);
      assert.match(error.message, /server unavailable/);
      return true;
    });
  }
  const failedOrigin = new ForgejoHost({
    runner: recordingRunner([
      { match: /^git /, result: { code: 1, stderr: "no origin" } },
    ]),
    repoRoot: "/repo",
    login: "",
  });
  await assert.rejects(failedOrigin.repository(), CommandFailedError);
});
