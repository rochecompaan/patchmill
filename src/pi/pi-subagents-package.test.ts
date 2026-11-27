import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { packageRootFromEntry } from "./pi-subagents-package.ts";

function withPackage(
  entry: string,
  run: (root: string, entryPath: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-root-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "pi-subagents", version: "1.0.0" }),
    );
    const entryPath = join(root, entry);
    mkdirSync(join(entryPath, ".."), { recursive: true });
    writeFileSync(entryPath, "");
    run(root, entryPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("package root is found when the entry sits at the package root", () => {
  withPackage("index.js", (root, entryPath) => {
    assert.equal(packageRootFromEntry(entryPath), root);
  });
});

test("package root is found when the entry sits in a subdirectory", () => {
  withPackage("bundle/index.js", (root, entryPath) => {
    assert.equal(packageRootFromEntry(entryPath), root);
  });
});

test("package root lookup skips nested package.json files for other packages", () => {
  withPackage("bundle/index.js", (root, entryPath) => {
    writeFileSync(
      join(root, "bundle", "package.json"),
      JSON.stringify({ type: "module" }),
    );
    assert.equal(packageRootFromEntry(entryPath), root);
  });
});

test("package root lookup fails clearly when no pi-subagents manifest exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-missing-"));
  try {
    assert.throws(
      () => packageRootFromEntry(join(dir, "index.js")),
      /Unable to find the pi-subagents package root/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
