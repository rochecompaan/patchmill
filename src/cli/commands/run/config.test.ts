import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRunStateCommandConfig } from "./config.ts";
test("loads run-state configuration without Git or a host provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-run-config-"));
  await writeFile(
    join(root, "patchmill.config.json"),
    JSON.stringify({ paths: { runStateDir: ".state" } }),
  );
  const config = await loadRunStateCommandConfig([], root, {});
  assert.equal(config.repoRoot, root);
  assert.equal(config.runStateDir, join(root, ".state"));
});
