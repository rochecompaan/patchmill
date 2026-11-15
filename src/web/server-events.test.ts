import assert from "node:assert/strict";
import { test } from "node:test";
import { startWebFixture } from "../../test-support/web-fixture.ts";
import { createSampleRunDataSource } from "./sample-data.ts";
import { createIssueFeed } from "./issue-feed.ts";
import { feedClock } from "../../test-support/feed-clock.ts";
import type { IssueResponse, IssueUpdate } from "./api-types.ts";

async function stream(origin: string, cookie: string, id?: string) {
  const controller = new AbortController();
  const response = await fetch(origin + "/api/issues/298/events", {
    headers: { Cookie: cookie, ...(id ? { "Last-Event-ID": id } : {}) },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  let buffer = "";
  return {
    response,
    close: () => controller.abort(),
    async next() {
      while (!buffer.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += new TextDecoder().decode(value);
      }
      const end = buffer.indexOf("\n\n"),
        frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return frame;
    },
  };
}
test("events reject unauthorized, invalid, absent issues and HEAD without subscribing", async (t) => {
  const f = await startWebFixture(t);
  for (const [path, status] of [
    ["/api/issues/298/events", 401],
    ["/api/issues/0/events", 400],
    ["/api/issues/999999/events", 404],
  ] as const) {
    const r = await f.request(path, status === 401 ? {} : { cookie: f.cookie });
    assert.equal(r.status, status);
  }
  const head = await f.request("/api/issues/298/events", {
    cookie: f.cookie,
    method: "HEAD",
  });
  assert.equal(head.status, 405);
  assert.equal(head.headers.allow, "GET");
});
test("events frame updates, keep alive, unsubscribe on disconnect, and close on shutdown", async (t) => {
  const sample = createSampleRunDataSource();
  let unsubscribed = 0;
  const f = await startWebFixture(t, {
    keepAliveMs: 20,
    source: {
      snapshot: sample.snapshot,
      subscribe: (selection, listener) => {
        assert.equal(selection.lastEventId, null);
        sample.subscribe(selection, listener);
        return () => {
          unsubscribed++;
        };
      },
    },
  });
  const s = await stream(f.origin, f.cookie, "bad");
  assert.equal(s.response.status, 200);
  assert.equal(
    s.response.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
  );
  assert.equal(s.response.headers.get("content-length"), null);
  assert.equal(s.response.headers.get("cache-control"), "no-store");
  assert.match(
    s.response.headers.get("content-security-policy")!,
    /default-src/,
  );
  assert.equal(await s.next(), "retry: 3000");
  assert.match((await s.next())!, /^id: 00000000-1\nevent: reset\ndata: /);
  assert.equal(await s.next(), ": keep-alive");
  s.close();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(unsubscribed, 1);
  const open = await stream(f.origin, f.cookie);
  await open.next();
  await open.next();
  await f.close();
  assert.equal(await open.next(), null);
  assert.equal(unsubscribed, 2);
});
test("Last-Event-ID reconnect receives only missed issue updates", async (t) => {
  const sample = createSampleRunDataSource();
  const snapshot = await sample.snapshot();
  let value: IssueResponse = {
    schemaVersion: 1,
    ...snapshot,
    issue: { ...snapshot.details["298"]!, thread: [] },
  };
  let version = 0;
  const clock = feedClock();
  const feed = createIssueFeed({
    clock,
    epoch: () => "abcdef01",
    warn: () => {},
    fingerprint: async () => String(version),
    project: async () => value,
  });
  const f = await startWebFixture(t, {
    source: { snapshot: sample.snapshot, subscribe: feed.subscribe },
  });
  const s = await stream(f.origin, f.cookie);
  await s.next();
  assert.match((await s.next())!, /event: reset/);
  s.close();
  await new Promise((r) => setTimeout(r, 30));
  value = {
    ...value,
    issue: {
      ...value.issue,
      thread: [{ kind: "progress", id: "a", at: null, text: "missed" }],
    },
  };
  version++;
  const reconnect = await stream(f.origin, f.cookie, "abcdef01-1");
  await reconnect.next();
  const frame = (await reconnect.next())!;
  assert.match(frame, /event: thread/);
  assert.doesNotMatch(frame, /event: reset/);
  const update = JSON.parse(frame.split("data: ")[1]!) as IssueUpdate;
  assert.ok(update.kind === "thread");
  assert.equal(update.entries[0]?.id, "a");
  reconnect.close();
});
