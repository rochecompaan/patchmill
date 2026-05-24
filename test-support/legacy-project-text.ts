import assert from "node:assert/strict";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const legacyReferenceScreenshots = ["reference", "screenshots"].join("-");

const legacyProjectTerms = [
  ["Crop", "run"].join(""),
  ["CROP", "RUN_"].join(""),
  [["dev", "env"].join(""), ["sh", "ell"].join("")].join(" "),
  [["ju", "st"].join(""), ["ti", "lt"].join("")].join(" "),
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
  ["docs", legacyReferenceScreenshots].join("/"),
  ["docs", legacyReferenceScreenshots, "web"].join("/"),
  ["docs", legacyReferenceScreenshots, "mobile"].join("/"),
] as const;

export const legacyProjectPattern = new RegExp(
  legacyProjectTerms.map(escapeRegExp).join("|"),
  "i",
);

export function assertNoLegacyProjectText(text: string): void {
  assert.doesNotMatch(text, legacyProjectPattern);
}
