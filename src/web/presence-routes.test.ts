import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { startWebFixture } from "../../test-support/web-fixture.ts";
import { feedClock } from "../../test-support/feed-clock.ts";
import { createPresence } from "./presence.ts";
import { typingRoute } from "./presence-routes.ts";

async function setup(t: TestContext, withPresence = true) {
  const presence = createPresence({ clock: feedClock() });
  const lists: string[][] = [];
  presence.join(7, "Ann", (people) =>
    lists.push(people.map((p) => (p.typing ? p.name + "*" : p.name))),
  );
  const web = await startWebFixture(t, withPresence ? { presence } : {});
  const post = (
    body: unknown,
    options: {
      origin?: string | null;
      cookie?: string | null;
      type?: string;
      path?: string;
    } = {},
  ) =>
    web.request(options.path ?? "/api/issues/7/typing", {
      method: "POST",
      ...(options.cookie === null ? {} : { cookie: web.cookie }),
      headers: {
        "Content-Type": options.type ?? "application/json",
        ...(options.origin === null
          ? {}
          : { Origin: options.origin ?? web.origin }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { web, post, lists };
}
const ann = { author: "Ann", typing: true };
const code = (r: { body: string }) => JSON.parse(r.body).error.code;

test("typingRoute recognises the typing path only", () => {
  assert.equal(typingRoute("/api/issues/7/typing"), "7");
  assert.equal(typingRoute("/api/issues/7/typing/x"), null);
  assert.equal(typingRoute("/api/issues/7/events"), null);
});

test("typing needs the cookie", async (t) => {
  const s = await setup(t);
  assert.equal((await s.post(ann, { cookie: null })).status, 401);
  assert.equal(s.lists.length, 1);
});

test("typing needs a matching Origin", async (t) => {
  const s = await setup(t);
  for (const origin of [null, "http://evil.test"])
    assert.equal((await s.post(ann, { origin })).status, 403);
  assert.equal(s.lists.length, 1);
});

test("only POST is allowed", async (t) => {
  const s = await setup(t);
  const r = await s.web.request("/api/issues/7/typing", {
    cookie: s.web.cookie,
  });
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, "POST");
});

test("sample servers have no typing route", async (t) => {
  const s = await setup(t, false);
  const r = await s.post(ann);
  assert.equal(r.status, 404);
  assert.equal(code(r), "not_found");
});

test("bodies are validated", async (t) => {
  const s = await setup(t);
  const bad = await s.post(ann, { path: "/api/issues/0/typing" });
  assert.equal(bad.status, 400);
  assert.equal(code(bad), "invalid_issue");
  assert.equal((await s.post(ann, { type: "text/plain" })).status, 415);
  const large = await s.post({ ...ann, pad: "x".repeat(5000) });
  assert.equal(large.status, 413);
  assert.equal(large.headers.connection, "close");
  for (const body of [
    "[]",
    { author: "Ann", typing: "yes" },
    { author: "Ann" },
  ]) {
    const r = await s.post(body);
    assert.equal(r.status, 400);
    assert.equal(code(r), "invalid_request");
  }
  const author = await s.post({ author: "/x", typing: true });
  assert.equal(author.status, 400);
  assert.equal(code(author), "invalid_author");
  assert.equal(s.lists.length, 1);
});

test("a present name sets and clears typing", async (t) => {
  const s = await setup(t);
  const on = await s.post(ann);
  assert.equal(on.status, 202);
  assert.deepEqual(JSON.parse(on.body), { accepted: true });
  assert.deepEqual(s.lists.at(-1), ["Ann*"]);
  const off = await s.post({ author: " Ann ", typing: false });
  assert.equal(off.status, 202);
  assert.deepEqual(s.lists.at(-1), ["Ann"]);
});

test("an absent name is refused", async (t) => {
  const s = await setup(t);
  const r = await s.post({ author: "Bob", typing: true });
  assert.equal(r.status, 409);
  assert.equal(code(r), "not_present");
  assert.equal(s.lists.length, 1);
});
