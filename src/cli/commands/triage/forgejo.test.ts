import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
import {
  applyIssueLabels,
  commentIssue,
  createLabel,
  hydrateIssueComments,
  listIssuesByNumbers,
  listLabels,
  listOpenIssues,
} from "./forgejo.ts";

test("listOpenIssues parses tea issue JSON", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          index: 2,
          title: "Second",
          body: "Body",
          state: "open",
          labels: [{ name: "bug" }],
          author: { login: "ana" },
          updated: "2026-05-08T10:00:00Z",
        },
        {
          index: 1,
          title: "First",
          body: "",
          state: "open",
          labels: ["enhancement"],
          url: "https://forgejo.example/issues/1",
        },
      ]),
      stderr: "",
    },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
  ]);

  const issues = await listOpenIssues(runner, "/repo");

  assert.deepEqual(
    issues.map((issue) => issue.number),
    [1, 2],
  );
  assert.deepEqual(issues[0].labels, ["enhancement"]);
  assert.equal(issues[0]?.url, "https://forgejo.example/issues/1");
  assert.equal(runner.calls[0].command, "tea");
  assert.deepEqual(runner.calls[0].args.slice(0, 4), [
    "issues",
    "list",
    "--state",
    "open",
  ]);
  assert.deepEqual(runner.calls[0].args.slice(6, 10), [
    "--page",
    "1",
    "--limit",
    "1000",
  ]);
  assert.deepEqual(runner.calls[1].args.slice(6, 10), [
    "--page",
    "2",
    "--limit",
    "1000",
  ]);
});

test("listOpenIssues paginates until an empty page is returned", async () => {
  const makeIssue = (index: number) => ({
    index,
    title: `Issue ${index}`,
    body: "",
    state: "open",
    labels: [],
  });
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([makeIssue(3), makeIssue(2)]),
      stderr: "",
    },
    { code: 0, stdout: JSON.stringify([makeIssue(1)]), stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
  ]);

  const issues = await listOpenIssues(runner, "/repo");

  const listCalls = runner.calls.filter(
    (call) => call.args[0] === "issues" && call.args[1] === "list",
  );
  assert.equal(listCalls.length, 3);
  assert.deepEqual(listCalls[0].args.slice(6, 10), [
    "--page",
    "1",
    "--limit",
    "1000",
  ]);
  assert.deepEqual(listCalls[1].args.slice(6, 10), [
    "--page",
    "2",
    "--limit",
    "1000",
  ]);
  assert.deepEqual(listCalls[2].args.slice(6, 10), [
    "--page",
    "3",
    "--limit",
    "1000",
  ]);
  assert.deepEqual(
    issues.map((issue) => issue.number),
    [1, 2, 3],
  );
});

test("listIssuesByNumbers lists all states and filters selected issue numbers", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        { index: 1, title: "One", state: "open", labels: [] },
        { index: 2, title: "Two", state: "closed", labels: ["wontfix"] },
      ]),
      stderr: "",
    },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
  ]);

  const issues = await listIssuesByNumbers(
    runner,
    "/repo",
    [2],
    "triage-agent",
  );

  assert.deepEqual(
    issues.map((issue) => issue.number),
    [2],
  );
  assert.equal(issues[0]?.state, "closed");
  assert.deepEqual(issues[0]?.labels, ["wontfix"]);
  assert.ok(runner.calls[0]?.args.includes("--state"));
  assert.ok(runner.calls[0]?.args.includes("all"));
});

test("listOpenIssues rejects empty stdout as invalid JSON", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await assert.rejects(
    () => listOpenIssues(runner, "/repo"),
    /tea issues list returned invalid JSON/,
  );
});

test("listOpenIssues parses comma-separated string fields emitted by tea", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          index: "33",
          title: "First",
          body: "Body",
          state: "open",
          labels: "bug,agent-ready",
          author: "rozanne",
          updated: "2026-05-08T10:00:00Z",
          comments: "2",
        },
      ]),
      stderr: "",
    },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
  ]);

  const issues = await listOpenIssues(runner, "/repo");

  assert.equal(issues[0].number, 33);
  assert.deepEqual(issues[0].labels, ["agent-ready", "bug"]);
  assert.equal(issues[0].author, "rozanne");
});

test("hydrateIssueComments fetches and parses full comments for every selected issue", async () => {
  const issues = [
    {
      number: 1,
      title: "First",
      body: "Body",
      state: "open",
      labels: ["enhancement"],
    },
    {
      number: 2,
      title: "Second",
      body: "Body",
      state: "open",
      labels: ["bug"],
    },
  ];
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout:
        "## Comments\n\n**@ana** wrote on 2026-05-08 10:30:\n\nClarification for issue 1.\n\n--------\n",
      stderr: "",
    },
    {
      code: 0,
      stdout:
        "## Comments\n\n**@sam** wrote on 2026-05-08 11:45:\n\nClarification for issue 2 line one.\nClarification line two.\n\n--------\n",
      stderr: "",
    },
  ]);

  await hydrateIssueComments(runner, "/repo", issues);

  assert.deepEqual(issues[0].comments, [
    {
      author: "ana",
      created: "2026-05-08 10:30",
      body: "Clarification for issue 1.",
    },
  ]);
  assert.deepEqual(issues[1].comments, [
    {
      author: "sam",
      created: "2026-05-08 11:45",
      body: "Clarification for issue 2 line one.\nClarification line two.",
    },
  ]);
  assert.ok(
    runner.calls.some(
      (call) => call.args.includes("1") && call.args.includes("--comments"),
    ),
  );
  assert.ok(
    runner.calls.some(
      (call) => call.args.includes("2") && call.args.includes("--comments"),
    ),
  );
});

test("listOpenIssues parses space-separated string labels emitted by tea", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          index: "33",
          title: "First",
          body: "Body",
          state: "open",
          labels: "agent-ready bug priority:high",
        },
      ]),
      stderr: "",
    },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
  ]);

  const issues = await listOpenIssues(runner, "/repo");

  assert.deepEqual(issues[0].labels, ["agent-ready", "bug", "priority:high"]);
});

test("listOpenIssues rejects object issue labels", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        { index: 1, title: "First", labels: { name: "bug" } },
      ]),
      stderr: "",
    },
  ]);

  await assert.rejects(
    () => listOpenIssues(runner, "/repo"),
    /Unexpected labels payload/,
  );
});

test("listLabels parses tea label JSON", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([{ name: "bug" }, { name: "agent-ready" }]),
      stderr: "",
    },
  ]);

  assert.deepEqual(await listLabels(runner, "/repo"), ["agent-ready", "bug"]);
});

test("listLabels rejects empty stdout as invalid JSON", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await assert.rejects(
    () => listLabels(runner, "/repo"),
    /tea labels list returned invalid JSON/,
  );
});

test("createLabel calls tea labels create", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await createLabel(runner, "/repo", {
    name: "agent-ready",
    color: "#2ea043",
    description: "Ready",
  });

  assert.deepEqual(runner.calls[0].args, [
    "labels",
    "create",
    "--name",
    "agent-ready",
    "--color",
    "#2ea043",
    "--description",
    "Ready",
    "--repo",
    "/repo",
  ]);
});

test("Forgejo commands use the origin repository slug for repository overrides", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "forgejo-repo-slug-"));
  await mkdir(join(repoRoot, ".git"));
  await writeFile(
    join(repoRoot, ".git", "config"),
    `[remote "origin"]\n\turl = ssh://git@git.compaan/roche/patchmill.git\n`,
    "utf8",
  );
  const runner = createStaticCommandRunner([
    { code: 0, stdout: JSON.stringify([{ name: "bug" }]), stderr: "" },
  ]);

  await listLabels(runner, repoRoot);

  assert.deepEqual(runner.calls[0]?.args.slice(-2), [
    "--repo",
    "roche/patchmill",
  ]);
});

test("Forgejo commands use the common git config for worktree repository overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgejo-worktree-slug-"));
  const repoRoot = join(root, "worktree");
  const gitDir = join(root, "main.git", "worktrees", "worktree");
  const commonDir = join(root, "main.git");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(gitDir, { recursive: true });
  await writeFile(join(repoRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");
  await writeFile(join(gitDir, "commondir"), `../..\n`, "utf8");
  await writeFile(
    join(commonDir, "config"),
    `[remote "origin"]\n\turl = git@git.compaan:roche/patchmill.git\n`,
    "utf8",
  );
  const runner = createStaticCommandRunner([
    { code: 0, stdout: JSON.stringify([{ name: "bug" }]), stderr: "" },
  ]);

  await listLabels(runner, repoRoot);

  assert.deepEqual(runner.calls[0]?.args.slice(-2), [
    "--repo",
    "roche/patchmill",
  ]);
});

test("Forgejo commands pass an explicit repository override", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    { code: 0, stdout: JSON.stringify([{ name: "bug" }]), stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  await listOpenIssues(runner, "/repo");
  await listLabels(runner, "/repo");
  await createLabel(runner, "/repo", {
    name: "agent-ready",
    color: "#2ea043",
    description: "Ready",
  });
  await applyIssueLabels(runner, "/repo", {
    issueNumber: 3,
    oldLabels: [],
    newLabels: ["bug"],
    addLabels: ["bug"],
    removeLabels: [],
  });
  await commentIssue(runner, "/repo", 4, "Comment");

  for (const call of runner.calls) {
    assert.ok(
      call.args.includes("--repo"),
      `${call.args.join(" ")} should include --repo`,
    );
    assert.ok(
      call.args.includes("/repo"),
      `${call.args.join(" ")} should include the repository path`,
    );
    const separatorIndex = call.args.indexOf("--");
    const repoIndex = call.args.indexOf("--repo");
    assert.ok(
      separatorIndex === -1 || repoIndex < separatorIndex,
      `${call.args.join(" ")} should put --repo before --`,
    );
  }
});

test("applyIssueLabels edits add and remove labels in one command", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await applyIssueLabels(runner, "/repo", {
    issueNumber: 3,
    oldLabels: ["old"],
    newLabels: ["bug"],
    addLabels: ["bug"],
    removeLabels: ["old"],
  });

  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [
      [
        "issues",
        "edit",
        "3",
        "--remove-labels",
        "old",
        "--add-labels",
        "bug",
        "--repo",
        "/repo",
      ],
    ],
  );
});

test("applyIssueLabels skips tea calls when no label changes are needed", async () => {
  const runner = createStaticCommandRunner([]);

  await applyIssueLabels(runner, "/repo", {
    issueNumber: 3,
    oldLabels: ["bug"],
    newLabels: ["bug"],
    addLabels: [],
    removeLabels: [],
  });

  assert.equal(runner.calls.length, 0);
});

test("commentIssue calls tea comment", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await commentIssue(
    runner,
    "/repo",
    4,
    "Automated triage needs more information.",
  );

  assert.deepEqual(runner.calls[0].args, [
    "comment",
    "4",
    "--repo",
    "/repo",
    "--",
    "Automated triage needs more information.",
  ]);
});

test("commentIssue separates flag-like body text", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await commentIssue(runner, "/repo", 4, "--help should be posted, not parsed");

  assert.deepEqual(runner.calls[0].args, [
    "comment",
    "4",
    "--repo",
    "/repo",
    "--",
    "--help should be posted, not parsed",
  ]);
});

test("Forgejo commands use explicit tea login when provided", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    { code: 0, stdout: JSON.stringify([{ name: "bug" }]), stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  await listOpenIssues(runner, "/repo", "triage-agent");
  await listLabels(runner, "/repo", "triage-agent");
  await createLabel(
    runner,
    "/repo",
    { name: "agent-ready", color: "#2ea043", description: "Ready" },
    "triage-agent",
  );
  await applyIssueLabels(
    runner,
    "/repo",
    {
      issueNumber: 3,
      oldLabels: [],
      newLabels: ["bug"],
      addLabels: ["bug"],
      removeLabels: [],
    },
    "triage-agent",
  );
  await commentIssue(runner, "/repo", 4, "Comment", "triage-agent");

  for (const call of runner.calls) {
    assert.ok(
      call.args.includes("--login"),
      `${call.args.join(" ")} should include --login`,
    );
    assert.ok(
      call.args.includes("triage-agent"),
      `${call.args.join(" ")} should include the login name`,
    );
  }
});
