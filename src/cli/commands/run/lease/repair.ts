import {
  inspectIssueRunLeaseRepair,
  repairIssueRunLease,
} from "../../run-once/recovery-lease-repair.ts";
import {
  loadRunStateCommandConfig,
  withRunStateMutationAdmission,
} from "../config.ts";
import { IssueRunLeaseConflictError } from "../../run-once/recovery-lease.ts";
export async function runLeaseRepairCommand(
  args: string[],
  dependencies: Partial<{
    loadConfig: typeof loadRunStateCommandConfig;
    inspect: typeof inspectIssueRunLeaseRepair;
    repair: typeof repairIssueRunLease;
    admitMutation: typeof withRunStateMutationAdmission;
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
  }> = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(
      "Usage: patchmill run lease repair --issue <number> [--expect-lease-sha256 HASH --confirm-owner-stopped | --expect-guard-sha256 HASH --confirm-all-runners-stopped | --expect-state-sha256 HASH --confirm-all-runners-stopped | --expect-repair-sha256 HASH [--expect-paired-guard-sha256 HASH] --confirm-all-runners-stopped]\n",
    );
    return 0;
  }
  const values = new Map<string, string>();
  const confirmations = new Set<string>();
  const valueFlags = new Set([
    "--issue",
    "--expect-lease-sha256",
    "--expect-guard-sha256",
    "--expect-state-sha256",
    "--expect-repair-sha256",
    "--expect-paired-guard-sha256",
  ]);
  const confirmationFlags = new Set([
    "--confirm-owner-stopped",
    "--confirm-all-runners-stopped",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (valueFlags.has(arg)) {
      const next = args[index + 1];
      if (!next || next.startsWith("-") || values.has(arg))
        throw new Error(`Invalid or duplicate lease repair option: ${arg}`);
      values.set(arg, next);
      index += 1;
    } else if (confirmationFlags.has(arg)) {
      if (confirmations.has(arg))
        throw new Error(`Duplicate lease repair option: ${arg}`);
      confirmations.add(arg);
    } else {
      throw new Error(`Unsupported lease repair option: ${arg}`);
    }
  }
  const value = (flag: string) => values.get(flag);
  const rawIssue = value("--issue");
  const issue = rawIssue && /^\d+$/u.test(rawIssue) ? Number(rawIssue) : 0;
  if (!issue)
    throw new Error("patchmill run lease repair requires --issue <number>");
  const lease = value("--expect-lease-sha256"),
    guard = value("--expect-guard-sha256"),
    state = value("--expect-state-sha256"),
    repair = value("--expect-repair-sha256"),
    paired = value("--expect-paired-guard-sha256");
  if (paired && !repair)
    throw new Error(
      "Paired guard fingerprint requires a repair guard fingerprint",
    );
  const count = [lease, guard, state, repair].filter(Boolean).length;
  const config = await (dependencies.loadConfig ?? loadRunStateCommandConfig)(
    args,
  );
  if (!count) {
    if (
      confirmations.has("--confirm-owner-stopped") ||
      confirmations.has("--confirm-all-runners-stopped")
    )
      throw new Error("Repair confirmation requires a repair fingerprint");
    const inspection = await (
      dependencies.inspect ?? inspectIssueRunLeaseRepair
    )(config.runStateDir, issue);
    if (inspection.kind === "nothing-to-repair") {
      stdout.write("Nothing to repair.\n");
      return 0;
    }
    if (inspection.kind === "unverifiable")
      throw new Error(
        `Issue run ${inspection.resource} metadata is malformed; repair it manually without deleting recovery evidence`,
      );
    const flag =
      inspection.kind === "remote-lease"
        ? "--expect-lease-sha256"
        : inspection.kind === "abandoned-guard"
          ? "--expect-guard-sha256"
          : inspection.kind === "interrupted-repair"
            ? "--expect-repair-sha256"
            : "--expect-state-sha256";
    const confirmation =
      inspection.kind === "remote-lease"
        ? "--confirm-owner-stopped"
        : "--confirm-all-runners-stopped";
    const pairedFlag =
      inspection.kind === "interrupted-repair" && inspection.pairedGuardSha256
        ? ` --expect-paired-guard-sha256 ${inspection.pairedGuardSha256}`
        : "";
    stderr.write(
      `Inspect complete. Run: patchmill run lease repair --issue ${issue} ${flag} ${inspection.sha256}${pairedFlag} ${confirmation}\n`,
    );
    return 0;
  }
  if (count !== 1) throw new Error("Specify exactly one repair fingerprint");
  const ownerStopped = confirmations.has("--confirm-owner-stopped");
  const allStopped = confirmations.has("--confirm-all-runners-stopped");
  const matchingConfirmation =
    (lease && ownerStopped && !allStopped) ||
    ((guard || state || repair) && allStopped && !ownerStopped);
  if (!matchingConfirmation)
    throw new Error(
      "Repair requires the matching stopped-process confirmation",
    );
  let result;
  try {
    result = await (
      dependencies.admitMutation ?? withRunStateMutationAdmission
    )(config, issue, () =>
      (dependencies.repair ?? repairIssueRunLease)({
        runStateDir: config.runStateDir,
        issueNumber: issue,
        ...(lease === undefined ? {} : { expectedLeaseSha256: lease }),
        ...(guard === undefined ? {} : { expectedGuardSha256: guard }),
        ...(state === undefined ? {} : { expectedStateSha256: state }),
        ...(repair === undefined ? {} : { expectedRepairSha256: repair }),
        ...(paired === undefined ? {} : { expectedPairedGuardSha256: paired }),
        confirmedProcessesStopped: matchingConfirmation,
      }),
    );
  } catch (error) {
    if (!(error instanceof IssueRunLeaseConflictError) || !error.liveOwner)
      throw error;
    stderr.write("issue already in progress.\n");
    return 0;
  }
  stderr.write(`${result.kind}: ${result.path}\n`);
  return 0;
}
export const main = runLeaseRepairCommand;
