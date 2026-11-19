import assert from "node:assert/strict";
import { test } from "node:test";
import { feedClock } from "../../test-support/feed-clock.ts";
import type {
  IssueResponse,
  IssueUpdate,
  LiveSession,
  LiveSessionHeader,
  ThreadEvent,
} from "./api-types.ts";
import { withLiveSession } from "./file-run-data.ts";
import { createIssueFeed } from "./issue-feed.ts";
import { createSampleRunDataSource } from "./sample-data.ts";
import type { SessionChange } from "./session/types.ts";

const entry = (id: string, at: string | null = null): ThreadEvent => ({
  id,
  at,
  kind: "progress",
  text: id,
});
const header = (patch: Partial<LiveSessionHeader> = {}): LiveSessionHeader => ({
  id: "s1",
  startedAt: "2026-11-19T10:05:00.000Z",
  state: "idle",
  status: null,
  question: null,
  ended: null,
  ...patch,
});

function fakeSessions() {
  let session: LiveSession | null = null;
  const listeners = new Set<(c: SessionChange) => void>();
  return {
    subscriptions: () => listeners.size,
    hub: {
      current: () => session,
      subscribe(_issue: number, listener: (c: SessionChange) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    change(c: SessionChange) {
      if (c.kind === "session")
        session = c.session
          ? { ...c.session, entries: session?.entries ?? [] }
          : null;
      else if (session) {
        const entries = [...session.entries];
        for (const e of c.entries) {
          const i = entries.findIndex((x) => x.id === e.id);
          if (i >= 0) entries[i] = e;
          else entries.push(e);
        }
        session = { ...session, entries };
      }
      for (const l of listeners) l(c);
    },
  };
}

async function fixture() {
  const sample = await createSampleRunDataSource().snapshot();
  const sessions = fakeSessions();
  let thread = [entry("a")];
  let fingerprint = 0;
  let projects = 0;
  const clock = feedClock();
  const feed = createIssueFeed({
    clock,
    epoch: () => "0000000a",
    warn: () => {},
    sessions: sessions.hub,
    fingerprint: async () => String(fingerprint),
    project: async () => {
      projects++;
      const value: IssueResponse = {
        schemaVersion: 1,
        ...sample,
        sessions: true,
        issue: { ...sample.details["298"]!, thread },
      };
      return {
        ...value,
        issue: withLiveSession(value.issue, sessions.hub.current()),
      };
    },
  });
  const subscribe = (lastEventId: string | null = null) => {
    const updates: IssueUpdate[] = [];
    const stop = feed.subscribe({ issue: 298, lastEventId }, (u) =>
      updates.push(u),
    );
    return { updates, stop };
  };
  return {
    clock,
    sessions,
    subscribe,
    projects: () => projects,
    setThread(next: ThreadEvent[]) {
      thread = next;
      fingerprint++;
    },
  };
}

test("session changes share the feed's ordered IDs", async () => {
  const f = await fixture();
  const a = f.subscribe();
  await f.clock.advance(0);
  f.setThread([entry("a"), entry("b")]);
  await f.clock.advance(1000);
  f.sessions.change({ kind: "session", session: header() });
  f.sessions.change({ kind: "session-entries", entries: [entry("web:s1:1")] });
  assert.deepEqual(
    a.updates.map((u) => [u.id, u.kind]),
    [
      ["0000000a-1", "reset"],
      ["0000000a-2", "thread"],
      ["0000000a-3", "session"],
      ["0000000a-4", "session-entries"],
    ],
  );
});

test("replays session updates after Last-Event-ID", async () => {
  const f = await fixture();
  const a = f.subscribe();
  await f.clock.advance(0);
  f.setThread([entry("a"), entry("b")]);
  await f.clock.advance(1000);
  f.sessions.change({ kind: "session", session: header() });
  f.sessions.change({ kind: "session-entries", entries: [entry("web:s1:1")] });
  f.sessions.change({ kind: "session-entries", entries: [entry("web:s1:2")] });
  assert.deepEqual(
    a.updates.slice(1).map((u) => u.id),
    ["0000000a-2", "0000000a-3", "0000000a-4", "0000000a-5"],
  );
  const b = f.subscribe("0000000a-3");
  assert.deepEqual(
    b.updates.map((u) => [u.id, u.kind]),
    [
      ["0000000a-4", "session-entries"],
      ["0000000a-5", "session-entries"],
    ],
  );
});

test("a reset carries the live session", async () => {
  const f = await fixture();
  f.sessions.change({ kind: "session", session: header() });
  const a = f.subscribe();
  await f.clock.advance(0);
  const reset = a.updates[0];
  assert.equal(reset?.kind, "reset");
  assert.equal(reset?.kind === "reset" && reset.issue.issue.session?.id, "s1");
});

test("reset after session changes carries current entries", async () => {
  const f = await fixture();
  const a = f.subscribe();
  await f.clock.advance(0);
  f.sessions.change({ kind: "session", session: header() });
  f.sessions.change({ kind: "session-entries", entries: [entry("web:s1:1")] });
  // A foreign cursor gets a reset from the stored state.
  const b = f.subscribe("ffffffff-1");
  const reset = b.updates[0];
  assert.equal(reset?.kind, "reset");
  assert.deepEqual(
    reset?.kind === "reset" && reset.issue.issue.session?.entries,
    [entry("web:s1:1")],
  );
  a.stop();
});

test("reconnect after a no-subscriber gap receives the gap's session changes", async () => {
  const f = await fixture();
  const a = f.subscribe();
  await f.clock.advance(0);
  f.sessions.change({ kind: "session", session: header() });
  a.stop();
  f.sessions.change({ kind: "session-entries", entries: [entry("web:s1:1")] });
  await f.clock.advance(60_000);
  const b = f.subscribe("0000000a-2");
  await f.clock.advance(0);
  assert.ok(
    b.updates.some(
      (u) => u.kind === "session-entries" && u.entries[0]?.id === "web:s1:1",
    ),
  );
});

test("a header update after a run-file change does not carry the session", async () => {
  const f = await fixture();
  const a = f.subscribe();
  await f.clock.advance(0);
  f.sessions.change({ kind: "session", session: header() });
  await f.clock.advance(1000);
  f.sessions.change({ kind: "session-entries", entries: [entry("web:s1:1")] });
  f.setThread([entry("a"), entry("b")]);
  await f.clock.advance(1000);
  for (const u of a.updates)
    if (u.kind === "header") assert.equal("session" in u.header, false);
  // The stored state keeps the newer entries after reprojection.
  const b = f.subscribe("ffffffff-1");
  const reset = b.updates[0];
  assert.deepEqual(
    reset?.kind === "reset" && reset.issue.issue.session?.entries,
    [entry("web:s1:1")],
  );
});

test("expiring an idle issue state unsubscribes from the hub", async () => {
  const f = await fixture();
  const a = f.subscribe();
  await f.clock.advance(0);
  assert.equal(f.sessions.subscriptions(), 1);
  a.stop();
  await f.clock.advance(299_000);
  assert.equal(f.sessions.subscriptions(), 1);
  await f.clock.advance(1000);
  assert.equal(f.sessions.subscriptions(), 0);
});

test("run-file entries from a live session's span are hidden", () => {
  const detail = {
    thread: [
      entry("r:1:console-planning.jsonl:0", "2026-11-19T10:00:00.000Z"),
      entry("r:2:console-planning.jsonl:0", "2026-11-19T10:06:00.000Z"),
      entry("r:history:4", "2026-11-19T10:06:00.000Z"),
      entry("r:history:1", "2026-11-19T10:00:00.000Z"),
      entry("r:2:worker.jsonl:0", "2026-11-19T10:06:00.000Z"),
      entry("r:interactive-pending", null),
    ],
  } as unknown as Parameters<typeof withLiveSession>[0];
  const session = { ...header(), entries: [] };
  assert.deepEqual(
    withLiveSession(detail, session).thread.map((e) => e.id),
    ["r:1:console-planning.jsonl:0", "r:history:1", "r:2:worker.jsonl:0"],
  );
  assert.equal(withLiveSession(detail, null).thread.length, 6);
  assert.equal(withLiveSession(detail, null).session, null);
});

test("removing the session reprojects and shows the run files again", async () => {
  const f = await fixture();
  f.setThread([entry("r:history:4", "2026-11-19T10:06:00.000Z")]);
  f.sessions.change({ kind: "session", session: header() });
  const a = f.subscribe();
  await f.clock.advance(0);
  const reset = a.updates[0];
  assert.deepEqual(reset?.kind === "reset" && reset.issue.issue.thread, []);
  const before = f.projects();
  f.sessions.change({ kind: "session", session: null });
  await f.clock.advance(1000);
  assert.ok(f.projects() > before);
  const thread = a.updates.find((u) => u.kind === "thread");
  assert.deepEqual(
    thread?.kind === "thread" && thread.entries.map((e) => e.id),
    ["r:history:4"],
  );
});

test("an ended session hides no run files", () => {
  const detail = {
    thread: [
      entry("r:2:console-planning.jsonl:0", "2026-11-19T10:06:00.000Z"),
      entry("r:history:4", "2026-11-19T10:06:00.000Z"),
      entry("r:interactive-pending", null),
    ],
  } as unknown as Parameters<typeof withLiveSession>[0];
  const session = {
    ...header({
      state: "ended",
      ended: { reason: "paused", message: "p" },
    }),
    entries: [],
  };
  const shown = withLiveSession(detail, session);
  assert.equal(shown.thread.length, 3);
  assert.equal(shown.session, session);
});

test("a session that ends reprojects and shows the run files again", async () => {
  const f = await fixture();
  f.setThread([entry("r:history:4", "2026-11-19T10:06:00.000Z")]);
  f.sessions.change({ kind: "session", session: header() });
  const a = f.subscribe();
  await f.clock.advance(0);
  const before = f.projects();
  f.sessions.change({
    kind: "session",
    session: header({
      state: "ended",
      ended: { reason: "paused", message: "p" },
    }),
  });
  await f.clock.advance(1000);
  assert.ok(f.projects() > before);
  const thread = a.updates.find((u) => u.kind === "thread");
  assert.deepEqual(
    thread?.kind === "thread" && thread.entries.map((e) => e.id),
    ["r:history:4"],
  );
});
