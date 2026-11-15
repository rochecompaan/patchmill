import assert from "node:assert/strict";
import { test } from "node:test";
import { createIssueFeed } from "./issue-feed.ts";
import { createSampleRunDataSource } from "./sample-data.ts";
import type { IssueResponse, IssueUpdate, ThreadEvent } from "./api-types.ts";
import { feedClock } from "../../test-support/feed-clock.ts";

const entry = (id: string, text = id): ThreadEvent => ({
  id,
  at: null,
  kind: "progress",
  text,
});
async function fixture() {
  const sample = await createSampleRunDataSource().snapshot();
  let value: IssueResponse | null = {
    schemaVersion: 1,
    ...sample,
    issue: { ...sample.details["298"]!, thread: [entry("a"), entry("b")] },
  };
  let fingerprint = 0,
    reads = 0,
    projects = 0,
    epoch = 9;
  const clock = feedClock(),
    warnings: string[] = [];
  let pending: Promise<string> | undefined;
  const source = createIssueFeed({
    clock,
    epoch: () => (++epoch).toString(16).padStart(8, "0"),
    warn: (m) => warnings.push(m),
    fingerprint: async () => {
      reads++;
      return pending ?? String(fingerprint);
    },
    project: async () => {
      projects++;
      return value;
    },
  });
  const updates: IssueUpdate[] = [];
  const stop = source.subscribe({ issue: 298, lastEventId: null }, (u) =>
    updates.push(u),
  );
  await clock.advance(0);
  return {
    source,
    clock,
    updates,
    stop,
    warnings,
    reads: () => reads,
    projects: () => projects,
    set(v: IssueResponse | null) {
      value = v;
      fingerprint++;
    },
    get: () => value!,
    pending(p: Promise<string>) {
      pending = p;
    },
  };
}
test("feed resets then sends ordered suffix replacements before header changes", async () => {
  const f = await fixture();
  assert.equal(f.updates[0]?.kind, "reset");
  assert.equal(f.updates[0]?.id, "0000000a-1");
  f.set({
    ...f.get(),
    issue: {
      ...f.get().issue,
      thread: [entry("a"), entry("b"), entry("c"), entry("d")],
    },
  });
  await f.clock.advance(1000);
  assert.deepEqual(f.updates[1], {
    id: "0000000a-2",
    kind: "thread",
    after: "b",
    entries: [entry("c"), entry("d")],
  });
  f.set({
    ...f.get(),
    issue: {
      ...f.get().issue,
      body: "changed",
      thread: [entry("a"), entry("b", "result"), entry("c"), entry("d")],
    },
  });
  await f.clock.advance(1000);
  assert.deepEqual(
    f.updates.slice(2).map((u) => u.kind),
    ["thread", "header"],
  );
  assert.deepEqual(f.updates[2], {
    id: "0000000a-3",
    kind: "thread",
    after: "a",
    entries: [entry("b", "result"), entry("c"), entry("d")],
  });
  const replay: IssueUpdate[] = [];
  const stop = f.source.subscribe(
    { issue: 298, lastEventId: "0000000a-2" },
    (u) => replay.push(u),
  );
  await f.clock.advance(0);
  assert.deepEqual(replay, f.updates.slice(2));
  stop();
  f.stop();
});
test("feed coalesces polling, ignores unchanged projections, and stops reads after last unsubscribe", async () => {
  const f = await fixture();
  await f.clock.advance(1000);
  assert.equal(f.projects(), 1);
  await f.clock.advance(60000);
  assert.equal(f.projects(), 2);
  assert.equal(f.updates.length, 1);
  let resolve!: (v: string) => void;
  f.pending(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await f.clock.advance(1000);
  const reads = f.reads();
  await f.clock.advance(3000);
  assert.equal(f.reads(), reads);
  f.stop();
  resolve("new");
  await f.clock.advance(0);
  assert.equal(f.projects(), 2);
  assert.equal(f.clock.intervals, 0);
  await f.clock.advance(10000);
  assert.equal(f.reads(), reads);
});
test("idle reconnect projects immediately and replays; expired or foreign IDs reset", async () => {
  const f = await fixture();
  f.stop();
  f.set({
    ...f.get(),
    issue: { ...f.get().issue, thread: [entry("a"), entry("b"), entry("c")] },
  });
  const updates: IssueUpdate[] = [];
  let stop = f.source.subscribe(
    { issue: 298, lastEventId: "0000000a-1" },
    (u) => updates.push(u),
  );
  await f.clock.advance(0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.kind, "thread");
  stop();
  await f.clock.advance(300001);
  updates.length = 0;
  stop = f.source.subscribe({ issue: 298, lastEventId: "0000000a-2" }, (u) =>
    updates.push(u),
  );
  await f.clock.advance(0);
  assert.equal(updates[0]?.kind, "reset");
  assert.equal(updates[0]?.id, "0000000b-1");
  stop();
});
test("overflowed and malformed cursors reset; listener failure is isolated; unavailable is sent once", async () => {
  const f = await fixture();
  const bad = f.source.subscribe({ issue: 298, lastEventId: "bad" }, () => {
    throw Error("listener");
  });
  for (let i = 0; i < 1001; i++) {
    f.set({ ...f.get(), issue: { ...f.get().issue, body: String(i) } });
    await f.clock.advance(1000);
  }
  const updates: IssueUpdate[] = [];
  const stop = f.source.subscribe(
    { issue: 298, lastEventId: "0000000a-1" },
    (u) => updates.push(u),
  );
  await f.clock.advance(0);
  assert.equal(updates[0]?.kind, "reset");
  assert.ok(f.warnings.length);
  f.set(null);
  await f.clock.advance(1000);
  await f.clock.advance(60000);
  assert.equal(updates.filter((u) => u.kind === "unavailable").length, 1);
  stop();
  bad();
  f.stop();
});
