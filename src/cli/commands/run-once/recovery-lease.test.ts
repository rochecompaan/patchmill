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
