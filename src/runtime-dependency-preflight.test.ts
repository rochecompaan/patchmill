import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { assertPatchmillRuntimeDependencyPins } from "./runtime-dependency-preflight.ts";

test("runtime dependency preflight accepts the installed exact pin", () => {
  assert.doesNotThrow(() => assertPatchmillRuntimeDependencyPins());
});

test("runtime dependency preflight rejects a stale installed dependency", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "patchmill-runtime-pins-"));
  const sourceDir = join(packageRoot, "src");
  mkdirSync(sourceDir);
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ dependencies: { "pi-subagents": "999.0.0" } }),
  );

  try {
    assert.throws(
      () =>
        assertPatchmillRuntimeDependencyPins(
          pathToFileURL(join(sourceDir, "sentinel.ts")).href,
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /pi-subagents resolved \S+ but package\.json pins 999\.0\.0/u,
        );
        assert.match(error.message, /Run `npm install`/u);
        return true;
      },
    );
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});
