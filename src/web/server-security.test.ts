import assert from "node:assert/strict";
import { test } from "node:test";
import { startWebFixture } from "../../test-support/web-fixture.ts";
test("authentication gates page, API, assets, previews, unknown routes, and HEAD", async (t) => {
  const f = await startWebFixture(t);
  for (const path of [
    "/",
    "/api/board",
    "/app.js",
    "/fonts/atkinson-hyperlegible-next.woff2",
    "/samples/board.html",
    "/missing",
    "/api/board?token=test-token",
  ])
    for (const method of ["GET", "HEAD"]) {
      const r = await f.request(path, { method });
      assert.equal(r.status, 401, path);
      assert.equal(r.headers["cache-control"], "no-store");
      assert.ok(r.headers["content-security-policy"]);
      if (method === "HEAD") assert.equal(r.body, "");
      else assert.match(r.body, /printed/);
    }
  const login = await f.request("/?view=board&token=test-token");
  assert.equal(login.status, 303);
  assert.equal(login.headers.location, "/?view=board");
  assert.match(
    login.headers["set-cookie"]![0]!,
    /HttpOnly; SameSite=Strict; Path=\//,
  );
  assert.equal(login.body.includes("test-token"), false);
  assert.equal(
    (await f.request("/?token=wrong", { cookie: f.cookie })).status,
    401,
  );
  assert.equal(
    (await f.request("/?token=test-token", { method: "HEAD" })).status,
    401,
  );
});
test("Host and Origin checks precede authentication and provider access", async (t) => {
  let calls = 0;
  const f = await startWebFixture(t, {
    source: {
      snapshot: async () => {
        calls++;
        throw Error("private");
      },
      subscribe: () => () => {},
    },
  });
  assert.equal(
    (await f.request("/?token=test-token", { headers: { Host: "evil.test" } }))
      .status,
    421,
  );
  for (const origin of [undefined, "https://evil.test", "null"]) {
    const r = await f.request("/api/board", {
      method: "POST",
      cookie: f.cookie,
      headers: origin ? { Origin: origin } : {},
    });
    assert.equal(r.status, 403);
    assert.ok(r.headers["content-security-policy"]);
  }
  const same = await f.request("/api/board", {
    method: "POST",
    cookie: f.cookie,
    headers: { Origin: f.origin },
  });
  assert.equal(same.status, 405);
  assert.equal(same.headers.allow, "GET, HEAD");
  assert.equal(calls, 0);
  assert.match(await f.rawRequest("GET / HTTP/1.0\r\n\r\n"), /421/);
  assert.match(
    await f.rawRequest(
      "GET / HTTP/1.1\r\nHost: localhost:" +
        new URL(f.origin).port +
        "\r\nHost: evil.test\r\nConnection: close\r\n\r\n",
    ),
    /421|400/,
  );
});
test("authenticated paths remain confined and HEAD is bodyless", async (t) => {
  const f = await startWebFixture(t);
  for (const path of [
    "/../package.json",
    "/%2e%2e/package.json",
    "/%252e%252e/package.json",
    "/a/../index.html",
    "/..%2fpackage.json",
    "/%00",
    "/%zz",
    "/src/web/api-types.ts",
  ])
    assert.equal(
      (await f.request(path, { cookie: f.cookie })).status,
      404,
      path,
    );
  for (const path of [
    "/",
    "/app.js",
    "/api/board",
    "/missing",
    "/api/issues/0",
  ]) {
    const get = await f.request(path, { cookie: f.cookie }),
      head = await f.request(path, { cookie: f.cookie, method: "HEAD" });
    assert.equal(head.status, get.status);
    assert.equal(head.body, "");
    assert.equal(head.headers["content-type"], get.headers["content-type"]);
    assert.equal(head.headers["content-length"], get.headers["content-length"]);
  }
  const preview = await f.request("/samples/board.html", { cookie: f.cookie });
  assert.equal(preview.status, 200);
  assert.match(
    preview.headers["content-security-policy"]!,
    /sandbox allow-same-origin/,
  );
});
