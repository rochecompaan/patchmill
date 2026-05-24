import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNoLegacyProjectText,
  legacyProjectPattern,
} from "./legacy-project-text.ts";

const blockedPhrases = [
  ["Crop", "run"].join(""),
  ["CROP", "RUN_"].join(""),
  [["dev", "env"].join(""), ["sh", "ell"].join("")].join(" "),
  [
    [["ju", "st"].join(""), ["ti", "lt"].join("")].join(" "),
    ["up"].join(""),
  ].join("-"),
  [
    [["ju", "st"].join(""), ["ti", "lt"].join("")].join(" "),
    ["down"].join(""),
  ].join("-"),
  [
    ["di", "rect"].join(""),
    ["kub", "ectl"].join(""),
    ["ex", "ec"].join(""),
  ].join(" "),
  ["docs", ["reference", "screenshots"].join("-"), "web", ""].join("/"),
  ["docs", ["reference", "screenshots"].join("-"), "mobile", ""].join("/"),
] as const;

test("legacyProjectPattern rejects legacy project phrases covered by generic prompt checks", () => {
  for (const phrase of blockedPhrases) {
    assert.match(phrase, legacyProjectPattern);
    assert.throws(() => assertNoLegacyProjectText(phrase));
  }
});

test("assertNoLegacyProjectText allows generic prompt text", () => {
  assert.doesNotThrow(() =>
    assertNoLegacyProjectText(
      "Use the repository's documented development toolchain and configured host tooling.",
    ),
  );
});
