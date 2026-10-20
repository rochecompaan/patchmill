import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import type { Issue } from "../host/types.ts";

const issue: Issue = {
  number: 9,
  title: "Add login",
  body: "Add login support",
  labels: ["agent-ready", "keep"],
  state: "open",
  url: "https://example.invalid/issues/9",
  author: "fixture",
  createdAt: "2026-10-15T00:00:00Z",
  comments: [],
};

function setup(t: TestContext) {
  const dir = fs.mkdtempSync(join(tmpdir(), "patchmill-run-fixtures-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = join(dir, "host.json");
  writeFakeHostState(stateFile, { issues: [issue] });
  return { dir, stateFile, host: new FakeHost(stateFile) };
}

// A cached host snapshot or an unpersisted mutation breaks the run/Pi handoff.
test("host reads external changes and persists label swaps, comments, and calls", async (t) => {
  const { stateFile, host } = setup(t);
  await host.setLabels(9, ["in-progress", "in-progress"], ["agent-ready"]);
  await host.commentIssue(9, "Planning complete. Cost: $0.05");
  const second = new FakeHost(stateFile);
  assert.deepEqual((await second.viewIssue(9)).labels, ["keep", "in-progress"]);
  const comment = (await second.viewIssue(9)).comments[0];
  assert.equal(comment.body, "Planning complete. Cost: $0.05");
  assert.ok(comment.author);
  assert.ok(Number.isFinite(Date.parse(comment.createdAt)));
  const external = second.state();
  external.issues[0].state = "closed";
  external.repository = {
    owner: "team",
    repo: "project",
    defaultBranch: "main",
  };
  external.labels = ["keep"];
  fs.writeFileSync(stateFile, JSON.stringify(external));
  assert.deepEqual(await host.listOpenIssues(), []);
  assert.equal((await host.viewIssue(9)).state, "closed");
  assert.deepEqual(await host.repository(), external.repository);
  await host.createLabel({
    name: "agent-ready",
    color: "ffffff",
    description: "Ready",
  });
  await host.createLabel({
    name: "agent-ready",
    color: "ffffff",
    description: "Ready",
  });
  assert.deepEqual(await second.listLabels(), ["keep", "agent-ready"]);
  assert.equal((await host.checkCli()).ok, true);
  assert.ok(second.state().calls.includes("setLabels:9"));
  assert.ok(second.state().calls.includes("commentIssue:9"));
  await assert.rejects(host.viewIssue(999), /999/);
});

// Ignoring pullRequest or replacing the whole state loses the kernel's evidence.
test("fake Pi creates and updates a current-branch PR while preserving host changes", async (t) => {
  const { dir, stateFile, host } = setup(t);
  const exec = promisify(execFile);
  const branch = "agent/issue-9-add-login";
  await exec("git", ["init", `--initial-branch=${branch}`], { cwd: dir });
  await exec(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial fixture",
    ],
    { cwd: dir },
  );
  const script = join(dir, "steps.json");
  fs.writeFileSync(
    script,
    JSON.stringify([
      { pullRequest: { draft: true, body: "Design for #9" } },
      { pullRequest: { draft: false, body: "Closes #9" } },
    ]),
  );
  const run = () =>
    exec(
      process.execPath,
      [
        new URL("../../test-support/fake-pi.mjs", import.meta.url).pathname,
        "--session-dir",
        join(dir, "sessions"),
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          PATCHMILL_FAKE_PI_SCRIPT: script,
          PATCHMILL_FAKE_HOST_STATE: stateFile,
        },
      },
    );
  assert.deepEqual(await host.listPullRequests(branch), []);
  await run();
  const [draft] = await host.listPullRequests(branch);
  assert.ok(draft);
  assert.equal(await host.pushRepository(), "fixture/repo");
  assert.equal(draft.headRepository, "fixture/repo");
  assert.equal(draft.headBranch, branch);
  assert.equal(draft.baseBranch, "main");
  assert.equal(draft.state, "open");
  assert.equal(draft.draft, true);
  assert.equal(draft.body, "Design for #9");
  assert.ok(draft.number > 0);
  assert.ok(draft.url);
  await host.setLabels(9, ["in-progress"], ["agent-ready"]);
  await host.commentIssue(9, "Keep this comment");
  const unrelated = {
    ...draft,
    number: draft.number + 10,
    headBranch: "other",
  };
  const state = host.state();
  state.pullRequests.push(unrelated);
  fs.writeFileSync(stateFile, JSON.stringify(state));
  await run();
  assert.deepEqual(await host.listPullRequests(branch), [
    { ...draft, draft: false, body: "Closes #9" },
  ]);
  assert.deepEqual(await host.listPullRequests("other"), [unrelated]);
  assert.equal(host.state().pullRequests.length, 2);
  assert.deepEqual((await host.viewIssue(9)).labels, ["keep", "in-progress"]);
  assert.equal((await host.viewIssue(9)).comments[0].body, "Keep this comment");
  assert.ok(host.state().calls.includes("commentIssue:9"));
});
