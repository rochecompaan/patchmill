import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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
const replacementRunId = "123e4567-e89b-42d3-a456-426614174002";
const replacementOwnershipId = "123e4567-e89b-42d3-a456-426614174003";
const transitionOwnershipId = "123e4567-e89b-42d3-a456-426614174004";

async function ownerBytes(path: string): Promise<Buffer> {
  return readFile(join(path, "owner.record"));
}

async function installLegacyLock(input: {
  directory: string;
  issueNumber: number;
  bytes: Buffer;
}): Promise<string> {
  const path = join(
    input.directory,
    "planning-pr-v1",
    "locks",
    `issue-${input.issueNumber}.lock`,
  );
  await mkdir(join(input.directory, "planning-pr-v1", "locks"), {
    recursive: true,
  });
  await writeFile(path, input.bytes, { mode: 0o600 });
  return path;
}

test("acquires a complete mode-0600 ownership directory and retires it on release", async () => {
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
    assert.equal((await stat(lock.path)).isDirectory(), true);
    assert.equal(
      (await stat(join(lock.path, "owner.record"))).mode & 0o777,
      0o600,
    );
    assert.deepEqual(
      Object.keys(
        parsePlanningIssueLockRecord(
          (await ownerBytes(lock.path)).toString("utf8"),
        ),
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
    await assert.rejects(stat(lock.path));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archives a provably stale legacy file byte-for-byte before replacing it with a directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const staleRecord = {
      version: 1,
      issueNumber: 187,
      runId,
      ownershipId,
      pid: 1234,
      hostname: "local.test",
      acquiredAt: "2026-09-07T12:00:00.000Z",
    };
    const staleBytes = Buffer.from(`${JSON.stringify(staleRecord)}\n`);
    const canonicalPath = await installLegacyLock({
      directory: dir,
      issueNumber: 187,
      bytes: staleBytes,
    });
    const replacement = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId: replacementRunId },
      {
        ownershipId: replacementOwnershipId,
        transitionOwnershipId,
        hostname: "local.test",
        processState: () => "dead",
      },
    );
    assert.equal(replacement.path, canonicalPath);
    assert.equal((await stat(replacement.path)).isDirectory(), true);
    assert.equal(replacement.record.runId, replacementRunId);
    assert.notEqual(replacement.record.ownershipId, ownershipId);
    assert.equal(
      (await stat(join(replacement.path, "owner.record"))).mode & 0o777,
      0o600,
    );
    assert.deepEqual(
      await readFile(replacement.takeover!.archivePath),
      staleBytes,
    );
    assert.deepEqual(replacement.takeover, {
      owner: staleRecord,
      fingerprint: createHash("sha256").update(staleBytes).digest("hex"),
      sourcePath: canonicalPath,
      archivePath: join(
        dir,
        "planning-pr-v1",
        "archive",
        "issue-locks",
        "issue-187",
        `${ownershipId}.lock`,
      ),
    });
    await assertPlanningIssueLockOwned(replacement, {
      issueNumber: 187,
      runId: replacementRunId,
    });
    await releasePlanningIssueLock(replacement);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archives a provably stale ownership directory without deleting any owner record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const stale = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId },
      {
        ownershipId,
        pid: 1234,
        hostname: "local.test",
        now: () => new Date("2026-09-07T12:00:00.000Z"),
      },
    );
    const staleBytes = await ownerBytes(stale.path);
    const replacement = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId: replacementRunId },
      {
        ownershipId: replacementOwnershipId,
        transitionOwnershipId,
        hostname: "local.test",
        processState: (pid) => (pid === 1234 ? "dead" : "alive"),
      },
    );
    const archivePath = join(
      dir,
      "planning-pr-v1",
      "archive",
      "issue-locks",
      "issue-187",
      ownershipId,
      "owner.record",
    );
    assert.equal(replacement.takeover!.archivePath, archivePath);
    assert.deepEqual(await readFile(archivePath), staleBytes);
    assert.equal(
      (await stat(join(replacement.path, "owner.record"))).mode & 0o777,
      0o600,
    );
    await releasePlanningIssueLock(replacement);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("active, remote, unverifiable, and malformed owners remain untouched", async () => {
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
        { ownershipId, pid: 1234, hostname: item.ownerHost },
      );
      const bytes = await ownerBytes(lock.path);
      await assert.rejects(
        acquirePlanningIssueLock(
          dir,
          { issueNumber: 187, runId },
          {
            ownershipId: replacementOwnershipId,
            hostname: item.requesterHost,
            processState: () => item.state,
          },
        ),
        (error: unknown) =>
          error instanceof PlanningIssueLockConflictError &&
          error.diagnostic.classification === item.expected &&
          error.diagnostic.resource === "canonical-lock" &&
          error.diagnostic.fingerprint ===
            createHash("sha256").update(bytes).digest("hex"),
      );
      assert.deepEqual(await ownerBytes(lock.path), bytes);
      await releasePlanningIssueLock(lock);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("malformed canonical ownership directories are never removed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const path = join(dir, "planning-pr-v1", "locks", "issue-187.lock");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "unexpected"), "not an owner");
    await assert.rejects(
      acquirePlanningIssueLock(dir, { issueNumber: 187, runId }),
      (error: unknown) =>
        error instanceof PlanningIssueLockConflictError &&
        error.diagnostic.classification === "malformed",
    );
    assert.equal((await stat(path)).isDirectory(), true);
    assert.equal(
      await readFile(join(path, "unexpected"), "utf8"),
      "not an owner",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("blocks an active takeover transition before acquiring an absent canonical lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  const transitionPath = join(
    dir,
    "planning-pr-v1",
    "locks",
    "issue-187.takeover",
  );
  try {
    const transitionRecord = {
      version: 1,
      issueNumber: 187,
      runId,
      ownershipId: transitionOwnershipId,
      pid: 1234,
      hostname: "local.test",
      acquiredAt: "2026-09-07T12:00:00.000Z",
    };
    await mkdir(transitionPath, { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(`${JSON.stringify(transitionRecord)}\n`);
    await writeFile(join(transitionPath, "owner.lock"), bytes, {
      mode: 0o600,
    });

    await assert.rejects(
      acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId: replacementRunId },
        {
          ownershipId: replacementOwnershipId,
          hostname: "local.test",
          processState: () => "alive",
        },
      ),
      (error: unknown) =>
        error instanceof PlanningIssueLockConflictError &&
        error.diagnostic.resource === "takeover-transition" &&
        error.diagnostic.classification === "active",
    );
    assert.deepEqual(await readFile(join(transitionPath, "owner.lock")), bytes);
    await assert.rejects(
      stat(join(dir, "planning-pr-v1", "locks", "issue-187.lock")),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reclaims a stale transition before acquiring an absent canonical lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  const transitionPath = join(
    dir,
    "planning-pr-v1",
    "locks",
    "issue-187.takeover",
  );
  try {
    const transitionRecord = {
      version: 1,
      issueNumber: 187,
      runId,
      ownershipId: transitionOwnershipId,
      pid: 1234,
      hostname: "local.test",
      acquiredAt: "2026-09-07T12:00:00.000Z",
    };
    const bytes = Buffer.from(`${JSON.stringify(transitionRecord)}\n`);
    await mkdir(transitionPath, { recursive: true, mode: 0o700 });
    await writeFile(join(transitionPath, "owner.lock"), bytes, {
      mode: 0o600,
    });

    const lock = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId: replacementRunId },
      {
        ownershipId: replacementOwnershipId,
        transitionOwnershipId: "123e4567-e89b-42d3-a456-426614174005",
        hostname: "local.test",
        processState: () => "dead",
      },
    );
    assert.equal(lock.record.ownershipId, replacementOwnershipId);
    assert.deepEqual(
      await readFile(
        join(
          dir,
          "planning-pr-v1",
          "archive",
          "issue-lock-transitions",
          "issue-187",
          transitionOwnershipId,
          "owner.lock",
        ),
      ),
      bytes,
    );
    await releasePlanningIssueLock(lock);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preserves malformed transition paths instead of replacing them", async () => {
  const cases = ["empty-directory", "regular-file", "symbolic-link"] as const;
  for (const kind of cases) {
    const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
    const transitionPath = join(
      dir,
      "planning-pr-v1",
      "locks",
      "issue-187.takeover",
    );
    try {
      await mkdir(join(dir, "planning-pr-v1", "locks"), { recursive: true });
      if (kind === "empty-directory") {
        await mkdir(transitionPath);
      } else if (kind === "regular-file") {
        await writeFile(transitionPath, "unowned transition");
      } else {
        await symlink("missing-transition-owner", transitionPath);
      }
      const before = await lstat(transitionPath);
      const staleRecord = {
        version: 1,
        issueNumber: 187,
        runId,
        ownershipId,
        pid: 1234,
        hostname: "local.test",
        acquiredAt: "2026-09-07T12:00:00.000Z",
      };
      const staleBytes = Buffer.from(`${JSON.stringify(staleRecord)}\n`);
      const canonicalPath = await installLegacyLock({
        directory: dir,
        issueNumber: 187,
        bytes: staleBytes,
      });

      await assert.rejects(
        acquirePlanningIssueLock(
          dir,
          { issueNumber: 187, runId: replacementRunId },
          {
            ownershipId: replacementOwnershipId,
            transitionOwnershipId,
            hostname: "local.test",
            processState: () => "dead",
          },
        ),
        (error: unknown) =>
          error instanceof PlanningIssueLockConflictError &&
          error.diagnostic.resource === "takeover-transition" &&
          error.diagnostic.classification === "malformed",
      );
      const after = await lstat(transitionPath);
      assert.equal(after.isDirectory(), before.isDirectory());
      assert.equal(after.isFile(), before.isFile());
      assert.equal(after.isSymbolicLink(), before.isSymbolicLink());
      assert.deepEqual(await readFile(canonicalPath), staleBytes);
      if (kind === "regular-file")
        assert.equal(
          await readFile(transitionPath, "utf8"),
          "unowned transition",
        );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("treats a schema-valid regular-file transition as malformed and leaves it untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  const transitionPath = join(
    dir,
    "planning-pr-v1",
    "locks",
    "issue-187.takeover",
  );
  const transitionRecord = {
    version: 1,
    issueNumber: 187,
    runId,
    ownershipId: transitionOwnershipId,
    pid: 1234,
    hostname: "local.test",
    acquiredAt: "2026-09-07T12:00:00.000Z",
  };
  const transitionBytes = Buffer.from(`${JSON.stringify(transitionRecord)}\n`);
  try {
    await mkdir(join(dir, "planning-pr-v1", "locks"), { recursive: true });
    await writeFile(transitionPath, transitionBytes, { mode: 0o600 });

    await assert.rejects(
      acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId: replacementRunId },
        {
          ownershipId: replacementOwnershipId,
          hostname: "local.test",
          processState: () => "dead",
        },
      ),
      (error: unknown) =>
        error instanceof PlanningIssueLockConflictError &&
        error.diagnostic.resource === "takeover-transition" &&
        error.diagnostic.classification === "malformed",
    );
    assert.deepEqual(await readFile(transitionPath), transitionBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent rescuers leave one replacement owner and one stale archive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-lock-"));
  try {
    const stale = await acquirePlanningIssueLock(
      dir,
      { issueNumber: 187, runId },
      { ownershipId, pid: 1234, hostname: "local.test" },
    );
    const staleBytes = await ownerBytes(stale.path);
    const results = await Promise.allSettled([
      acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId: replacementRunId },
        {
          ownershipId: replacementOwnershipId,
          transitionOwnershipId,
          hostname: "local.test",
          processState: (pid) => (pid === 1234 ? "dead" : "alive"),
        },
      ),
      acquirePlanningIssueLock(
        dir,
        { issueNumber: 187, runId: replacementRunId },
        {
          ownershipId: "123e4567-e89b-42d3-a456-426614174005",
          transitionOwnershipId: "123e4567-e89b-42d3-a456-426614174006",
          hostname: "local.test",
          processState: (pid) => (pid === 1234 ? "dead" : "alive"),
        },
      ),
    ]);
    const winners = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof acquirePlanningIssueLock>>
      > => result.status === "fulfilled",
    );
    assert.equal(winners.length, 1);
    assert.deepEqual(
      await readFile(
        join(
          dir,
          "planning-pr-v1",
          "archive",
          "issue-locks",
          "issue-187",
          ownershipId,
          "owner.record",
        ),
      ),
      staleBytes,
    );
    await releasePlanningIssueLock(winners[0].value);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
