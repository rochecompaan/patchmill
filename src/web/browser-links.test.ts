import assert from "node:assert/strict";
import { test } from "node:test";
import {
  previewSandbox,
  remainingDocumentLinks,
  safeExternalUrl,
  safePreviewUrl,
} from "../../web/links.js";

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

test("preview URLs accept server-issued Issue document files only", () => {
  for (const value of [
    "/files/issues/384/mockup-0123456789ab",
    "/files/issues/1/diagram-abcdefabcdef",
  ])
    assert.equal(safePreviewUrl(value), value);
  for (const value of [
    "/files/issues/0/mockup-0123456789ab",
    "/files/issues/09/mockup-0123456789ab",
    "/files/issues/9/spec",
    "/files/issues/9/mockup-0123",
    "/files/issues/9/mockup-0123456789ab/x",
    "/files/issues/9/MOCKUP-0123456789ab",
    "/files/issues/9/mockup-0123456789ab?x",
    "/files/issues/9/..%2fpackage.json",
    "/files/../index.html",
  ])
    assert.equal(safePreviewUrl(value), null, value);
});
test("Issue document frames get scripts without same-origin access", () => {
  assert.equal(
    previewSandbox("/files/issues/9/mockup-0123456789ab"),
    "allow-scripts",
  );
  assert.equal(previewSandbox("/samples/board.html"), "allow-same-origin");
});
test("host document links are hidden when the viewer has the document", () => {
  const spec = { kind: "spec" as const, url: "https://host/spec" };
  const plan = { kind: "plan" as const, url: "https://host/plan" };
  assert.deepEqual(remainingDocumentLinks([spec, plan], [{ kind: "spec" }]), [
    plan,
  ]);
  assert.deepEqual(remainingDocumentLinks([spec, plan], []), [spec, plan]);
});
