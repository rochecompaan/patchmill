import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PlanningIssueLockConflictError,
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
test("propagates unexpected process liveness failures", async () => {
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
          processState: () => {
            throw new Error("liveness failed");
          },
        },
      ),
      /liveness failed/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("concurrent acquisition permits exactly one ownership ID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const results = await Promise.allSettled([
      acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId },
        { ownershipId, hostname: "local.test" },
      ),
      acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId },
        {
          ownershipId: "123e4567-e89b-42d3-a456-426614174002",
          hostname: "local.test",
          processState: () => "alive",
        },
      ),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    const winner = results.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof acquirePlanningIssueLock>>
      > => result.status === "fulfilled",
    );
    assert.ok(winner);
    await releasePlanningIssueLock(winner.value);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing lock diagnostics classify safely and fingerprint exact bytes", async () => {
  const cases = [
    {
      ownerHost: "local.test",
      requesterHost: "local.test",
      state: "alive" as const,
      expected: "active",
    },
    {
      ownerHost: "local.test",
      requesterHost: "local.test",
      state: "dead" as const,
      expected: "stale",
    },
    {
      ownerHost: "local.test",
      requesterHost: "local.test",
      state: "unverifiable" as const,
      expected: "unverifiable",
    },
    {
      ownerHost: "remote.test",
      requesterHost: "local.test",
      state: "alive" as const,
      expected: "unverifiable",
    },
  ];
  for (const item of cases) {
    const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
    try {
      const lock = await acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId },
        {
          ownershipId,
          pid: 1234,
          hostname: item.ownerHost,
          now: () => new Date("2026-09-07T12:00:00.000Z"),
        },
      );
      const bytes = await readFile(lock.path, "utf8");
      let processChecks = 0;
      await assert.rejects(
        acquirePlanningIssueLock(
          dir,
          { issueNumber: 187, runId },
          {
            ownershipId: "123e4567-e89b-42d3-a456-426614174002",
            hostname: item.requesterHost,
            processState: () => {
              processChecks += 1;
              return item.state;
            },
          },
        ),
        (error: unknown) => {
          assert.ok(error instanceof PlanningIssueLockConflictError);
          assert.equal(error.diagnostic.classification, item.expected);
          assert.equal(
            error.diagnostic.fingerprint,
            createHash("sha256").update(bytes).digest("hex"),
          );
          assert.deepEqual(error.diagnostic.owner, {
            issueNumber: 187,
            runId,
            pid: 1234,
            hostname: item.ownerHost,
            acquiredAt: "2026-09-07T12:00:00.000Z",
          });
          assert.equal("ownershipId" in (error.diagnostic.owner ?? {}), false);
          return true;
        },
      );
      assert.equal(
        processChecks,
        item.ownerHost === item.requesterHost ? 1 : 0,
      );
      await releasePlanningIssueLock(lock);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("malformed or replaced lock bytes are fingerprinted and never removed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const lock = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId },
      { ownershipId, hostname: "local.test" },
    );
    const malformed = "{not-json\n";
    await writeFile(lock.path, malformed);
    await assert.rejects(
      acquirePlanningIssueLock(dir, { issueNumber: 187, runId }),
      (error: unknown) =>
        error instanceof PlanningIssueLockConflictError &&
        error.diagnostic.classification === "malformed" &&
        error.diagnostic.fingerprint ===
          createHash("sha256").update(malformed).digest("hex"),
    );
    await assert.rejects(releasePlanningIssueLock(lock));
    assert.equal(await readFile(lock.path, "utf8"), malformed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed binary lock fingerprints the exact on-disk bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const lock = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId },
      { ownershipId, hostname: "local.test" },
    );
    const bytes = Buffer.from([0xff, 0xfe, 0x7b, 0x0a]);
    await writeFile(lock.path, bytes);
    await assert.rejects(
      acquirePlanningIssueLock(dir, { issueNumber: 187, runId }),
      (error: unknown) =>
        error instanceof PlanningIssueLockConflictError &&
        error.diagnostic.classification === "malformed" &&
        error.diagnostic.fingerprint ===
          createHash("sha256").update(bytes).digest("hex"),
    );
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
