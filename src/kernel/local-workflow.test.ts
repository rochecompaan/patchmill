import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { StateStore } from "../state/store.ts";
import { LocalWorkflowState } from "./local-workflow.ts";

const at = "2026-11-07T12:00:00.000Z";

async function setup(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-local-workflow-"));
  const path = join(root, "host.json");
  writeFakeHostState(path, {
    labels: ["bug", "agent-ready"],
    issues: [
      {
        number: 9,
        title: "Issue",
        body: "",
        author: "owner",
        state: "open",
        url: "https://example.invalid/9",
        createdAt: "2026-10-01",
        labels: ["bug", "agent-ready"],
        comments: [],
      },
    ],
  });
  const host = new FakeHost(path);
  const store = new StateStore(root);
  const workflow = new LocalWorkflowState({
    host,
    store,
    now: () => new Date(at),
    warn: () => {},
  });
  const expectedComments: string[] = [];
  // Every test guards the upstream no-label/no-status-comment contract.
  t.after(async () => {
    try {
      const state = host.state();
      assert.deepEqual(state.labels, ["bug", "agent-ready"]);
      assert.deepEqual(state.issues[0]!.labels, ["bug", "agent-ready"]);
      assert.deepEqual(
        state.issues[0]!.comments.map((comment) => comment.body),
        expectedComments,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  return { root, path, host, store, workflow, expectedComments };
}

// Missing ownership checks would overwrite another repository's issue or history.
for (const operation of ["issue", "setStatus"] as const) {
  test(`${operation} refuses foreign state without writing`, async (t) => {
    const { root, host, store, workflow } = await setup(t);
    await store.writeCursor({
      repository: "other/project",
      fullSyncAt: at,
      syncedUpTo: at,
    });
    await store.writeIssue({
      ...host.state().issues[0]!,
      title: "Foreign issue",
    });
    await store.appendStatus(9, { at, status: "inProgress" });
    const paths = [store.issuePath(9), join(root, "status/9.jsonl")];
    const before = await Promise.all(paths.map((path) => fs.readFile(path)));
    await assert.rejects(
      operation === "issue"
        ? workflow.issue(9)
        : workflow.setStatus(9, {
            status: "needsInfo",
            summary: "Q?",
            question: "Q?",
          }),
      {
        message:
          "Local state in .patchmill/state belongs to other/project, not fixture/repo. Move .patchmill/state aside to start again.",
      },
    );
    assert.deepEqual(
      await Promise.all(paths.map((path) => fs.readFile(path))),
      before,
    );
  });
}

// Reading the first record, or deriving status from labels, selects wrong work.
test("status and statusSince come from the last line", async (t) => {
  const { host, store, workflow } = await setup(t);
  await store.writeIssue(host.state().issues[0]!);
  assert.equal((await workflow.issue(9)).status, "untriaged");
  assert.equal((await workflow.openIssues())[0]!.statusSince, undefined);
  await store.appendStatus(9, {
    at: "2026-11-06T00:00:00.000Z",
    status: "ready",
  });
  await store.appendStatus(9, { at, status: "done" });
  for (const tracked of [
    await workflow.issue(9),
    ...(await workflow.openIssues()),
  ]) {
    assert.equal(tracked.status, "done");
    assert.equal(tracked.statusSince, at);
  }
});

// Losing earlier question URLs would treat our own question as a human reply.
test("own question is fromPatchmill and later comments are not", async (t) => {
  const { path, host, workflow, expectedComments } = await setup(t);
  expectedComments.push("Q?", "Human answer");
  await workflow.setStatus(9, {
    status: "needsInfo",
    summary: "Q?",
    question: "Q?",
  });
  await workflow.setStatus(9, { status: "ready" });
  const state = host.state();
  state.issues[0]!.comments.push({
    url: "https://example.invalid/9#human",
    author: "human",
    body: "Human answer",
    createdAt: at,
  });
  writeFakeHostState(path, state);
  const tracked = await workflow.issue(9);
  assert.deepEqual(
    tracked.comments.map((comment) => comment.fromPatchmill),
    [true, false],
  );
  assert.deepEqual(
    (await workflow.openIssues())[0]!.comments,
    tracked.comments,
  );
});

// Optional summaries stay local, and question text never enters the journal.
test("question posts once; absent or whitespace question posts nothing", async (t) => {
  const { store, workflow, expectedComments } = await setup(t);
  expectedComments.push("Q?");
  assert.deepEqual(
    await workflow.setStatus(9, {
      status: "needsInfo",
      summary: "Q?",
      question: "Q?",
      runId: "run-1",
      cost: "$1",
      warnings: ["warning"],
    }),
    [],
  );
  assert.deepEqual(
    await workflow.setStatus(9, { status: "ready", summary: "Ready" }),
    [],
  );
  assert.deepEqual(
    await workflow.setStatus(9, { status: "done", question: " \n\t" }),
    [],
  );
  assert.deepEqual(await store.readStatus(9), [
    {
      at,
      status: "needsInfo",
      summary: "Q?",
      runId: "run-1",
      cost: "$1",
      warnings: ["warning"],
      questionUrl: "https://example.invalid/9#c0",
    },
    { at, status: "ready", summary: "Ready" },
    { at, status: "done" },
  ]);
});

// Posting the stop summary would leak diagnostic noise into the question.
test("question posts only its text and keeps the full summary locally", async (t) => {
  const { host, store, workflow, expectedComments } = await setup(t);
  expectedComments.push("Q?");
  await workflow.setStatus(9, {
    status: "needsInfo",
    summary: "Reason\n\nQ?\n\nExit code: 0",
    question: "Q?",
  });
  const comments = host.state().issues[0]!.comments;
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.body, "Q?");
  assert.deepEqual(await store.readStatus(9), [
    {
      at,
      status: "needsInfo",
      summary: "Reason\n\nQ?\n\nExit code: 0",
      questionUrl: comments[0]!.url,
    },
  ]);
});

// Skipping a damaged copy would select work from an incomplete issue list.
test("openIssues refuses a damaged copy", async (t) => {
  const { store, workflow } = await setup(t);
  await fs.mkdir(join(store.issuePath(9), ".."), { recursive: true });
  await fs.writeFile(store.issuePath(9), "{");
  await assert.rejects(workflow.openIssues());
});

// Returning the cached issue would miss a freshly posted upstream answer.
test("issue refreshes from the host", async (t) => {
  const { host, store, workflow } = await setup(t);
  await store.writeIssue({ ...host.state().issues[0]!, title: "Stale" });
  assert.equal((await workflow.issue(9)).title, "Issue");
  assert.equal((await store.readIssue(9))!.title, "Issue");
  assert.ok(host.state().calls.includes("viewIssue:9"));
});

// Selection must use stored open issues, not fetch a new upstream list.
test("openIssues selects only stored open issues", async (t) => {
  const { host, store, workflow } = await setup(t);
  const issue = host.state().issues[0]!;
  await store.writeIssue({ ...issue, title: "Stored" });
  await store.writeIssue({ ...issue, number: 10, state: "closed" });
  const tracked = await workflow.openIssues();
  assert.deepEqual(
    tracked.map((issue) => [issue.number, issue.title, issue.status]),
    [[9, "Stored", "untriaged"]],
  );
});

// A corrupt middle record must not fall back to an apparently usable status.
test("corrupt status rejects tracking", async (t) => {
  const { host, root, store, workflow } = await setup(t);
  await store.writeIssue(host.state().issues[0]!);
  await fs.mkdir(join(root, "status"));
  await fs.writeFile(join(root, "status", "9.jsonl"), "{\n{}\n");
  await assert.rejects(workflow.issue(9), /Invalid status record/);
  await assert.rejects(workflow.openIssues(), /Invalid status record/);
});
