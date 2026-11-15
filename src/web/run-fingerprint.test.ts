import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { acquireLock } from "../kernel/lock.ts";
import { issueThreadFixture } from "../../test-support/issue-thread-fixture.ts";
import { issueFingerprint } from "./run-fingerprint.ts";
test("held-to-held lock turnover changes fingerprint with all run logs unchanged", async (t) => {
  const f = await issueThreadFixture(t);
  const first = await acquireLock(join(f.issueDir, "lock"), {
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  const before = await issueFingerprint({ ...f, issue: 9 });
  await first.release();
  const second = await acquireLock(join(f.issueDir, "lock"), {
    now: () => new Date("2026-11-14T13:00:00Z"),
  });
  t.after(() => second.release());
  assert.notEqual(await issueFingerprint({ ...f, issue: 9 }), before);
});
