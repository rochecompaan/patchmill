import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectIssueRunLeaseRepair,
  repairIssueRunLease,
} from "./recovery-lease-repair.ts";
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");

// Removing linkage, accepting owner confirmation without shutdown proof, or
// recovering the target lease with the primary guard would break these tests.
test(
  "interrupted repair recovers only linked stopped guards and preserves target evidence",
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "patchmill-repair-process-"));
    await mkdir(join(root, "locks"));
    const source = join(root, "locks", "issue-45.lock");
    const primary = join(root, "locks", "issue-45.repair.lock");
    const paired = join(root, "locks", "issue-45.lease-guard");
    const raw = JSON.stringify({
      version: 1,
      issueNumber: 45,
      pid: 9,
      hostname: "old-host",
      ownerToken: "saved-owner",
      acquiredAt: "2026-01-01T00:00:00Z",
    });
    await writeFile(source, raw);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { repairIssueRunLease } from ${JSON.stringify(new URL("./recovery-lease-repair.ts", import.meta.url).href)};
    await repairIssueRunLease({ runStateDir: ${JSON.stringify(root)}, issueNumber: 45,
      expectedLeaseSha256: ${JSON.stringify(sha(raw))}, confirmedProcessesStopped: true,
      afterArchive: async () => { process.send({ archived: true }); await new Promise(resolve => process.once('message', resolve)); }
    });
  `,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    let diagnostics = "";
    child.stderr!.on("data", (chunk) => {
      diagnostics += String(chunk);
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw new Error(
            `Child exited before archive barrier: ${diagnostics}`,
          );
        }),
      ]);
      const primaryRaw = await readFile(primary, "utf8");
      const pairedRaw = await readFile(paired, "utf8");
      assert.equal(
        JSON.parse(primaryRaw).ownerToken,
        JSON.parse(pairedRaw).ownerToken,
      );
      // An explicit confirmation cannot override a live repair owner.
      await assert.rejects(
        repairIssueRunLease({
          runStateDir: root,
          issueNumber: 45,
          expectedRepairSha256: sha(primaryRaw),
          expectedPairedGuardSha256: sha(pairedRaw),
          confirmedProcessesStopped: true,
        }),
      );
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
      const inspection = await inspectIssueRunLeaseRepair(root, 45);
      assert.equal(inspection.kind, "interrupted-repair");
      if (inspection.kind !== "interrupted-repair")
        assert.fail("missing guard recovery inspection");
      assert.equal(inspection.sha256, sha(primaryRaw));
      assert.equal(inspection.pairedGuardSha256, sha(pairedRaw));
      await assert.rejects(
        repairIssueRunLease({
          runStateDir: root,
          issueNumber: 45,
          expectedRepairSha256: sha(primaryRaw),
          expectedPairedGuardSha256: "a".repeat(64),
          confirmedProcessesStopped: true,
        }),
      );
      assert.equal(await readFile(primary, "utf8"), primaryRaw);
      assert.equal(await readFile(paired, "utf8"), pairedRaw);
      const recovered = await repairIssueRunLease({
        runStateDir: root,
        issueNumber: 45,
        expectedRepairSha256: sha(primaryRaw),
        expectedPairedGuardSha256: sha(pairedRaw),
        confirmedProcessesStopped: true,
      });
      assert.equal(recovered.kind, "repair-guards-quarantined");
      assert.equal(await readFile(source, "utf8"), raw);
      await assert.rejects(readFile(primary), { code: "ENOENT" });
      await assert.rejects(readFile(paired), { code: "ENOENT" });
      const archiveRoot = join(root, "archive", "leases", "issue-45");
      const archives = await Promise.all(
        (await readdir(archiveRoot)).map((name) =>
          readFile(join(archiveRoot, name), "utf8"),
        ),
      );
      assert.ok(archives.includes(primaryRaw));
      assert.ok(archives.includes(pairedRaw));
      assert.ok(archives.includes(raw));
      await repairIssueRunLease({
        runStateDir: root,
        issueNumber: 45,
        expectedLeaseSha256: sha(raw),
        confirmedProcessesStopped: true,
      });
      await assert.rejects(readFile(source), { code: "ENOENT" });
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("repair guard recovery rejects unknown foreign malformed and unlinked records", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-repair-invalid-"));
  await mkdir(join(root, "locks"));
  const primary = join(root, "locks", "issue-45.repair.lock");
  const paired = join(root, "locks", "issue-45.lease-guard");
  const owner = {
    version: 1,
    issueNumber: 45,
    pid: 99999999,
    hostname: hostname(),
    ownerToken: "guard-owner",
    acquiredAt: "2026-01-01T00:00:00Z",
  };
  const known = {
    ...owner,
    repairProtocolVersion: 1,
    operation: "lease",
    expectedTargetSha256: "a".repeat(64),
  };
  try {
    for (const record of [
      "repair\n",
      JSON.stringify(owner),
      JSON.stringify({ ...known, hostname: "foreign" }),
      JSON.stringify({ ...known, pid: -1 }),
      JSON.stringify({ ...known, operation: "future" }),
      JSON.stringify(known),
    ]) {
      const pairedRaw = JSON.stringify({ ...owner, ownerToken: "unlinked" });
      await writeFile(primary, record);
      await writeFile(paired, pairedRaw);
      assert.deepEqual(await inspectIssueRunLeaseRepair(root, 45), {
        kind: "unverifiable",
        resource: "repair-lock",
      });
      await assert.rejects(
        repairIssueRunLease({
          runStateDir: root,
          issueNumber: 45,
          expectedRepairSha256: sha(record),
          expectedPairedGuardSha256: sha(pairedRaw),
          confirmedProcessesStopped: true,
        }),
      );
      assert.equal(await readFile(primary, "utf8"), record);
      assert.equal(await readFile(paired, "utf8"), pairedRaw);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
