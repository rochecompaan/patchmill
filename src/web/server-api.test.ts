import assert from "node:assert/strict";
import { test } from "node:test";
import { startWebFixture } from "../../test-support/web-fixture.ts";
import { createSampleRunDataSource } from "./sample-data.ts";
import { resolveWebRoot } from "./assets.ts";

test("a mapped IPv6 listener authenticates its printed token link", async (t) => {
  let f;
  try {
    f = await startWebFixture(t, { host: "::ffff:127.0.0.1" });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(String(error.code))
    ) {
      t.skip("IPv6 is unavailable");
      return;
    }
    throw error;
  }
  const url = new URL(f.url);
  assert.equal((await f.request(url.pathname + url.search)).status, 303);
  assert.equal(f.networkExposed, false);
  assert.equal(
    (await f.request("/api/board", { cookie: f.cookie })).status,
    200,
  );
});

test("all sample preview resources serve locally behind authentication", async (t) => {
  const f = await startWebFixture(t, { webRoot: resolveWebRoot() });
  const snapshot = await createSampleRunDataSource().snapshot();
  const urls = new Set<string>(["/samples/preview.css"]);
  for (const detail of Object.values(snapshot.details))
    for (const artifact of detail.artifacts) {
      if (artifact.preview.kind === "page") urls.add(artifact.preview.url);
      if (artifact.preview.kind === "gallery")
        artifact.preview.shots.forEach((s) => urls.add(s.url));
    }
  for (const url of urls) {
    assert.equal((await f.request(url)).status, 401);
    const r = await f.request(url, { cookie: f.cookie });
    assert.equal(r.status, 200, url);
    if (url.endsWith(".html")) {
      assert.match(r.headers["content-security-policy"]!, /script-src 'none'/);
      assert.match(r.headers["content-security-policy"]!, /connect-src 'none'/);
      assert.match(
        r.headers["content-security-policy"]!,
        /sandbox allow-same-origin/,
      );
    }
    if (url.endsWith(".png"))
      assert.equal(r.headers["content-type"], "image/png");
  }
});
import type { BoardResponse, IssueResponse } from "./api-types.ts";
test("API returns typed board and matching issue details from one snapshot per request", async (t) => {
  const source = createSampleRunDataSource();
  let calls = 0;
  const f = await startWebFixture(t, {
    source: {
      snapshot: () => {
        calls++;
        return source.snapshot();
      },
      subscribe: source.subscribe,
    },
  });
  const r = await f.request("/api/board", { cookie: f.cookie });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"]!, /application\/json/);
  const board = JSON.parse(r.body) as BoardResponse;
  assert.equal(board.schemaVersion, 1);
  assert.equal(board.source, "sample");
  assert.equal(board.syncedAt, null);
  assert.equal(calls, 1);
  for (const issue of board.issues) {
    const detail = JSON.parse(
      (await f.request("/api/issues/" + issue.number, { cookie: f.cookie }))
        .body,
    ) as IssueResponse;
    assert.deepEqual(detail.issue.summary, issue);
    assert.ok(Array.isArray(detail.issue.thread));
    assert.ok(Array.isArray(detail.issue.artifacts));
  }
  assert.equal(calls, board.issues.length + 1);
  await f.request("/", { cookie: f.cookie });
  assert.equal(calls, board.issues.length + 1);
  for (const path of [
    "/api/issues/0",
    "/api/issues/1.5",
    "/api/issues/9007199254740992",
  ])
    assert.equal((await f.request(path, { cookie: f.cookie })).status, 400);
  for (const path of ["/api/issues/999999", "/api/nope"])
    assert.equal((await f.request(path, { cookie: f.cookie })).status, 404);
  await f.close();
  await f.close();
  await f.closed;
});
test("provider failure is sanitized while retaining response security headers", async (t) => {
  const f = await startWebFixture(t, {
    source: {
      snapshot: async () => {
        throw Error("/private/token-secret");
      },
      subscribe: () => () => {},
    },
  });
  const r = await f.request("/api/board", { cookie: f.cookie });
  assert.equal(r.status, 500);
  assert.equal(JSON.parse(r.body).error.code, "internal_error");
  assert.doesNotMatch(r.body, /private|token-secret/);
  assert.equal(r.headers["referrer-policy"], "no-referrer");
});
