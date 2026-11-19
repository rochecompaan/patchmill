import assert from "node:assert/strict";
import { test } from "node:test";
import { createApi } from "../../web/api.js";
import { createPageController } from "../../web/controller.js";
import type { PageState } from "../../web/controller.js";
import { applyIssueUpdate } from "../../web/live-issue.js";
import { OTHER_PROCESS_HINT, sessionPresentation } from "../../web/state.js";
import type {
  IssueDetail,
  IssueResponse,
  IssueUpdate,
  LiveSession,
  LiveSessionHeader,
} from "./api-types.ts";
import { createSampleRunDataSource } from "./sample-data.ts";

const header = (patch: Partial<LiveSessionHeader> = {}): LiveSessionHeader => ({
  id: "s1",
  startedAt: "2026-11-19T10:05:00.000Z",
  state: "idle",
  status: null,
  question: null,
  ended: null,
  ...patch,
});
const progress = (id: string, text = id) => ({
  id,
  at: null,
  kind: "progress" as const,
  text,
});

async function fixture(
  patch: Partial<IssueDetail> = {},
): Promise<IssueResponse> {
  const data = await createSampleRunDataSource().snapshot();
  const detail = data.details["298"]!;
  return {
    schemaVersion: 1,
    ...data,
    source: "live",
    sessions: true,
    issue: {
      ...detail,
      summary: {
        ...detail.summary,
        status: "none",
        live: false,
        pullRequests: [],
      },
      run: null,
      thread: [progress("a")],
      session: null,
      ...patch,
    },
  };
}

test("session updates replace the header and upsert entries", async () => {
  const r = await fixture();
  const started = applyIssueUpdate(r, {
    id: "e-2",
    kind: "session",
    session: header(),
  });
  assert.deepEqual(started.issue.session, { ...header(), entries: [] });
  const one = applyIssueUpdate(started, {
    id: "e-3",
    kind: "session-entries",
    entries: [progress("web:s1:1", "one"), progress("web:s1:2")],
  });
  const replaced = applyIssueUpdate(one, {
    id: "e-4",
    kind: "session-entries",
    entries: [progress("web:s1:1", "changed"), progress("web:s1:3")],
  });
  assert.deepEqual(
    replaced.issue.session?.entries.map((e) => ("text" in e ? e.text : "")),
    ["changed", "web:s1:2", "web:s1:3"],
  );
  const replying = applyIssueUpdate(replaced, {
    id: "e-5",
    kind: "session",
    session: header({ state: "replying" }),
  });
  assert.equal(replying.issue.session?.state, "replying");
  assert.equal(replying.issue.session?.entries.length, 3);
  const next = applyIssueUpdate(replying, {
    id: "e-6",
    kind: "session",
    session: header({ id: "s2" }),
  });
  assert.deepEqual(next.issue.session?.entries, []);
  assert.equal(
    applyIssueUpdate(next, { id: "e-7", kind: "session", session: null }).issue
      .session,
    null,
  );
  assert.equal(replying.issue.thread, r.issue.thread);
});

test("a header update keeps the session", async () => {
  const r = await fixture({
    session: { ...header(), entries: [progress("web:s1:1")] },
  });
  const { thread: _t, session: _s, ...issueHeader } = r.issue;
  const updated = applyIssueUpdate(r, {
    id: "e-2",
    kind: "header",
    header: { ...issueHeader, body: "new" },
    syncedAt: null,
  });
  assert.equal(updated.issue.body, "new");
  assert.deepEqual(updated.issue.session, r.issue.session);
});

function controllerFixture(response: () => IssueResponse) {
  const handlers = new Map<string, (e: { data?: string }) => void>();
  const urls: string[] = [];
  let loads = 0;
  const states: PageState[] = [];
  const controller = createPageController({
    api: {
      board: async () => {
        throw Error();
      },
      issue: async () => {
        loads++;
        return response();
      },
      session: async () => ({ ok: true, duplicate: false }),
    },
    events: (url) => {
      urls.push(url);
      return {
        readyState: 1,
        close: () => {},
        addEventListener: (name, fn) => {
          handlers.set(name, fn);
        },
      };
    },
    onState: (s) => states.push(s),
    visible: () => true,
    clock: { after: () => () => {} },
  });
  const send = (update: IssueUpdate) =>
    handlers.get(update.kind)!({ data: JSON.stringify(update) });
  return { controller, urls, states, send, loads: () => loads, handlers };
}

test("the controller subscribes on an issue page with no active run", async () => {
  const r = await fixture();
  const f = controllerFixture(() => r);
  await f.controller.navigate({ view: "issue", number: 298, artifactId: null });
  assert.deepEqual(f.urls, ["/api/issues/298/events"]);
  for (const kind of ["session", "session-entries"])
    assert.ok(f.handlers.has(kind));
  f.controller.dispose();
});

test("session updates do not trigger a reload", async () => {
  const r = await fixture({
    run: {
      outcome: "active",
      startedAt: "2026-11-19T10:00:00Z",
      activeSince: "2026-11-19T10:00:00Z",
      finishedAt: null,
    },
  });
  const f = controllerFixture(() => r);
  await f.controller.navigate({ view: "issue", number: 298, artifactId: null });
  f.send({ id: "e-2", kind: "session", session: header() });
  f.send({
    id: "e-3",
    kind: "session-entries",
    entries: [progress("web:s1:1")],
  });
  // The run ends while the Web session is shown: the stream stays.
  const { thread: _t, session: _s, ...issueHeader } = r.issue;
  f.send({
    id: "e-4",
    kind: "header",
    header: { ...issueHeader, run: { ...r.issue.run!, outcome: "completed" } },
    syncedAt: null,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.loads(), 1);
  assert.equal(f.states.at(-1)?.issue?.issue.session?.entries.length, 1);
  f.controller.dispose();
});

test("sessionPresentation follows the issue-state table", async () => {
  const base = (await fixture()).issue;
  const live = (
    state: LiveSession["state"],
    ended: LiveSession["ended"] = null,
  ) => ({ ...header({ state, ended }), entries: [] }) satisfies LiveSession;
  const pick = (detail: IssueDetail, sessions = true) => {
    const p = sessionPresentation(detail, sessions);
    return p && [p.header, p.composer, p.stopReply];
  };
  const run = {
    outcome: "active" as const,
    startedAt: "2026-11-19T10:00:00Z",
    activeSince: null,
    finishedAt: null,
  };
  assert.equal(sessionPresentation(base, false), null);
  assert.deepEqual(
    pick({ ...base, summary: { ...base.summary, status: "done" } }),
    [null, "finished", false],
  );
  assert.deepEqual(
    pick({
      ...base,
      summary: {
        ...base.summary,
        pullRequests: [
          {
            number: 1,
            label: "#1",
            url: "u",
            state: "open",
            kind: "implementation",
          },
        ],
      },
    }),
    [null, "finished", false],
  );
  assert.deepEqual(pick({ ...base, session: live("starting") }), [
    "pause",
    "disabled",
    false,
  ]);
  assert.deepEqual(pick({ ...base, session: live("idle") }), [
    "pause",
    "enabled",
    false,
  ]);
  for (const state of ["replying", "question"] as const)
    assert.deepEqual(pick({ ...base, session: live(state) }), [
      "pause",
      "enabled",
      true,
    ]);
  const pausing = sessionPresentation(
    { ...base, session: live("pausing") },
    true,
  );
  assert.deepEqual(
    [pausing?.header, pausing?.composer, pausing?.composerHint],
    [null, "disabled", "Pausing the Web session…"],
  );
  const other = sessionPresentation(
    {
      ...base,
      run,
      summary: { ...base.summary, live: true },
      session: live("ended", { reason: "finished", message: "x" }),
    },
    true,
  );
  assert.deepEqual(
    [other?.header, other?.composer, other?.composerHint, other?.terminalNote],
    ["terminal", "terminal", OTHER_PROCESS_HINT, "Running in another process"],
  );
  assert.deepEqual(
    pick({
      ...base,
      run,
      session: live("ended", { reason: "crashed", message: "Pi stopped" }),
    }),
    ["resume", "disabled", false],
  );
  for (const status of ["done", "blocked"] as const)
    assert.deepEqual(
      pick({
        ...base,
        run,
        summary: { ...base.summary, status },
        session: live("ended", { reason: "finished", message: "x" }),
      })?.[0],
      status === "done" ? null : "retry",
    );
  assert.deepEqual(
    pick({ ...base, run, summary: { ...base.summary, status: "blocked" } }),
    ["retry", "disabled", false],
  );
  assert.deepEqual(
    pick({
      ...base,
      run: { ...run, finishedAt: "2026-11-19T11:00:00Z" },
      session: live("ended", { reason: "paused", message: "p" }),
    }),
    ["resume", "disabled", false],
  );
  assert.deepEqual(pick({ ...base, run }), ["resume", "disabled", false]);
  assert.deepEqual(pick(base), ["start", "disabled", false]);
});

test("session posts send JSON with one request ID and retry once with it", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let n = 0;
  const api = createApi(
    async (input, init) => {
      calls.push({ url: String(input), init });
      if (++n === 1) throw new TypeError("network");
      return new Response(JSON.stringify({ accepted: true, duplicate: true }), {
        status: 202,
      });
    },
    () => "req-00000001",
  );
  const result = await api.session(7, "messages", {
    author: "Ann",
    text: "hi",
  });
  assert.deepEqual(result, { ok: true, duplicate: true });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, "/api/issues/7/session/messages");
    assert.equal(call.init?.method, "POST");
    assert.equal(call.init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(call.init?.body)), {
      author: "Ann",
      text: "hi",
      requestId: "req-00000001",
    });
  }
  const start = createApi(async (input) => {
    assert.equal(String(input), "/api/issues/7/session");
    return new Response("{}", { status: 202 });
  });
  assert.deepEqual(await start.session(7, "start", { author: "Ann" }), {
    ok: true,
    duplicate: false,
  });
});

test("session errors return the server's code and message", async () => {
  const api = createApi(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "session_live",
            message: "This issue already has a Web session.",
          },
        }),
        { status: 409 },
      ),
  );
  assert.deepEqual(await api.session(7, "start", { author: "Ann" }), {
    ok: false,
    status: 409,
    code: "session_live",
    message: "This issue already has a Web session.",
  });
  const offline = createApi(async () => {
    throw new TypeError("offline");
  });
  const result = await offline.session(7, "pause", { author: "Ann" });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "network_error");
});
