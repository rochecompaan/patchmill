import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  issueThreadFixture,
  piEntry,
} from "../../test-support/issue-thread-fixture.ts";
import { boardProgress } from "../../test-support/board-fixture.ts";
import { acquireLock } from "../kernel/lock.ts";
import { writeRunProgress } from "../kernel/run-progress.ts";
import { createFileRunDataSource } from "./file-run-data.ts";
import type { IssueUpdate } from "./api-types.ts";
import { readIssueObservation } from "./file-run-observations.ts";

const wait = async (predicate: () => boolean) => {
  const until = Date.now() + 5000;
  while (!predicate() && Date.now() < until)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(predicate(), "update arrived");
};
test("file feed streams appended lines, completes tools, and publishes terminal thread before header", async (t) => {
  const f = await issueThreadFixture(t);
  const a = await f.attempt({ messages: [] });
  await fs.rm(join(a.dir, "result.json"));
  const lock = await acquireLock(join(f.issueDir, "lock"), {
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  t.after(() => lock.release());
  await writeRunProgress(f.issueDir, boardProgress({ interactive: false }));
  const history = join(a.dir, "history.jsonl");
  await fs.writeFile(
    history,
    JSON.stringify({
      schemaVersion: 1,
      issue: 9,
      runId: boardProgress().runId,
      sequence: 1,
      at: "2026-11-14T12:00:00Z",
      kind: "session",
      number: 1,
      phase: "planning",
    }) + "\n",
  );
  let tick = () => {};
  const source = createFileRunDataSource({
    ...f,
    metadata: {
      repository: { name: "owner/repo", url: "https://github.com/owner/repo" },
      baseBranch: "main",
      pushRepository: {
        slug: "owner/repo",
        url: "https://github.com/owner/repo",
      },
    },
    host: {
      listOpenIssues: async () => [f.issue],
      listOpenPullRequests: async () => [],
    },
    runner: async () => ({ code: 1, stdout: "", stderr: "" }),
    now: () => new Date(),
    warn: (s) => f.warnings.push(s),
    clock: {
      now: () => Date.now(),
      every: (_ms, fn) => {
        tick = fn;
        return () => {
          tick = () => {};
        };
      },
      after: () => () => {},
    },
  });
  const updates: IssueUpdate[] = [];
  const stop = source.subscribe({ issue: 9, lastEventId: null }, (u) =>
    updates.push(u),
  );
  t.after(stop);
  await wait(() => updates.length > 0);
  assert.equal(updates[0]?.kind, "reset");
  const first = updates[0];
  assert.ok(first?.kind === "reset");
  assert.equal(first.issue.issue.run?.activeSince, boardProgress().startedAt);
  assert.ok(!JSON.stringify(first).includes("Agent transcript not recorded"));
  const append = async (value: unknown) => {
    await fs.appendFile(
      join(a.sessionDir, "main.jsonl"),
      JSON.stringify(value) + "\n",
    );
    tick();
  };
  await append(
    piEntry("a", "assistant", [
      {
        type: "toolCall",
        id: "tool",
        name: "read",
        arguments: { path: "hello" },
      },
    ]),
  );
  await wait(() => updates.length === 2);
  const call = updates[1];
  assert.ok(call?.kind === "thread");
  assert.ok(
    call.entries.some(
      (e) => e.kind === "tool" && e.state === "running" && e.result === null,
    ),
  );
  const partial = JSON.stringify(
    piEntry("b", "toolResult", [{ type: "text", text: "done" }]),
  );
  const result = JSON.parse(partial);
  result.message.toolCallId = "tool";
  const line = JSON.stringify(result);
  await fs.appendFile(join(a.sessionDir, "main.jsonl"), line.slice(0, 30));
  tick();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(updates.length, 2);
  assert.equal(f.warnings.length, 0);
  await fs.appendFile(join(a.sessionDir, "main.jsonl"), line.slice(30) + "\n");
  tick();
  await wait(() => updates.length === 3);
  const done = updates[2];
  assert.ok(done?.kind === "thread");
  assert.ok(
    done.entries.some(
      (e) =>
        e.kind === "tool" && e.state === "completed" && e.result === "done",
    ),
  );
  await f.attempt({ messages: [piEntry("a", "assistant", "finished")] });
  await lock.release();
  tick();
  await wait(() => updates.length >= 5);
  assert.deepEqual(
    updates.slice(-2).map((u) => u.kind),
    ["thread", "header"],
  );
  const end = updates.at(-1);
  assert.ok(end?.kind === "header");
  assert.equal(end.header.run?.outcome, "completed");
  assert.equal(end.header.run?.activeSince, null);
  assert.ok(end.header.finalUsage);
  stop();
  const count = updates.length;
  tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(updates.length, count);
});
test("newer held lock keeps historical attempts ended; interactive attempt has a pending notice", async (t) => {
  const f = await issueThreadFixture(t);
  await f.attempt({
    messages: [
      piEntry("a", "assistant", [
        { type: "toolCall", id: "tool", name: "read", arguments: {} },
      ]),
    ],
  });
  const lock = await acquireLock(join(f.issueDir, "lock"), {
    now: () => new Date("2026-11-14T13:00:00Z"),
  });
  t.after(() => lock.release());
  const detail = await f.read();
  assert.equal(detail.run?.activeSince, null);
  assert.ok(
    detail.thread.some((e) => e.kind === "tool" && e.state === "stopped"),
  );
  await writeRunProgress(
    f.issueDir,
    boardProgress({
      runId: "20261114-130000-abcd",
      startedAt: "2026-11-14T13:00:00Z",
      updatedAt: "2026-11-14T13:00:01Z",
    }),
  );
  const current = await f.read();
  assert.equal(current.run?.activeSince, "2026-11-14T13:00:00Z");
  assert.ok(
    current.thread.some(
      (e) => e.id === "20261114-130000-abcd:interactive-pending",
    ),
  );
  assert.equal(
    (await readIssueObservation({ ...f, issue: 9 })).activeRunId,
    "20261114-130000-abcd",
  );
});
