import assert from "node:assert/strict";
import { test } from "node:test";
import { startWebFixture } from "../../test-support/web-fixture.ts";
import { resolveWebRoot } from "./assets.ts";

test("the served HTML, CSS, and module dependency graph contains no missing public assets", async (t) => {
  const fixture = await startWebFixture(t, { webRoot: resolveWebRoot() });
  const queue = ["/"];
  const visited = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);
    assert.equal((await fixture.request(path)).status, 401, path);
    const response = await fixture.request(path, { cookie: fixture.cookie });
    assert.equal(response.status, 200, `Missing runtime asset: ${path}`);
    const type = String(response.headers["content-type"]);
    let dependencies: string[] = [];
    if (type.startsWith("text/html"))
      dependencies = [
        ...response.body.matchAll(
          /<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi,
        ),
      ].map((m) => m[1]!);
    else if (type.startsWith("text/css"))
      dependencies = [
        ...response.body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g),
      ].map((m) => m[1]!);
    else if (type.startsWith("text/javascript"))
      dependencies = [
        ...response.body.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g),
      ].map((m) => m[1]!);
    for (const dependency of dependencies) {
      if (dependency.startsWith("#")) continue;
      const url = new URL(dependency, new URL(path, fixture.origin));
      assert.equal(
        url.origin,
        fixture.origin,
        `Foreign resource: ${dependency}`,
      );
      queue.push(url.pathname + url.search);
    }
  }
});
