import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { startWebFixture } from "../../../test-support/web-fixture.ts";
import { sessionRoute } from "./routes.ts";
import type { HubResult, SessionHub } from "./types.ts";

type Call = { method: string; issue: number; input: unknown };

function fakeHub(result: HubResult = { ok: true, duplicate: false }) {
  const calls: Call[] = [];
  let closed = Promise.resolve();
  const record =
    (method: string) =>
    (issue: number, input: unknown): HubResult => {
      calls.push({ method, issue, input });
      return result;
    };
  const hub: SessionHub = {
    start: async (issue, input) => record("start")(issue, input),
    send: record("send"),
    answer: record("answer"),
    stopReply: record("stopReply"),
    pause: record("pause"),
    current: () => null,
    subscribe: () => () => {},
    close: () => closed,
  };
  return {
    hub,
    calls,
    holdClose(promise: Promise<void>) {
      closed = promise;
    },
  };
}

const person = { author: "Ann", requestId: "req-00001" };

async function setup(t: TestContext, result?: HubResult) {
  const fake = fakeHub(result);
  const web = await startWebFixture(t, { sessions: fake.hub });
  const post = (
    path: string,
    body: unknown,
    options: {
      origin?: string | null;
      cookie?: string | null;
      type?: string;
    } = {},
  ) =>
    web.request(path, {
      method: "POST",
      ...(options.cookie === null
        ? {}
        : { cookie: options.cookie ?? web.cookie }),
      headers: {
        "Content-Type": options.type ?? "application/json",
        ...(options.origin === null
          ? {}
          : { Origin: options.origin ?? web.origin }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { ...fake, web, post };
}

test("sessionRoute recognises the five session paths only", () => {
  assert.deepEqual(sessionRoute("/api/issues/7/session"), {
    issue: "7",
    action: "start",
  });
  for (const action of ["messages", "answers", "stop-reply", "pause"])
    assert.deepEqual(sessionRoute(`/api/issues/7/session/${action}`), {
      issue: "7",
      action,
    });
  assert.equal(sessionRoute("/api/issues/7/session/other"), null);
  assert.equal(sessionRoute("/api/issues/7/events"), null);
});

test("session routes need the cookie", async (t) => {
  const s = await setup(t);
  const response = await s.post("/api/issues/7/session", person, {
    cookie: null,
  });
  assert.equal(response.status, 401);
  assert.equal(s.calls.length, 0);
});

test("session routes need a matching Origin", async (t) => {
  const s = await setup(t);
  for (const origin of [null, "http://evil.test"]) {
    const response = await s.post("/api/issues/7/session", person, { origin });
    assert.equal(response.status, 403);
  }
  assert.equal(s.calls.length, 0);
});

test("sample servers have no session routes", async (t) => {
  const web = await startWebFixture(t);
  const response = await web.request("/api/issues/7/session", {
    method: "POST",
    cookie: web.cookie,
    headers: { "Content-Type": "application/json", Origin: web.origin },
    body: JSON.stringify(person),
  });
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).error.code, "not_found");
});

test("a valid start returns 202 and a retry is a duplicate", async (t) => {
  const s = await setup(t);
  const response = await s.post("/api/issues/7/session", {
    ...person,
    author: "  Ann  ",
    extra: true,
  });
  assert.equal(response.status, 202);
  assert.deepEqual(JSON.parse(response.body), {
    accepted: true,
    duplicate: false,
  });
  assert.deepEqual(s.calls, [
    {
      method: "start",
      issue: 7,
      input: { author: "Ann", requestId: "req-00001" },
    },
  ]);
  const duplicate = await setup(t, { ok: true, duplicate: true });
  const again = await duplicate.post("/api/issues/7/session", person);
  assert.deepEqual(JSON.parse(again.body), { accepted: true, duplicate: true });
});

test("each action reaches its hub call with its fields", async (t) => {
  const s = await setup(t);
  await s.post("/api/issues/7/session/messages", { ...person, text: "hi" });
  await s.post("/api/issues/7/session/answers", {
    ...person,
    questionId: "d1",
    choice: "Approve",
  });
  await s.post("/api/issues/7/session/stop-reply", person);
  await s.post("/api/issues/7/session/pause", person);
  assert.deepEqual(
    s.calls.map((c) => [c.method, c.input]),
    [
      ["send", { ...person, text: "hi" }],
      ["answer", { ...person, questionId: "d1", choice: "Approve" }],
      ["stopReply", person],
      ["pause", person],
    ],
  );
});

test("bodies are validated before the hub sees them", async (t) => {
  const s = await setup(t);
  const check = async (
    path: string,
    body: unknown,
    status: number,
    code: string,
    type?: string,
  ) => {
    const response = await s.post(path, body, type ? { type } : {});
    assert.equal(response.status, status, JSON.stringify(body).slice(0, 80));
    assert.equal(JSON.parse(response.body).error.code, code);
  };
  await check(
    "/api/issues/7/session",
    person,
    415,
    "unsupported_media_type",
    "text/plain",
  );
  await check(
    "/api/issues/7/session/messages",
    { ...person, text: "x".repeat(70 * 1024) },
    413,
    "too_large",
  );
  for (const author of [
    "",
    "a\u0007",
    " /patchmill-web-session-stop x",
    5,
    "a".repeat(81),
  ])
    await check(
      "/api/issues/7/session",
      { ...person, author },
      400,
      "invalid_author",
    );
  await check(
    "/api/issues/7/session",
    { ...person, requestId: "x" },
    400,
    "invalid_request",
  );
  await check(
    "/api/issues/7/session/messages",
    { ...person, text: "  " },
    400,
    "invalid_request",
  );
  await check(
    "/api/issues/7/session/answers",
    { ...person, questionId: "d1" },
    400,
    "invalid_request",
  );
  await check("/api/issues/7/session", "not json", 400, "invalid_request");
  await check("/api/issues/7/session", [1], 400, "invalid_request");
  await check("/api/issues/0/session", person, 400, "invalid_issue");
  assert.equal(s.calls.length, 0);
  const charset = await s.post("/api/issues/7/session", person, {
    type: "application/json; charset=utf-8",
  });
  assert.equal(charset.status, 202);
});

test("hub refusals map to 409 with their code and message", async (t) => {
  const s = await setup(t, {
    ok: false,
    code: "session_live",
    message: "This issue already has a Web session.",
  });
  const response = await s.post("/api/issues/7/session", person);
  assert.equal(response.status, 409);
  assert.deepEqual(JSON.parse(response.body), {
    error: {
      code: "session_live",
      message: "This issue already has a Web session.",
    },
  });
  const invalid = await setup(t, {
    ok: false,
    code: "invalid_choice",
    message: "No.",
  });
  const answer = await invalid.post("/api/issues/7/session/answers", {
    ...person,
    questionId: "d1",
    choice: "B",
  });
  assert.equal(answer.status, 400);
});

test("only POST is allowed", async (t) => {
  const s = await setup(t);
  const response = await s.web.request("/api/issues/7/session", {
    cookie: s.web.cookie,
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, "POST");
  assert.equal(s.calls.length, 0);
});

test("server close waits for the hub to close", async (t) => {
  const s = await setup(t);
  const hub = Promise.withResolvers<void>();
  s.holdClose(hub.promise);
  let closed = false;
  const closing = s.web.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, false);
  hub.resolve();
  await closing;
  assert.equal(closed, true);
});
