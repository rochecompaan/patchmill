import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Issue } from "../host/types.ts";
import { StateStore, type StatusChange } from "./store.ts";

const issue: Issue = {
  number: 12,
  title: "Local state",
  body: "Keep the supplied issue",
  labels: ["bug"],
  state: "open",
  url: "https://example.com/issues/12",
  author: "alice",
  createdAt: "2026-11-07T10:00:00Z",
  comments: [
    {
      author: "bob",
      body: "Details",
      createdAt: "2026-11-07T11:00:00Z",
      url: "https://example.com/issues/12#comment-1",
    },
  ],
};
const ready: StatusChange = { at: "2026-11-07T10:00:00Z", status: "ready" };
const active: StatusChange = {
  at: "2026-11-07T11:00:00Z",
  status: "inProgress",
  runId: "run-1",
  summary: "Started",
  cost: "0.01",
  warnings: ["Check this"],
  questionUrl: "https://example.com/question",
};

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await fs.mkdtemp(join(tmpdir(), "patchmill-state-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = join(directory, ".patchmill/state");
  const warnings: string[] = [];
  return {
    root,
    warnings,
    store: new StateStore(root, (message) => warnings.push(message)),
  };
}

test("issues and cursor round-trip", async (t) => {
  const { root, store } = await fixture(t);
  assert.equal(await store.readIssue(12), undefined);
  assert.equal(await store.readCursor(), undefined);
  assert.deepEqual(await store.listIssues(), { issues: [], damaged: [] });
  await store.removeIssue(99);
  const cursor = {
    repository: "owner/repo",
    fullSyncAt: "2026-11-07T10:00:00Z",
    syncedUpTo: "2026-11-07T11:00:00Z",
  };
  await store.writeCursor(cursor);
  await store.writeIssue(issue);
  await store.writeIssue({ ...issue, number: 2 });
  assert.deepEqual(await store.readCursor(), cursor);
  assert.deepEqual(await store.readIssue(12), issue);
  const issuesPath = join(root, "issues");
  assert.deepEqual(await fs.readdir(root), ["issues"]);
  assert.deepEqual(
    JSON.parse(await fs.readFile(join(issuesPath, "sync.json"), "utf8")),
    cursor,
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(join(issuesPath, "12.json"), "utf8")),
    issue,
  );
  await fs.writeFile(join(issuesPath, "4.json.123.tmp"), "{");
  assert.deepEqual(await store.listIssues(), {
    issues: [{ ...issue, number: 2 }, issue],
    damaged: [],
  });
  await fs.unlink(join(issuesPath, "4.json.123.tmp"));
  assert.deepEqual((await fs.readdir(issuesPath)).sort(), [
    "12.json",
    "2.json",
    "sync.json",
  ]);
});

test("corrupt issue and cursor files read as missing", async (t) => {
  const { root, store } = await fixture(t);
  const issuesPath = join(root, "issues");
  await fs.mkdir(issuesPath, { recursive: true });
  await fs.writeFile(join(issuesPath, "12.json"), "{");
  await fs.writeFile(join(issuesPath, "sync.json"), "{");
  assert.equal(await store.readIssue(12), undefined);
  assert.equal(await store.readCursor(), undefined);
  assert.deepEqual(await store.listIssues(), { issues: [], damaged: [12] });
  await store.removeIssue(12);
  await assert.rejects(fs.stat(join(issuesPath, "12.json")), {
    code: "ENOENT",
  });
});

test("status lines append in order", async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.readStatus(12), []);
  await store.appendStatus(12, ready);
  await store.appendStatus(12, active);
  assert.deepEqual(await store.readStatus(12), [ready, active]);
});

test("status file recovery ignores unfinished bytes without writing", async (t) => {
  const { root, store, warnings } = await fixture(t);
  await fs.mkdir(join(root, "status"), { recursive: true });
  const path = join(root, "status/12.jsonl");
  for (const tail of ['{"at":', JSON.stringify(active)]) {
    const text = JSON.stringify(ready) + "\n" + tail;
    await fs.writeFile(path, text);
    assert.deepEqual(await store.readStatus(12), [ready]);
    assert.equal(await fs.readFile(path, "utf8"), text);
    assert.ok(warnings.at(-1)?.includes(path));
  }
});

test("status file recovery rejects corrupt complete records with location", async (t) => {
  const { root, store } = await fixture(t);
  await fs.mkdir(join(root, "status"), { recursive: true });
  const path = join(root, "status/12.jsonl");
  for (const text of [
    "not json\n" + JSON.stringify(ready) + "\n",
    "not json\n",
  ]) {
    await fs.writeFile(path, text);
    await assert.rejects(store.readStatus(12), (error: Error) => {
      assert.ok(error.message.includes(path));
      assert.ok(error.message.includes("line 1"));
      return true;
    });
    assert.equal(await fs.readFile(path, "utf8"), text);
  }
});

test("append after a cut-off write keeps both records", async (t) => {
  const { root, store, warnings } = await fixture(t);
  await fs.mkdir(join(root, "status"), { recursive: true });
  const path = join(root, "status/12.jsonl");
  const prefix = JSON.stringify(ready) + "\n";
  await fs.writeFile(path, prefix + '{"at":');
  assert.deepEqual(await store.readStatus(12), [ready]);
  warnings.length = 0;
  await store.appendStatus(12, active);
  assert.deepEqual(await store.readStatus(12), [ready, active]);
  assert.equal(
    await fs.readFile(path, "utf8"),
    prefix + JSON.stringify(active) + "\n",
  );
  assert.ok(warnings.some((message) => message.includes(path)));
});

test("append discards only unfinished bytes even with corrupt complete records", async (t) => {
  const { root, store } = await fixture(t);
  await fs.mkdir(join(root, "status"), { recursive: true });
  const path = join(root, "status/12.jsonl");
  await fs.writeFile(path, '{"at":');
  await store.appendStatus(12, ready);
  assert.deepEqual(await store.readStatus(12), [ready]);
  await fs.writeFile(path, 'not json\n{"at":');
  await store.appendStatus(12, active);
  assert.equal(
    await fs.readFile(path, "utf8"),
    "not json\n" + JSON.stringify(active) + "\n",
  );
});

test("concurrent appends stay whole across store instances", async (t) => {
  const { root, store } = await fixture(t);
  const second = new StateStore(root);
  const changes = Array.from({ length: 20 }, (_, i) => ({
    ...ready,
    runId: `run-${i}`,
    summary: "é".repeat(100),
  }));
  await Promise.all(
    changes.map((change, i) =>
      (i % 2 ? second : store).appendStatus(12, change),
    ),
  );
  assert.deepEqual(await store.readStatus(12), changes);
  const text = await fs.readFile(join(root, "status/12.jsonl"), "utf8");
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 20);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    changes,
  );
});

test("invalid status fields reject complete lines with location", async (t) => {
  const { root, store } = await fixture(t);
  await fs.mkdir(join(root, "status"), { recursive: true });
  const path = join(root, "status/12.jsonl");
  await fs.writeFile(
    path,
    JSON.stringify(ready) +
      "\n" +
      JSON.stringify({ at: ready.at, status: "blocked" }) +
      "\n",
  );
  await assert.rejects(store.readStatus(12), {
    message: `Invalid status record in ${path} at line 2`,
  });
});
