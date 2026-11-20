import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { startWebFixture } from "../../test-support/web-fixture.ts";
import type { RunDataSource } from "./run-data.ts";
import { createSampleRunDataSource } from "./sample-data.ts";

const DOCUMENT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";
const ID = "mockup-0123456789ab";

async function fixture(t: TestContext) {
  const calls: [number, string][] = [];
  const source: RunDataSource = {
    ...createSampleRunDataSource(),
    async documentFile(issue, id) {
      calls.push([issue, id]);
      return issue === 9 && id === ID
        ? {
            body: Buffer.from("<p>m</p>"),
            contentType: "text/html; charset=utf-8",
          }
        : null;
    },
  };
  return { ...(await startWebFixture(t, { source })), calls };
}

test("file route serves listed HTML with the document CSP", async (t) => {
  const f = await fixture(t);
  const r = await f.request(`/files/issues/9/${ID}`, { cookie: f.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body, "<p>m</p>");
  assert.equal(r.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(r.headers["content-security-policy"], DOCUMENT_CSP);
  assert.equal(r.headers["cache-control"], "no-store");
  const head = await f.request(`/files/issues/9/${ID}`, {
    method: "HEAD",
    cookie: f.cookie,
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
});

test("file route refuses unknown ids and methods", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/files/issues/9/mockup-ffffffffffff",
    "/files/issues/9/spec",
    `/files/issues/0/${ID}`,
    `/files/issues/10/${ID}`,
    `/files/issues/09/${ID}`,
  ]) {
    const r = await f.request(path, { cookie: f.cookie });
    assert.equal(r.status, 404, path);
    assert.equal(r.body, "Not found.");
    assert.doesNotMatch(r.headers["content-security-policy"]!, /allow-scripts/);
  }
  assert.deepEqual(
    f.calls.map((c) => c[1]),
    ["mockup-ffffffffffff", ID],
    "only well-formed ids reach the source",
  );
  const post = await f.request(`/files/issues/9/${ID}`, {
    method: "POST",
    cookie: f.cookie,
    headers: { Origin: f.origin },
  });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
});

test("file route refuses path-like ids", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/files/issues/9/..%2fpackage.json",
    `/files/issues/9/${ID}/x`,
    "/files/issues/9/%2e%2e",
    "/files/issues/9/../../package.json",
    "/files/package.json",
  ]) {
    const r = await f.request(path, { cookie: f.cookie });
    assert.equal(r.status, 404, path);
  }
  assert.deepEqual(f.calls, []);
});

test("file route needs authentication", async (t) => {
  const f = await fixture(t);
  const r = await f.request(`/files/issues/9/${ID}`);
  assert.equal(r.status, 401);
  assert.deepEqual(f.calls, []);
});

test("sample mode has no file route", async (t) => {
  const f = await startWebFixture(t);
  const r = await f.request(`/files/issues/9/${ID}`, { cookie: f.cookie });
  assert.equal(r.status, 404);
});
