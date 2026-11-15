import assert from "node:assert/strict";
import { test } from "node:test";
import { applyIssueUpdate, liveElapsedSeconds } from "../../web/live-issue.js";
import { createPageController } from "../../web/controller.js";
import { createSampleRunDataSource } from "./sample-data.ts";
import type { IssueResponse, IssueUpdate } from "./api-types.ts";
async function fixture() {
  const data = await createSampleRunDataSource().snapshot();
  const response: IssueResponse = {
    schemaVersion: 1,
    ...data,
    source: "live",
    issue: {
      ...data.details["298"]!,
      summary: { ...data.details["298"]!.summary, elapsedSeconds: 120 },
      run: {
        outcome: "active",
        startedAt: "2026-11-14T12:00:00Z",
        activeSince: "2026-11-14T12:00:00Z",
        finishedAt: null,
      },
      thread: [{ id: "a", kind: "progress", at: null, text: "a" }],
    },
  };
  return response;
}
test("live updates replace headers and suffixes while retaining other page state", async () => {
  const r = await fixture();
  const b = { id: "b", kind: "progress" as const, at: null, text: "b" };
  const appended = applyIssueUpdate(r, {
    id: "feed-2",
    kind: "thread",
    after: "a",
    entries: [b],
  });
  assert.deepEqual(
    appended.issue.thread.map((e) => e.id),
    ["a", "b"],
  );
  const replaced = applyIssueUpdate(appended, {
    id: "feed-3",
    kind: "thread",
    after: "unknown",
    entries: [b],
  });
  assert.deepEqual(replaced.issue.thread, [b]);
  const { thread: _thread, ...header } = r.issue;
  assert.deepEqual(
    applyIssueUpdate(appended, {
      id: "feed-4",
      kind: "header",
      header: { ...header, body: "new" },
      syncedAt: null,
    }).issue.thread,
    appended.issue.thread,
  );
  assert.equal(
    applyIssueUpdate(r, { id: "feed-5", kind: "reset", issue: appended }),
    appended,
  );
  assert.equal(applyIssueUpdate(r, { id: "feed-6", kind: "unavailable" }), r);
});
test("elapsed time adds the active attempt, clamps a future start, and stops at final duration", async () => {
  const { issue } = await fixture(),
    now = Date.parse("2026-11-14T12:00:30Z");
  assert.equal(liveElapsedSeconds(issue, now), 150);
  assert.equal(liveElapsedSeconds(issue, now - 60000), 120);
  assert.equal(
    liveElapsedSeconds(
      { ...issue, summary: { ...issue.summary, elapsedSeconds: null } },
      now,
    ),
    30,
  );
  assert.equal(
    liveElapsedSeconds(
      { ...issue, run: { ...issue.run!, outcome: "completed" } },
      now,
    ),
    120,
  );
});
test("controller owns EventSource lifecycle, reconnection state and one final fetch", async () => {
  let r = await fixture(),
    calls = 0,
    closes = 0;
  const handlers = new Map<string, (e: { data?: string }) => void>();
  const socket = {
    readyState: 1,
    close: () => {
      closes++;
    },
    addEventListener: (name: string, fn: (e: { data?: string }) => void) => {
      handlers.set(name, fn);
    },
  };
  const states: import("../../web/controller.js").PageState[] = [];
  const controller = createPageController({
    api: {
      board: async () => {
        throw Error();
      },
      issue: async () => {
        calls++;
        return r;
      },
    },
    events: (url) => {
      assert.equal(url, "/api/issues/298/events");
      return socket;
    },
    onState: (s) => states.push(s),
    visible: () => true,
    clock: { after: () => () => {} },
  });
  await controller.navigate({ view: "issue", number: 298, artifactId: null });
  handlers.get("open")!({});
  assert.equal(states.at(-1)?.connection, "live");
  socket.readyState = 0;
  handlers.get("error")!({});
  assert.equal(states.at(-1)?.connection, "reconnecting");
  r = {
    ...r,
    issue: {
      ...r.issue,
      run: { ...r.issue.run!, outcome: "completed" },
      thread: [{ id: "final", kind: "progress", at: null, text: "final" }],
    },
  };
  const { thread: _thread, ...header } = r.issue;
  handlers.get("header")!({
    data: JSON.stringify({
      id: "feed-3",
      kind: "header",
      header,
      syncedAt: null,
    } satisfies IssueUpdate),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(closes, 1);
  assert.equal(states.at(-1)?.issue?.issue.thread[0]?.id, "final");
  controller.dispose();
});
