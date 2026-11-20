import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocumentCache } from "./document-cache.ts";

const doc = { blocks: [], title: "t", links: [] };

test("the cache keeps at most 64 entries, oldest out first", () => {
  const cache = createDocumentCache();
  for (let n = 0; n < 65; n++) cache.setMarkdown(`sha${n}`, doc, 10);
  assert.equal(cache.markdown("sha0"), undefined);
  assert.equal(cache.markdown("sha64"), doc);
  assert.equal(cache.markdown("sha1"), doc);
});

test("the cache keeps at most 32 MiB", () => {
  const cache = createDocumentCache();
  const body = Buffer.alloc(12 * 1024 * 1024);
  for (const sha of ["a", "b", "c"]) cache.setHtml(sha, body);
  assert.equal(cache.html("a"), undefined);
  assert.equal(cache.html("b"), body);
  assert.equal(cache.html("c"), body);
  cache.setHtml("huge", Buffer.alloc(33 * 1024 * 1024));
  assert.equal(cache.html("huge"), undefined);
  assert.equal(cache.html("c"), body);
});

test("Markdown and HTML entries of one blob do not collide", () => {
  const cache = createDocumentCache();
  const body = Buffer.from("<p>x</p>");
  cache.setMarkdown("sha", doc, 10);
  cache.setHtml("sha", body);
  assert.equal(cache.markdown("sha"), doc);
  assert.equal(cache.html("sha"), body);
});

test("warnings are once for each blob", () => {
  const cache = createDocumentCache();
  assert.equal(cache.firstWarning("sha"), true);
  assert.equal(cache.firstWarning("sha"), false);
});
