import assert from "node:assert/strict";
import { test } from "node:test";
import { readName, saveName, preferredTheme } from "../../web/preferences.js";
test("preferences tolerate unavailable storage and validate browser-local names", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  assert.equal(readName(storage), null);
  assert.equal(saveName(storage, "  Naledi  "), "Naledi");
  assert.equal(readName(storage), "Naledi");
  for (const name of ["", " ".repeat(10), "a".repeat(33)])
    assert.throws(() => saveName(storage, name));
  assert.equal(preferredTheme(storage, true), "light");
  map.set("patchmill-theme", "invalid");
  assert.equal(preferredTheme(storage, false), "dark");
  map.set("patchmill-theme", "light");
  assert.equal(preferredTheme(storage, false), "light");
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.equal(readName(blocked), null);
  assert.equal(saveName(blocked, "roche"), "roche");
  assert.equal(preferredTheme(blocked, true), "light");
});
