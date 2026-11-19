import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  acquireConsoleLock,
  consoleLockHeld,
  consoleLockPath,
} from "./console-lock.ts";

test("a second acquire sees the Console session lock as held", async (t) => {
  // flock belongs to the open file description, so a second open in this
  // process conflicts as another process would.
  const root = await mkdtemp(join(tmpdir(), "patchmill-console-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(
    consoleLockPath(root, ".patchmill/runs", 7),
    join(root, ".patchmill/runs/issue-7/console/lock"),
  );
  assert.equal(await consoleLockHeld(root, ".patchmill/runs", 7), false);
  const first = await acquireConsoleLock(root, ".patchmill/runs", 7);
  assert.ok(first);
  assert.equal(await consoleLockHeld(root, ".patchmill/runs", 7), true);
  assert.equal(await acquireConsoleLock(root, ".patchmill/runs", 7), undefined);
  await first.release();
  assert.equal(await consoleLockHeld(root, ".patchmill/runs", 7), false);
  const again = await acquireConsoleLock(root, ".patchmill/runs", 7);
  assert.ok(again);
  await again.release();
});
