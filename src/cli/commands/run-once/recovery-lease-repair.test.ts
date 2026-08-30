import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectIssueRunLeaseRepair,
  repairIssueRunLease,
  readRunLegacyMigrationFence,
} from "./recovery-lease-repair.ts";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "patchmill-repair-"));
  await mkdir(join(root, "locks"), { recursive: true });
  return root;
}
test("inspects and quarantines exact remote lease bytes", async () => {
  const root = await fixture();
  const raw =
    '{"version":1,"issueNumber":45,"pid":9,"hostname":"remote","ownerToken":"x","acquiredAt":"2026-01-01T00:00:00.000Z"}\n';
  const source = join(root, "locks", "issue-45.lock");
  await writeFile(source, raw);
  const inspection = await inspectIssueRunLeaseRepair(root, 45);
  assert.equal(inspection.kind, "remote-lease");
  if (inspection.kind !== "remote-lease") return;
  const repaired = await repairIssueRunLease({
    runStateDir: root,
    issueNumber: 45,
    expectedLeaseSha256: inspection.sha256,
    confirmedProcessesStopped: true,
  });
  assert.equal(repaired.kind, "lease-quarantined");
  assert.equal(await readFile(repaired.path, "utf8"), raw);
});
test("refuses a changed lease fingerprint without moving it", async () => {
  const root = await fixture();
  const source = join(root, "locks", "issue-45.lock");
  await writeFile(source, "first\n");
  await writeFile(source, "second\n");
  await assert.rejects(
    repairIssueRunLease({
      runStateDir: root,
      issueNumber: 45,
      expectedLeaseSha256: sha("first\n"),
      confirmedProcessesStopped: true,
    }),
    /fingerprint changed/,
  );
  assert.equal(await readFile(source, "utf8"), "second\n");
});
test("writes an exact legacy-active migration fence", async () => {
  const root = await fixture();
  const raw =
    '{"issueNumber":45,"title":"x","status":"implementing","createdAt":"x","updatedAt":"x"}';
  await writeFile(join(root, "issue-45.json"), raw);
  const result = await repairIssueRunLease({
    runStateDir: root,
    issueNumber: 45,
    expectedStateSha256: sha(raw),
    confirmedProcessesStopped: true,
    now: () => new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.equal(result.kind, "legacy-fence-written");
  const fence = await readRunLegacyMigrationFence(root, 45);
  assert.equal(fence?.stateSha256, sha(raw));
  assert.equal(fence?.status, "implementing");
});
