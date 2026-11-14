import assert from "node:assert/strict";
import { test } from "node:test";
import { safeExternalUrl } from "../../web/links.js";
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
