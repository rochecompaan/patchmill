import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import {
  createIssueRunLeaseRecord,
  IssueRunLeaseConflictError,
  parseIssueRunLeaseRecord,
  type IssueRunLeaseRecord,
} from "./recovery-lease.ts";
import {
  archiveRepairBytes,
  repairContent,
  repairFile,
  repairHash,
  removeRepairExact,
  writeRepairExclusive,
} from "./recovery-repair-files.ts";

export type RepairGuardRecord = IssueRunLeaseRecord & {
  repairProtocolVersion: 1;
  operation: "lease" | "guard" | "state";
  expectedTargetSha256: string;
};
export class UnverifiableRepairGuardError extends Error {}
export type RepairGuardSnapshot = {
  raw: string;
  owner: RepairGuardRecord;
  pairedRaw?: string;
};
export function localRepairOwnerState(
  owner: IssueRunLeaseRecord,
): "alive" | "dead" | "unverifiable" {
  if (owner.hostname !== hostname()) return "unverifiable";
  try {
    process.kill(owner.pid, 0);
    return "alive";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "dead"
      : "unverifiable";
  }
}
export async function interruptedRepairSnapshot(
  dir: string,
  issue: number,
): Promise<RepairGuardSnapshot | undefined> {
  const raw = await repairContent(repairFile(dir, issue, ".repair.lock"));
  if (raw === undefined) return undefined;
  const parsed = parseIssueRunLeaseRecord(raw) as RepairGuardRecord | undefined;
  if (
    !parsed ||
    parsed.issueNumber !== issue ||
    parsed.hostname !== hostname() ||
    parsed.repairProtocolVersion !== 1 ||
    !["lease", "guard", "state"].includes(parsed.operation) ||
    !/^[a-f0-9]{64}$/u.test(parsed.expectedTargetSha256) ||
    Object.keys(parsed).some(
      (key) =>
        ![
          "version",
          "issueNumber",
          "pid",
          "hostname",
          "ownerToken",
          "acquiredAt",
          "repairProtocolVersion",
          "operation",
          "expectedTargetSha256",
        ].includes(key),
    )
  )
    throw new UnverifiableRepairGuardError(
      "Repair guard metadata is unknown or unverifiable; evidence was preserved",
    );
  // Only this protocol's filesystem-only owner can be recovered from verified
  // process death. It starts no Git commands, hooks, or agent descendants.
  const pairedRaw =
    parsed.operation === "lease"
      ? await repairContent(repairFile(dir, issue, ".lease-guard"))
      : undefined;
  if (pairedRaw !== undefined) {
    const paired = parseIssueRunLeaseRecord(pairedRaw);
    if (
      !paired ||
      paired.issueNumber !== issue ||
      paired.ownerToken !== parsed.ownerToken ||
      paired.pid !== parsed.pid ||
      paired.hostname !== parsed.hostname ||
      paired.acquiredAt !== parsed.acquiredAt
    )
      throw new UnverifiableRepairGuardError(
        "Repair guards are not linked; evidence was preserved",
      );
  }
  return {
    raw,
    owner: parsed,
    ...(pairedRaw === undefined ? {} : { pairedRaw }),
  };
}
export async function withRepairGuard<T>(
  input: {
    runStateDir: string;
    issueNumber: number;
    operation: RepairGuardRecord["operation"];
    expected: string;
    now?: () => Date;
  },
  action: (guard: {
    record: RepairGuardRecord;
    assertOwned: () => Promise<void>;
  }) => Promise<T>,
): Promise<T> {
  const path = repairFile(input.runStateDir, input.issueNumber, ".repair.lock");
  const record: RepairGuardRecord = {
    ...createIssueRunLeaseRecord(input.issueNumber, { now: input.now }),
    repairProtocolVersion: 1,
    operation: input.operation,
    expectedTargetSha256: input.expected,
  };
  const raw = `${JSON.stringify(record)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeRepairExclusive(path, raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = parseIssueRunLeaseRecord((await repairContent(path)) ?? "");
    throw new IssueRunLeaseConflictError(
      path,
      "repair-lock",
      input.issueNumber,
      owner,
      !!owner && localRepairOwnerState(owner) === "alive",
    );
  }
  let result: T;
  try {
    result = await action({
      record,
      assertOwned: async () => {
        if ((await repairContent(path)) !== raw)
          throw new Error(
            "Repair ownership changed; recovery evidence was preserved",
          );
      },
    });
  } catch (error) {
    await removeRepairExact(path, raw).catch(() => undefined);
    throw error;
  }
  await removeRepairExact(path, raw);
  return result;
}
export async function recoverInterruptedRepair(input: {
  runStateDir: string;
  issueNumber: number;
  expectedRepairSha256: string;
  expectedPairedGuardSha256?: string;
  now?: () => Date;
}): Promise<{ kind: "repair-guards-quarantined"; path: string }> {
  const dir = input.runStateDir,
    issue = input.issueNumber;
  const reconciliation = repairFile(dir, issue, ".repair-reconciliation.lock");
  const mine = `${JSON.stringify(createIssueRunLeaseRecord(issue, { now: input.now }))}\n`;
  await mkdir(dirname(reconciliation), { recursive: true });
  // This short exclusive guard never authorizes unknown or interrupted
  // reconciliation records. Such records remain fail-closed for inspection.
  try {
    await writeRepairExclusive(reconciliation, mine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new IssueRunLeaseConflictError(
        reconciliation,
        "repair-lock",
        issue,
      );
    throw error;
  }
  let result: { kind: "repair-guards-quarantined"; path: string };
  try {
    const snapshot = await interruptedRepairSnapshot(dir, issue);
    if (
      !snapshot ||
      repairHash(snapshot.raw) !== input.expectedRepairSha256 ||
      (snapshot.pairedRaw === undefined
        ? input.expectedPairedGuardSha256 !== undefined
        : repairHash(snapshot.pairedRaw) !== input.expectedPairedGuardSha256)
    )
      throw new Error(
        "Repair guard fingerprint changed; evidence was preserved",
      );
    const state = localRepairOwnerState(snapshot.owner);
    if (state !== "dead")
      throw new IssueRunLeaseConflictError(
        repairFile(dir, issue, ".repair.lock"),
        "repair-lock",
        issue,
        snapshot.owner,
        state === "alive",
      );
    const assertSnapshot = async () => {
      const current = await interruptedRepairSnapshot(dir, issue);
      if (
        (await repairContent(reconciliation)) !== mine ||
        current?.raw !== snapshot.raw ||
        current?.pairedRaw !== snapshot.pairedRaw ||
        localRepairOwnerState(snapshot.owner) !== "dead"
      )
        throw new Error(
          "Repair guard ownership or fingerprint changed; evidence was preserved",
        );
    };
    const archived = await archiveRepairBytes(
      dir,
      issue,
      "repair-guard",
      snapshot.raw,
      input.now,
    );
    if (snapshot.pairedRaw !== undefined)
      await archiveRepairBytes(
        dir,
        issue,
        "paired-repair-guard",
        snapshot.pairedRaw,
        input.now,
      );
    await assertSnapshot();
    if (snapshot.pairedRaw !== undefined)
      await removeRepairExact(
        repairFile(dir, issue, ".lease-guard"),
        snapshot.pairedRaw,
      );
    // A crash here preserves the primary record. Recovery with an exact
    // fingerprint of that record and confirmed absent paired guard is safe.
    if (
      (await repairContent(reconciliation)) !== mine ||
      (await repairContent(repairFile(dir, issue, ".repair.lock"))) !==
        snapshot.raw
    )
      throw new Error("Repair guard ownership changed; evidence was preserved");
    await removeRepairExact(
      repairFile(dir, issue, ".repair.lock"),
      snapshot.raw,
    );
    result = { kind: "repair-guards-quarantined", path: archived };
  } catch (error) {
    await removeRepairExact(reconciliation, mine).catch(() => undefined);
    throw error;
  }
  await removeRepairExact(reconciliation, mine);
  return result;
}
