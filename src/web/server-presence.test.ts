import assert from "node:assert/strict";
import { test } from "node:test";
import { startWebFixture } from "../../test-support/web-fixture.ts";
import { feedClock } from "../../test-support/feed-clock.ts";
import { createSampleRunDataSource } from "./sample-data.ts";
import { createPresence, type Presence } from "./presence.ts";
import type { PresencePerson } from "./api-types.ts";

async function stream(origin: string, cookie: string, query = "") {
  const controller = new AbortController();
  const response = await fetch(origin + "/api/issues/298/events" + query, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  let buffer = "";
  const next = async () => {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += new TextDecoder().decode(value);
    }
    const end = buffer.indexOf("\n\n"),
      frame = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    return frame;
  };
  return {
    response,
    close: () => controller.abort(),
    next,
    /** The names of the next presence frame; other frames are skipped. */
    async presence() {
      for (;;) {
        const frame = await next();
        if (frame === null) return null;
        if (!frame.startsWith("event: presence\n")) continue;
        assert.doesNotMatch(frame, /^id:/m, "presence frames have no id");
        const data = JSON.parse(frame.slice(frame.indexOf("data: ") + 6)) as {
          kind: string;
          people: PresencePerson[];
        };
        assert.equal(data.kind, "presence");
        return data.people.map((p) => p.name);
      }
    },
  };
}

function spy(inner: Presence) {
  const record = { joins: [] as (string | null)[], leaves: 0 };
  const presence: Presence = {
    join(issue, name, send) {
      record.joins.push(name);
      const leave = inner.join(issue, name, send);
      return () => {
        record.leaves++;
        leave();
      };
    },
    typing: inner.typing,
  };
  return { presence, record };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test("named streams see each other and a closed stream leaves", async (t) => {
  const f = await startWebFixture(t, {
    presence: createPresence({ clock: feedClock() }),
  });
  const ana = await stream(f.origin, f.cookie, "?name=Ana");
  assert.equal(ana.response.status, 200);
  assert.deepEqual(await ana.presence(), ["Ana"]);
  const ben = await stream(f.origin, f.cookie, "?name=Ben");
  assert.deepEqual(await ana.presence(), ["Ana", "Ben"]);
  assert.deepEqual(await ben.presence(), ["Ana", "Ben"]);
  ben.close();
  assert.deepEqual(await ana.presence(), ["Ana"]);
  ana.close();
});

test("invalid names are refused before the stream opens", async (t) => {
  const s = spy(createPresence({ clock: feedClock() }));
  const f = await startWebFixture(t, { presence: s.presence });
  for (const query of ["?name=%2Fx", "?name=a&name=b", "?name=a%09b"]) {
    const r = await f.request("/api/issues/298/events" + query, {
      cookie: f.cookie,
    });
    assert.equal(r.status, 400, query);
    assert.equal(JSON.parse(r.body).error.code, "invalid_author");
  }
  assert.deepEqual(s.record.joins, []);
  const watcher = await stream(f.origin, f.cookie, "?name=");
  assert.deepEqual(await watcher.presence(), []);
  assert.deepEqual(s.record.joins, [null]);
  watcher.close();
});

test("server close leaves presence", async (t) => {
  const s = spy(createPresence({ clock: feedClock() }));
  const f = await startWebFixture(t, { presence: s.presence });
  const ana = await stream(f.origin, f.cookie, "?name=Ana");
  const ben = await stream(f.origin, f.cookie, "?name=Ben");
  await ben.presence();
  await f.close();
  while ((await ana.next()) !== null);
  await settle();
  assert.equal(s.record.joins.length, 2);
  assert.equal(s.record.leaves, 2);
});

test("a failing subscribe does not join", async (t) => {
  const sample = createSampleRunDataSource();
  const s = spy(createPresence({ clock: feedClock() }));
  const f = await startWebFixture(t, {
    presence: s.presence,
    source: {
      snapshot: sample.snapshot,
      subscribe: () => {
        throw new Error("no feed");
      },
    },
  });
  await fetch(f.origin + "/api/issues/298/events?name=Ana", {
    headers: { Cookie: f.cookie },
  })
    .then((r) => r.text())
    .catch(() => null);
  await settle();
  assert.deepEqual(s.record.joins, []);
});

test("a stream cut during join still leaves", async (t) => {
  const record = { leaves: 0 };
  const huge = [{ name: "x".repeat(24 * 1024 * 1024), typing: false }];
  const f = await startWebFixture(t, {
    presence: {
      join(_issue, _name, send) {
        send(huge);
        return () => {
          record.leaves++;
        };
      },
      typing: () => false,
    },
  });
  const response = await fetch(f.origin + "/api/issues/298/events?name=Ana", {
    headers: { Cookie: f.cookie },
  });
  await response.text().catch(() => null);
  await settle();
  assert.equal(record.leaves, 1);
});

test("sample servers send no presence events", async (t) => {
  const f = await startWebFixture(t, { keepAliveMs: 20 });
  const s = await stream(f.origin, f.cookie, "?name=Ana");
  assert.equal(await s.next(), "retry: 3000");
  assert.match((await s.next())!, /event: reset/);
  assert.equal(await s.next(), ": keep-alive");
  s.close();
});
