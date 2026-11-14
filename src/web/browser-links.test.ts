import assert from "node:assert/strict";
import { test } from "node:test";
import { safeExternalUrl, safePreviewUrl } from "../../web/links.js";

test("preview URLs cannot point at API, private files, or foreign origins", () => {
  assert.equal(safePreviewUrl("/samples/board.html"), "/samples/board.html");
  assert.equal(
    safePreviewUrl("/samples/new-preview.html"),
    "/samples/new-preview.html",
  );
  for (const value of [
    "/api/board",
    "/src/web/api-types.ts",
    "//evil.test/a",
    "https://evil.test/a",
    "data:text/html,x",
    "/samples/../index.html",
    "/samples/%2e%2e/index.html",
    "/samples/%252e%252e/index.html",
    "/samples/..%2findex.html",
    "/samples/..\\index.html",
    "/samples/not-a-preview.js",
    " /samples/board.html",
    "https://user:password@evil.test/samples/board.html",
  ])
    assert.equal(safePreviewUrl(value), null);
});
test("display links never become executable or implicit foreign-resource URLs", () => {
  assert.equal(
    safeExternalUrl("https://github.com/example/repo"),
    "https://github.com/example/repo",
  );
  for (const value of [
    "javascript:alert(1)",
    " JaVaScRiPt:alert(1)",
    "data:text/html,x",
    "//evil.test/a",
    "/relative",
    "not a url",
  ])
    assert.equal(safeExternalUrl(value), null);
});
