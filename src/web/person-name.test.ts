import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePersonName } from "./person-name.ts";

test("names are trimmed, NFC-normalized and limited to 80 code points", () => {
  assert.equal(parsePersonName(" Ana "), "Ana");
  assert.equal(parsePersonName("Å"), "Å");
  assert.equal(parsePersonName("Å"), "Å");
  assert.equal(parsePersonName("é".repeat(80)), "é".repeat(80));
  assert.equal(parsePersonName("\u{1f600}".repeat(80)), "\u{1f600}".repeat(80));
});

test("empty, slash-led, control-character and non-text names are refused", () => {
  for (const value of ["", "   ", "/x", " /x", "a\u0007", "a\tb", 42, null])
    assert.equal(parsePersonName(value), null);
  assert.equal(parsePersonName("a".repeat(81)), null);
});
