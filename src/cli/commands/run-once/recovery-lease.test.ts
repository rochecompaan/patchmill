import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireIssueRunLease,
  IssueRunLeaseConflictError,
  releaseIssueRunLease,
  withIssueRunLease,
} from "./recovery-lease.ts";

const owner = {
  pid: 101,
  hostname: "test-host",
  ownerToken: "owner-a",
  now: () => new Date("2026-08-28T12:00:00.000Z"),
};
async function dir() {
  return mkdtemp(join(tmpdir(), "patchmill-lease-"));
}
test("acquires and releases an Issue run lease", async () => {
  const runStateDir = await dir();
  const lease = await acquireIssueRunLease(runStateDir, 45, owner);
  assert.equal(
    JSON.parse(await readFile(lease.path, "utf8")).ownerToken,
    "owner-a",
  );
  await releaseIssueRunLease(lease);
  await assert.rejects(readFile(lease.path, "utf8"));
});

test("acquires and releases a lease with a valid OS underscore hostname", async () => {
  const runStateDir = await dir();
  const lease = await acquireIssueRunLease(runStateDir, 45, {
    ...owner,
    hostname: "build_host",
  });
  assert.equal(lease.record.hostname, "build_host");
  await releaseIssueRunLease(lease);
  await assert.rejects(readFile(lease.path, "utf8"));
});
test("refuses to emit lease records with hostname separators or control text", async () => {
  const runStateDir = await dir();
  for (const hostname of ["build/host", "build\\host", "build\nhost"]) {
    await assert.rejects(
      acquireIssueRunLease(runStateDir, 45, { ...owner, hostname }),
      /invalid hostname/,
    );
  }
  await assert.rejects(readFile(join(runStateDir, "locks", "issue-45.lock")));
});

test("refuses a live owner and preserves its lease", async () => {
  const runStateDir = await dir();
  const lease = await acquireIssueRunLease(runStateDir, 45, owner);
  await assert.rejects(
    acquireIssueRunLease(runStateDir, 45, {
      ...owner,
      ownerToken: "owner-b",
      processState: () => "alive",
    }),
    IssueRunLeaseConflictError,
  );
  assert.equal(
    JSON.parse(await readFile(lease.path, "utf8")).ownerToken,
    "owner-a",
  );
});
test("active conflicts always identify the known issue and repair inspection command", async () => {
  const owner = {
    version: 1 as const,
    issueNumber: 45,
    pid: 101,
    hostname: "test-host",
    ownerToken: "owner-a",
    acquiredAt: "2026-08-28T12:00:00.000Z",
  };
  for (const [resource, knownOwner] of [
    ["lease", owner],
    ["lease-guard", undefined],
    ["repair-lock", undefined],
  ] as const) {
    const error = new IssueRunLeaseConflictError(
      "/tmp/issue-45.lock",
      resource,
      45,
      knownOwner,
    );
    if (knownOwner) assert.match(error.message, /test-host process 101/);
    assert.match(error.message, /patchmill run lease repair --issue 45/);
    assert.equal(error.issueNumber, 45);
  }
});
test("takes over a dead same-host owner under its transaction guard", async () => {
  const runStateDir = await dir();
  await acquireIssueRunLease(runStateDir, 45, owner);
  const lease = await acquireIssueRunLease(runStateDir, 45, {
    ...owner,
    ownerToken: "owner-b",
    processState: () => "dead",
  });
  assert.equal(lease.record.ownerToken, "owner-b");
});
test("refuses corrupt path-shaped stale lease fields without archiving them", async () => {
  const runStateDir = await dir();
  const leasePath = join(runStateDir, "locks", "issue-45.lock");
  await (
    await import("node:fs/promises")
  ).mkdir(join(runStateDir, "locks"), { recursive: true });
  for (const corrupt of ["../escape", "owner/escape"]) {
    const raw = `${JSON.stringify({ version: 1, issueNumber: 45, pid: 101, hostname: "test-host", ownerToken: corrupt, acquiredAt: corrupt })}\n`;
    await writeFile(leasePath, raw);
    await assert.rejects(
      acquireIssueRunLease(runStateDir, 45, {
        ...owner,
        processState: () => "dead",
      }),
      IssueRunLeaseConflictError,
    );
    assert.equal(await readFile(leasePath, "utf8"), raw);
  }
});

test("refuses lease hostnames with separators or control text without archiving", async () => {
  const runStateDir = await dir();
  const leasePath = join(runStateDir, "locks", "issue-45.lock");
  await (
    await import("node:fs/promises")
  ).mkdir(join(runStateDir, "locks"), { recursive: true });
  for (const hostname of ["build/host", "build\\host", "build\nhost"]) {
    const raw = `${JSON.stringify({ version: 1, issueNumber: 45, pid: 101, hostname, ownerToken: "owner", acquiredAt: "2026-08-28T12:00:00.000Z" })}\n`;
    await writeFile(leasePath, raw);
    await assert.rejects(
      acquireIssueRunLease(runStateDir, 45, {
        ...owner,
        processState: () => "dead",
      }),
      IssueRunLeaseConflictError,
    );
    assert.equal(await readFile(leasePath, "utf8"), raw);
  }
});
test("does not release a borrowed lease", async () => {
  const runStateDir = await dir();
  const lease = await acquireIssueRunLease(runStateDir, 45, owner);
  await withIssueRunLease(
    { runStateDir, issueNumber: 45, lease },
    async () => undefined,
  );
  assert.equal(
    JSON.parse(await readFile(lease.path, "utf8")).ownerToken,
    "owner-a",
  );
});
test("serializes contenders behind a dead-owner takeover guard", async () => {
  const runStateDir = await dir();
  await acquireIssueRunLease(runStateDir, 45, owner);
  let release!: () => void;
  let observed!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const first = acquireIssueRunLease(runStateDir, 45, {
    ...owner,
    ownerToken: "a",
    processState: () => "dead",
    afterObserveLease: async () => {
      observed();
      await paused;
    },
  });
  await ready;
  await assert.rejects(
    acquireIssueRunLease(runStateDir, 45, {
      ...owner,
      ownerToken: "b",
      processState: () => "dead",
    }),
    IssueRunLeaseConflictError,
  );
  release();
  const lease = await first;
  assert.equal(lease.record.ownerToken, "a");
});
test("refuses an abandoned guard and a repair lock", async () => {
  const runStateDir = await dir();
  await writeFile(join(runStateDir, "locks", "issue-45.lease-guard"), "{}\n", {
    flag: "w",
  }).catch(async () => {
    await (
      await import("node:fs/promises")
    ).mkdir(join(runStateDir, "locks"), { recursive: true });
    await writeFile(join(runStateDir, "locks", "issue-45.lease-guard"), "{}\n");
  });
  await assert.rejects(
    acquireIssueRunLease(runStateDir, 45, owner),
    IssueRunLeaseConflictError,
  );
});
