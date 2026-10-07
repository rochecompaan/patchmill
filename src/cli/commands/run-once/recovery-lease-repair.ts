import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { AgentIssueRunState, RunLegacyMigrationFence } from "./types.ts";
import {
  IssueRunLeaseConflictError,
  parseIssueRunLeaseRecord,
  type IssueRunLeaseRecord,
} from "./recovery-lease.ts";
import {
  archiveRepairBytes,
  repairContent as content,
  repairFile as file,
  repairHash as hash,
  removeRepairExact,
  writeRepairExclusive,
} from "./recovery-repair-files.ts";
import {
  interruptedRepairSnapshot,
  localRepairOwnerState,
  recoverInterruptedRepair,
  withRepairGuard,
  UnverifiableRepairGuardError,
} from "./recovery-repair-guard.ts";

export type IssueRunLeaseRepairInspection =
  | { kind: "remote-lease"; sha256: string; owner: IssueRunLeaseRecord }
  | { kind: "abandoned-guard"; sha256: string; owner?: IssueRunLeaseRecord }
  | {
      kind: "interrupted-repair";
      sha256: string;
      owner: IssueRunLeaseRecord;
      pairedGuardSha256?: string;
    }
  | {
      kind: "legacy-active-state";
      sha256: string;
      status: RunLegacyMigrationFence["status"];
    }
  | { kind: "unverifiable"; resource: "lease" | "lease-guard" | "repair-lock" }
  | { kind: "nothing-to-repair" };
function ownerForIssue(
  raw: string,
  issueNumber: number,
): IssueRunLeaseRecord | undefined {
  const parsed = parseIssueRunLeaseRecord(raw);
  return parsed?.issueNumber === issueNumber ? parsed : undefined;
}
function active(
  state: AgentIssueRunState,
): state is AgentIssueRunState & { status: RunLegacyMigrationFence["status"] } {
  return (
    state.status === "claimed" ||
    state.status === "planning" ||
    state.status === "implementing"
  );
}
function migrationFence(value: unknown): RunLegacyMigrationFence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const fence = value as Record<string, unknown>;
  if (
    fence.version !== 1 ||
    !Number.isSafeInteger(fence.issueNumber) ||
    typeof fence.issueNumber !== "number" ||
    fence.issueNumber <= 0 ||
    !["claimed", "planning", "implementing"].includes(fence.status as string) ||
    typeof fence.stateSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(fence.stateSha256) ||
    typeof fence.repairedAt !== "string" ||
    Number.isNaN(Date.parse(fence.repairedAt))
  )
    return undefined;
  return fence as RunLegacyMigrationFence;
}
/** A corrupt or future fence never authorizes legacy-state adoption. */
export async function readRunLegacyMigrationFence(
  runStateDir: string,
  issueNumber: number,
): Promise<RunLegacyMigrationFence | undefined> {
  const raw = await content(
    file(runStateDir, issueNumber, ".legacy-fence.json"),
  );
  if (!raw) return undefined;
  try {
    return migrationFence(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
export async function inspectIssueRunLeaseRepair(
  runStateDir: string,
  issueNumber: number,
): Promise<IssueRunLeaseRepairInspection> {
  if (
    (await content(
      file(runStateDir, issueNumber, ".repair-reconciliation.lock"),
    )) !== undefined
  )
    return { kind: "unverifiable", resource: "repair-lock" };
  if (
    (await content(file(runStateDir, issueNumber, ".repair.lock"))) !==
    undefined
  ) {
    try {
      const snapshot = await interruptedRepairSnapshot(
        runStateDir,
        issueNumber,
      );
      if (!snapshot) return { kind: "unverifiable", resource: "repair-lock" };
      return {
        kind: "interrupted-repair",
        sha256: hash(snapshot.raw),
        owner: snapshot.owner,
        ...(snapshot.pairedRaw === undefined
          ? {}
          : { pairedGuardSha256: hash(snapshot.pairedRaw) }),
      };
    } catch (error) {
      if (!(error instanceof UnverifiableRepairGuardError)) throw error;
      return { kind: "unverifiable", resource: "repair-lock" };
    }
  }
  const lease = await content(file(runStateDir, issueNumber, ".lock"));
  if (lease !== undefined) {
    const parsed = ownerForIssue(lease, issueNumber);
    if (!parsed) return { kind: "unverifiable", resource: "lease" };
    if (parsed.hostname !== hostname())
      return { kind: "remote-lease", sha256: hash(lease), owner: parsed };
  }
  const guard = await content(file(runStateDir, issueNumber, ".lease-guard"));
  if (guard !== undefined) {
    const parsed = ownerForIssue(guard, issueNumber);
    if (!parsed) return { kind: "unverifiable", resource: "lease-guard" };
    return { kind: "abandoned-guard", sha256: hash(guard), owner: parsed };
  }
  const stateRaw = await content(
    join(runStateDir, `issue-${issueNumber}.json`),
  );
  if (stateRaw) {
    const state = JSON.parse(stateRaw) as AgentIssueRunState;
    if (active(state) && state.leaseProtocolVersion !== 1)
      return {
        kind: "legacy-active-state",
        sha256: hash(stateRaw),
        status: state.status,
      };
  }
  return { kind: "nothing-to-repair" };
}
export type IssueRunLeaseRepairInput = {
  runStateDir: string;
  issueNumber: number;
  expectedLeaseSha256?: string;
  expectedGuardSha256?: string;
  expectedStateSha256?: string;
  expectedRepairSha256?: string;
  expectedPairedGuardSha256?: string;
  confirmedProcessesStopped: boolean;
  now?: () => Date;
  afterArchive?: () => Promise<void>;
};
export async function repairIssueRunLease(
  input: IssueRunLeaseRepairInput,
): Promise<{
  kind:
    | "lease-quarantined"
    | "guard-quarantined"
    | "legacy-fence-written"
    | "repair-guards-quarantined";
  path: string;
}> {
  const requested = [
    ["lease", input.expectedLeaseSha256],
    ["guard", input.expectedGuardSha256],
    ["state", input.expectedStateSha256],
    ["repair", input.expectedRepairSha256],
  ].filter(([, value]) => value) as Array<
    ["lease" | "guard" | "state" | "repair", string]
  >;
  if (
    requested.length !== 1 ||
    !input.confirmedProcessesStopped ||
    (input.expectedPairedGuardSha256 !== undefined &&
      input.expectedRepairSha256 === undefined)
  )
    throw new Error(
      "Repair requires exactly one expected SHA-256 and confirmation that affected runners are stopped",
    );
  const [kind, expected] = requested[0]!;
  if (kind === "repair")
    return recoverInterruptedRepair({
      ...input,
      expectedRepairSha256: expected,
    });
  return withRepairGuard(
    { ...input, operation: kind, expected },
    async ({ record, assertOwned }) => {
      const leasePath = file(input.runStateDir, input.issueNumber, ".lock");
      const leaseRaw = await content(leasePath);
      const owner =
        leaseRaw === undefined
          ? undefined
          : ownerForIssue(leaseRaw, input.issueNumber);
      if (owner?.hostname === hostname()) {
        const state = localRepairOwnerState(owner);
        if (state !== "dead")
          throw new IssueRunLeaseConflictError(
            leasePath,
            "lease",
            input.issueNumber,
            owner,
            state === "alive",
          );
      }
      if (kind !== "lease" && leaseRaw !== undefined)
        throw new Error(
          "A common owner still exists; repair it separately before state or guard repair",
        );
      const source =
        kind === "lease"
          ? leasePath
          : kind === "guard"
            ? file(input.runStateDir, input.issueNumber, ".lease-guard")
            : join(input.runStateDir, `issue-${input.issueNumber}.json`);
      const paired = file(input.runStateDir, input.issueNumber, ".lease-guard");
      const {
        repairProtocolVersion: _protocol,
        operation: _operation,
        expectedTargetSha256: _expected,
        ...pairedRecord
      } = record;
      const pairedRaw = `${JSON.stringify(pairedRecord)}\n`;
      if (kind === "lease") {
        try {
          await writeRepairExclusive(paired, pairedRaw);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new IssueRunLeaseConflictError(
              paired,
              "lease-guard",
              input.issueNumber,
            );
          throw error;
        }
      }
      const assertOperationOwned = async () => {
        await assertOwned();
        if (kind === "lease" && (await content(paired)) !== pairedRaw)
          throw new Error(
            "Repair paired guard ownership changed; evidence was preserved",
          );
      };
      let result: {
        kind:
          | "lease-quarantined"
          | "guard-quarantined"
          | "legacy-fence-written";
        path: string;
      };
      try {
        const raw = await content(source);
        if (raw === undefined || hash(raw) !== expected)
          throw new Error(
            "Repair fingerprint changed; no recovery file was changed",
          );
        if (
          (kind === "lease" || kind === "guard") &&
          !ownerForIssue(raw, input.issueNumber)
        )
          throw new Error(
            "Repair target is not a valid Issue run lease record",
          );
        if (kind === "guard") {
          const guardOwner = ownerForIssue(raw, input.issueNumber)!;
          if (guardOwner.hostname === hostname()) {
            const state = localRepairOwnerState(guardOwner);
            if (state !== "dead")
              throw new IssueRunLeaseConflictError(
                source,
                "lease-guard",
                input.issueNumber,
                guardOwner,
                state === "alive",
              );
          }
        }
        if (kind === "state") {
          const state = JSON.parse(raw) as AgentIssueRunState;
          if (!active(state) || state.issueNumber !== input.issueNumber)
            throw new Error("State is not a legacy active Run recovery state");
          const target = file(
            input.runStateDir,
            input.issueNumber,
            ".legacy-fence.json",
          );
          const fence: RunLegacyMigrationFence = {
            version: 1,
            issueNumber: input.issueNumber,
            status: state.status,
            stateSha256: expected,
            repairedAt: (input.now?.() ?? new Date()).toISOString(),
          };
          await assertOperationOwned();
          if ((await content(source)) !== raw)
            throw new Error(
              "Repair fingerprint changed before fence replacement",
            );
          await writeFile(target, `${JSON.stringify(fence, null, 2)}\n`);
          result = { kind: "legacy-fence-written", path: target };
        } else {
          const target = await archiveRepairBytes(
            input.runStateDir,
            input.issueNumber,
            kind,
            raw,
            input.now,
          );
          await input.afterArchive?.();
          await assertOperationOwned();
          if ((await content(source)) !== raw)
            throw new Error(
              "Repair fingerprint changed before removal; evidence was preserved",
            );
          await removeRepairExact(source, raw);
          result = {
            kind: kind === "lease" ? "lease-quarantined" : "guard-quarantined",
            path: target,
          };
        }
      } catch (error) {
        if (kind === "lease")
          await removeRepairExact(paired, pairedRaw).catch(() => undefined);
        throw error;
      }
      if (kind === "lease") await removeRepairExact(paired, pairedRaw);
      return result;
    },
  );
}
