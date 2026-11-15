import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  issueThreadFixture,
  piEntry,
} from "../../test-support/issue-thread-fixture.ts";
import { boardIssue } from "../../test-support/board-fixture.ts";
import { createFileRunDataSource } from "./file-run-data.ts";
import { startWebFixture } from "../../test-support/web-fixture.ts";

async function fixture(t: TestContext) {
  const f = await issueThreadFixture(t);
  let calls = 0;
  let now = new Date("2026-11-14T14:00:00Z");
  const source = createFileRunDataSource({
    ...f,
    metadata: {
      repository: { name: "owner/repo", url: "https://host/owner/repo" },
      baseBranch: "main",
      pushRepository: { slug: "owner/repo", url: "https://host/owner/repo" },
    },
    host: {
      listOpenIssues: async () => {
        calls++;
        return [
          f.issue,
          { ...boardIssue(10), body: "other-body" },
          boardIssue(11, [f.config.labels.unsuitable]),
        ];
      },
      listOpenPullRequests: async () => [],
    },
    runner: async () => ({ code: 1, stdout: "", stderr: "" }),
    now: () => now,
  });
  return {
    ...f,
    source,
    calls: () => calls,
    tick: () => {
      now = new Date(now.getTime() + 1000);
    },
  };
}

test("selected snapshots keep private detail out of boards and revisions track only their projection", async (t) => {
  const f = await fixture(t);
  const { sessionDir } = await f.attempt({
    messages: [
      piEntry("a", "assistant", [
        { type: "text", text: "private-thread-marker" },
      ]),
    ],
  });
  const board = await f.source.snapshot();
  assert.deepEqual(board.details, {});
  assert.doesNotMatch(
    JSON.stringify(board),
    /private-thread-marker|body stays text/,
  );
  const selected = await f.source.snapshot({ issue: 9 });
  assert.match(
    JSON.stringify(selected.details["9"]?.thread),
    /private-thread-marker/,
  );
  assert.deepEqual(
    selected.details["9"]?.summary,
    board.issues.find((i) => i.number === 9),
  );
  await fs.writeFile(
    join(sessionDir, "main.jsonl"),
    JSON.stringify(
      piEntry("a", "assistant", [
        { type: "text", text: "changed-private-marker" },
      ]),
    ),
  );
  const changed = await f.source.snapshot({ issue: 9 });
  assert.notEqual(changed.revision, selected.revision);
  assert.equal((await f.source.snapshot()).revision, board.revision);
  f.tick();
  assert.equal(
    (await f.source.snapshot({ issue: 9 })).revision,
    changed.revision,
  );
  assert.equal(f.calls(), 1);
  assert.ok(Object.isFrozen(changed.details["9"]!.thread));
});

test("different selections never share private pending results and identical selections coalesce", async (t) => {
  const f = await fixture(t);
  const { sessionDir } = await f.attempt({
    messages: [
      piEntry("a", "assistant", [{ type: "text", text: "private-nine" }]),
    ],
  });
  const gate = Promise.withResolvers<void>();
  const opened = Promise.withResolvers<void>();
  const open = fs.open;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === join(sessionDir, "main.jsonl")) {
      opened.resolve();
      await gate.promise;
    }
    return open(...args);
  });
  const nine = f.source.snapshot({ issue: 9 });
  assert.equal(f.source.snapshot({ issue: 9 }), nine);
  const ten = f.source.snapshot({ issue: 10 });
  await opened.promise;
  assert.equal((await ten).details["10"]?.body, "other-body");
  gate.resolve();
  const detail = await nine;
  assert.match(JSON.stringify(detail), /private-nine/);
  assert.deepEqual(Object.keys(detail.details), ["9"]);
  assert.equal(f.calls(), 1);
});

test("board, unknown, unsuitable and unauthenticated requests never read transcripts", async (t) => {
  const f = await fixture(t);
  await f.attempt({
    messages: [
      piEntry("a", "assistant", [{ type: "text", text: "sensitive" }]),
    ],
  });
  const open = fs.open;
  let transcriptReads = 0;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]).endsWith(".jsonl")) transcriptReads++;
    return open(...args);
  });
  await f.source.snapshot();
  assert.deepEqual((await f.source.snapshot({ issue: 99 })).details, {});
  assert.deepEqual((await f.source.snapshot({ issue: 11 })).details, {});
  const web = await startWebFixture(t, { source: f.source });
  assert.equal((await web.request("/api/issues/9")).status, 401);
  assert.equal(
    (await web.request("/api/issues/0", { cookie: web.cookie })).status,
    400,
  );
  assert.equal(transcriptReads, 0);
  const response = await web.request("/api/issues/9", { cookie: web.cookie });
  assert.equal(response.status, 200);
  assert.match(response.body, /sensitive/);
  assert.ok(transcriptReads > 0);
});
