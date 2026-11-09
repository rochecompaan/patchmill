import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import type { Issue } from "../host/types.ts";
import { StateStore } from "./store.ts";
import { refreshIssue, syncIssues } from "./sync.ts";

const first = "2026-11-07T10:00:00.000Z";
const later = "2026-11-07T11:00:00.000Z";
const since = "2026-11-07T09:55:00.000Z";
const issue: Issue = {
  number: 1,
  title: "Issue one",
  body: "Details",
  labels: ["bug"],
  state: "open",
  url: "https://example.com/issues/1",
  author: "alice",
  createdAt: first,
  comments: [
    {
      author: "bob",
      body: "First",
      createdAt: first,
      url: "https://example.com/issues/1#c0",
    },
    {
      author: "alice",
      body: "Second",
      createdAt: first,
      url: "https://example.com/issues/1#c1",
    },
  ],
};

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await fs.mkdtemp(join(tmpdir(), "patchmill-sync-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = join(directory, ".patchmill/state");
  const stateFile = join(directory, "host.json");
  writeFakeHostState(stateFile, {
    issues: [issue, { ...issue, number: 2, state: "closed", comments: [] }],
  });
  const host = new FakeHost(stateFile);
  const store = new StateStore(root);
  const warnings: string[] = [];
  let time = first;
  return {
    root,
    host,
    store,
    warnings,
    setTime(value: string) {
      time = value;
    },
    updateHost(update: (state: ReturnType<FakeHost["state"]>) => void) {
      const state = host.state();
      update(state);
      writeFakeHostState(stateFile, state);
    },
    sync: (n?: number) =>
      syncIssues({
        host,
        store,
        now: () => new Date(time),
        issue: n,
        warn: (message) => warnings.push(message),
      }),
  };
}

test("first sync stores every issue with its comments", async (t) => {
  const { host, store, root, sync } = await fixture(t);
  const cursor = await sync();
  assert.deepEqual(await store.readIssue(1), issue);
  assert.equal((await store.readIssue(2))?.state, "closed");
  assert.deepEqual((await fs.readdir(join(root, "issues"))).sort(), [
    "1.json",
    "2.json",
    "sync.json",
  ]);
  assert.ok(host.state().calls.includes("listIssuesSince:"));
  assert.ok(host.state().calls.includes("listCommentsSince:"));
  assert.deepEqual(cursor, {
    repository: "fixture/repo",
    fullSyncAt: first,
    syncedUpTo: first,
  });
  assert.deepEqual(await store.readCursor(), cursor);
});

test("later sync asks since the cursor minus five minutes", async (t) => {
  const f = await fixture(t);
  await f.sync();
  f.setTime(later);
  const cursor = await f.sync();
  assert.ok(f.host.state().calls.includes(`listIssuesSince:${since}`));
  assert.ok(f.host.state().calls.includes(`listCommentsSince:${since}`));
  assert.deepEqual(cursor, {
    repository: "fixture/repo",
    fullSyncAt: first,
    syncedUpTo: later,
  });
});

test("later sync keeps earlier comments and replaces edited ones", async (t) => {
  const f = await fixture(t);
  await f.sync();
  f.updateHost((state) => {
    state.issues[0].title = "Edited title";
    state.issues[0].comments = [
      { ...issue.comments[1], body: "Edited" },
      {
        author: "carol",
        body: "New",
        createdAt: later,
        url: "https://example.com/issues/1#c2",
      },
    ];
  });
  await f.sync();
  assert.deepEqual(await f.store.readIssue(1), {
    ...issue,
    title: "Edited title",
    comments: [
      issue.comments[0],
      { ...issue.comments[1], body: "Edited" },
      {
        author: "carol",
        body: "New",
        createdAt: later,
        url: "https://example.com/issues/1#c2",
      },
    ],
  });
});

test("failed sync keeps the cursor", async (t) => {
  const f = await fixture(t);
  const cursor = await f.sync();
  f.setTime(later);
  const list = f.host.listCommentsSince.bind(f.host);
  f.host.listCommentsSince = async (since) => {
    await list(since);
    throw new Error("comments unavailable");
  };
  await assert.rejects(f.sync(), /comments unavailable/);
  assert.deepEqual(await f.store.readCursor(), cursor);
  f.host.listCommentsSince = list;
  await f.sync();
  assert.equal(
    f.host.state().calls.filter((call) => call === `listIssuesSince:${since}`)
      .length,
    2,
  );
});

test("sync refuses another repository's state", async (t) => {
  const f = await fixture(t);
  const cursor = {
    repository: "other/repo",
    fullSyncAt: first,
    syncedUpTo: first,
  };
  await f.store.writeCursor(cursor);
  await assert.rejects(f.sync(), (error: Error) => {
    assert.ok(error.message.includes("other/repo"));
    assert.ok(error.message.includes("fixture/repo"));
    return true;
  });
  assert.deepEqual(f.host.state().calls, ["repository"]);
  assert.deepEqual(await f.store.readCursor(), cursor);
  assert.deepEqual((await f.store.listIssues()).issues, []);
});

test("repository comparison ignores case and stores host spelling", async (t) => {
  const f = await fixture(t);
  await f.store.writeCursor({
    repository: "FIXTURE/REPO",
    fullSyncAt: first,
    syncedUpTo: first,
  });
  assert.equal((await f.sync()).repository, "fixture/repo");
  assert.ok(f.host.state().calls.includes(`listIssuesSince:${since}`));
});

test("explicit issue is refreshed after lists and replaces the entire copy", async (t) => {
  const f = await fixture(t);
  await f.sync();
  f.updateHost((state) => {
    state.issues[0].comments = [issue.comments[1]];
    state.calls = [];
  });
  await f.sync(1);
  assert.deepEqual(await f.store.readIssue(1), {
    ...issue,
    comments: [issue.comments[1]],
  });
  assert.deepEqual(f.host.state().calls, [
    "repository",
    `listIssuesSince:${since}`,
    `listCommentsSince:${since}`,
    "viewIssue:1",
  ]);
});

test("refreshIssue writes and returns the full host issue", async (t) => {
  const f = await fixture(t);
  const result = await refreshIssue(f.host, f.store, 1);
  assert.deepEqual(result, issue);
  assert.deepEqual(await f.store.readIssue(1), issue);
  assert.equal(await f.store.readCursor(), undefined);
});

test("damaged issue copy triggers a full sync without touching status", async (t) => {
  const f = await fixture(t);
  await f.sync();
  await fs.writeFile(join(f.root, "issues/1.json"), "{");
  await f.store.appendStatus(1, { at: first, status: "ready" });
  const statusPath = join(f.root, "status/1.jsonl");
  const status = await fs.readFile(statusPath);
  f.store.readStatus = async () => {
    throw new Error("sync must not read status");
  };
  f.store.appendStatus = async () => {
    throw new Error("sync must not write status");
  };
  const issues = f.host.listIssuesSince.bind(f.host);
  const comments = f.host.listCommentsSince.bind(f.host);
  f.host.listIssuesSince = async (since) => {
    const listed = await issues(since);
    return since ? [] : listed;
  };
  f.host.listCommentsSince = async (since) => {
    const listed = await comments(since);
    return since ? [] : listed;
  };
  f.updateHost((state) => {
    state.calls = [];
  });
  f.setTime(later);
  const cursor = await f.sync();
  assert.deepEqual(await f.store.readIssue(1), issue);
  assert.deepEqual(f.host.state().calls, [
    "repository",
    "listIssuesSince:",
    "listCommentsSince:",
  ]);
  assert.deepEqual(cursor, {
    repository: "fixture/repo",
    fullSyncAt: later,
    syncedUpTo: later,
  });
  assert.deepEqual(await fs.readFile(statusPath), status);
});

test("damaged copy of a vanished issue is removed", async (t) => {
  const f = await fixture(t);
  await f.sync();
  const path = join(f.root, "issues/99.json");
  await fs.writeFile(path, "{");
  await f.sync();
  await assert.rejects(fs.stat(path), { code: "ENOENT" });
  assert.ok(f.warnings.some((warning) => warning.includes(path)));
  assert.deepEqual((await f.store.listIssues()).damaged, []);
});

test("failed recovery keeps the cursor", async (t) => {
  const f = await fixture(t);
  const cursor = await f.sync();
  await fs.writeFile(join(f.root, "issues/1.json"), "{");
  f.host.listIssuesSince = async () => {
    throw new Error("issues unavailable");
  };
  await assert.rejects(f.sync(), /issues unavailable/);
  assert.deepEqual(await f.store.readCursor(), cursor);
  assert.deepEqual((await f.store.listIssues()).damaged, [1]);
});

test("comments update stored unlisted issues and drop unknown issues", async (t) => {
  const f = await fixture(t);
  await f.sync();
  f.host.listIssuesSince = async () => [];
  f.updateHost((state) => {
    state.issues[0].comments[0].body = "Edited without issue update";
    state.issues.push({ ...issue, number: 99 });
  });
  await f.sync();
  assert.deepEqual((await f.store.readIssue(1))?.comments, [
    { ...issue.comments[0], body: "Edited without issue update" },
    issue.comments[1],
  ]);
  assert.equal(await f.store.readIssue(99), undefined);
});

test("unreadable cursor forces a full sync and discards old listed comments", async (t) => {
  const f = await fixture(t);
  await f.sync();
  await fs.writeFile(join(f.root, "issues/sync.json"), "{");
  f.updateHost((state) => {
    state.issues[0].comments = [issue.comments[1]];
    state.calls = [];
  });
  f.setTime(later);
  await f.sync();
  assert.deepEqual((await f.store.readIssue(1))?.comments, [issue.comments[1]]);
  assert.ok(f.host.state().calls.includes("listCommentsSince:"));
  assert.equal((await f.store.readCursor())?.fullSyncAt, later);
});

test("failed explicit refresh does not advance the cursor", async (t) => {
  const f = await fixture(t);
  const cursor = await f.sync();
  f.setTime(later);
  await assert.rejects(f.sync(99), /Issue 99 was not found/);
  assert.deepEqual(await f.store.readCursor(), cursor);
});

test("invalid cursor fields trigger full sync and a valid replacement", async (t) => {
  const f = await fixture(t);
  await f.sync();
  await fs.writeFile(join(f.root, "issues/sync.json"), "{}");
  f.setTime(later);
  await f.sync();
  assert.deepEqual(await f.store.readCursor(), {
    repository: "fixture/repo",
    fullSyncAt: later,
    syncedUpTo: later,
  });
  assert.equal(
    f.host.state().calls.filter((c) => c === "listIssuesSince:").length,
    2,
  );
});

test("invalid issue fields are damaged and restored by full sync", async (t) => {
  const f = await fixture(t);
  await f.sync();
  for (const invalid of [
    { ...issue, state: "merged" },
    { ...issue, number: 3 },
  ]) {
    await fs.writeFile(join(f.root, "issues/1.json"), JSON.stringify(invalid));
    assert.equal(await f.store.readIssue(1), undefined);
    assert.deepEqual((await f.store.listIssues()).damaged, [1]);
    await f.sync();
    assert.deepEqual(await f.store.readIssue(1), issue);
  }
  assert.equal(
    f.host.state().calls.filter((c) => c === "listIssuesSince:").length,
    3,
  );
});
