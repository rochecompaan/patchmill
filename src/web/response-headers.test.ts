import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { setResponseHeaders } from "./response-headers.ts";

const DOCUMENT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";

test("responses carry restrictive CSP, no cache, no referrer, and nosniff", async (t) => {
  const server = createServer((req, res) => {
    setResponseHeaders(
      res,
      req.url === "/preview"
        ? "sample"
        : req.url === "/document"
          ? "document"
          : "app",
    );
    res.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") assert.fail();
  for (const path of ["/", "/preview", "/document"]) {
    const r = await fetch(`http://127.0.0.1:${address.port}${path}`);
    await r.text();
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    const csp = r.headers.get("content-security-policy")!;
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/);
    if (path === "/document") {
      assert.equal(csp, DOCUMENT_CSP);
      assert.doesNotMatch(csp, /allow-same-origin/);
      continue;
    }
    assert.doesNotMatch(csp, /unsafe-inline/);
    if (path === "/preview") {
      assert.match(csp, /script-src 'none'/);
      assert.match(csp, /connect-src 'none'/);
      assert.match(csp, /sandbox allow-same-origin/);
    } else assert.match(csp, /script-src 'self'/);
  }
});
