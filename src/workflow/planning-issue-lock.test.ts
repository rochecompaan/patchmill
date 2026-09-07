import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquirePlanningIssueLock,
  assertPlanningIssueLockOwned,
  parsePlanningIssueLockRecord,
  releasePlanningIssueLock,
} from "./planning-issue-lock.ts";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const ownershipId = "123e4567-e89b-42d3-a456-426614174001";
test("acquires a mode-0600 owner lock and releases idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const lock = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId },
      {
        ownershipId,
        pid: 1234,
        hostname: "local.test",
        now: () => new Date("2026-09-07T12:00:00.000Z"),
      },
    );
    assert.equal(
      lock.path,
      join(dir, "planning-pr-v1", "locks", "issue-187.lock"),
    );
    assert.equal((await stat(lock.path)).mode & 0o777, 0o600);
    assert.deepEqual(
      Object.keys(
        parsePlanningIssueLockRecord(await readFile(lock.path, "utf8")),
      ),
      [
        "version",
        "issueNumber",
        "runId",
        "ownershipId",
        "pid",
        "hostname",
        "acquiredAt",
      ],
    );
    await assertPlanningIssueLockOwned(lock, { issueNumber: 187, runId });
    await releasePlanningIssueLock(lock);
    await releasePlanningIssueLock(lock);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("classifies competing valid local locks without takeover", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId },
      { ownershipId, pid: 1234, hostname: "local.test" },
    );
    await assert.rejects(
      acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId },
        {
          ownershipId: "123e4567-e89b-42d3-a456-426614174002",
          hostname: "local.test",
          processState: () => "dead",
        },
      ),
      (error: unknown) =>
        (error as { diagnostic?: { classification?: string } }).diagnostic
          ?.classification === "stale",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
