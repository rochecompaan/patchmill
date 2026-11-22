import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  implement,
  plan,
  setupRun,
  spec,
} from "../../test-support/run-once-fixture.ts";
import { acquireLock, LockHeldError } from "./lock.ts";

test("a caller-held lock runs the issue and is still held after the outcome", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  const lock = await acquireLock(c.lockPath);
  try {
    assert.equal(
      (await c.run({ issue: 9, heldLock: lock })).status,
      "completed",
    );
    await assert.rejects(acquireLock(c.lockPath), LockHeldError);
  } finally {
    await lock.release();
  }
  await (await acquireLock(c.lockPath)).release();
});

test("a caller-held lock is still held when the run throws", async (t) => {
  const c = await setupRun(t);
  // The same failure as in run-once-failures.test.ts: it throws after the lock
  // block, inside the try that the finally closes.
  c.deps.git.fetch = async () => {
    const root = dirname(c.lockPath);
    const runId = (await fs.readdir(root)).find((name) => name !== "lock")!;
    await fs.mkdir(join(root, runId, "result.json"));
    throw new Error("fetch failed");
  };
  const lock = await acquireLock(c.lockPath);
  try {
    await assert.rejects(c.run({ issue: 9, heldLock: lock }), {
      code: "EISDIR",
    });
    await assert.rejects(acquireLock(c.lockPath), LockHeldError);
  } finally {
    await lock.release();
  }
});

test("the sweep does not report the issue whose lock the caller holds", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  assert.equal((await c.run({ issue: 9 })).status, "completed");
  const before = c.output.length;
  const lock = await acquireLock(c.lockPath);
  try {
    await c.run({ issue: 9, heldLock: lock });
  } finally {
    await lock.release();
  }
  assert.doesNotMatch(
    c.output.slice(before).join("\n"),
    /cleanup skipped \(active issue lock\)/,
  );
});

for (const refusal of [
  {
    name: "a held lock without an issue number",
    issue: undefined,
    path: (lockPath: string) => lockPath,
    message: /A held lock requires an issue number/,
  },
  {
    name: "a held lock for another issue",
    issue: 9,
    path: (lockPath: string) =>
      join(dirname(dirname(lockPath)), "issue-8", "lock"),
    message: /The held lock does not own issue #9's lock path/,
  },
]) {
  test(`${refusal.name} is refused before any effect`, async (t) => {
    const c = await setupRun(t);
    const lock = await acquireLock(refusal.path(c.lockPath));
    try {
      await assert.rejects(
        c.run({
          ...(refusal.issue !== undefined ? { issue: refusal.issue } : {}),
          heldLock: lock,
        }),
        refusal.message,
      );
    } finally {
      await lock.release();
    }
    assert.equal(
      c.host
        .state()
        .calls.some((call) =>
          /^(setLabels|commentIssue|viewIssue):/.test(call),
        ),
      false,
    );
    await assert.rejects(fs.stat(c.worktree), { code: "ENOENT" });
  });
}
