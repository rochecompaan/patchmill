import {
  inspectIssueRunLeaseRepair,
  repairIssueRunLease,
} from "../../run-once/recovery-lease-repair.ts";
import { loadRunStateCommandConfig } from "../config.ts";
export async function runLeaseRepairCommand(
  args: string[],
  dependencies: Partial<{
    loadConfig: typeof loadRunStateCommandConfig;
    inspect: typeof inspectIssueRunLeaseRepair;
    repair: typeof repairIssueRunLease;
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
  }> = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(
      "Usage: patchmill run lease repair --issue <number> [--expect-lease-sha256 HASH --confirm-owner-stopped | --expect-guard-sha256 HASH --confirm-all-runners-stopped | --expect-state-sha256 HASH --confirm-all-runners-stopped]\n",
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
    state = value("--expect-state-sha256");
  const count = [lease, guard, state].filter(Boolean).length;
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
    const flag =
      inspection.kind === "remote-lease"
        ? "--expect-lease-sha256"
        : inspection.kind === "abandoned-guard"
          ? "--expect-guard-sha256"
          : "--expect-state-sha256";
    const confirmation =
      inspection.kind === "remote-lease"
        ? "--confirm-owner-stopped"
        : "--confirm-all-runners-stopped";
    stderr.write(
      `Inspect complete. Run: patchmill run lease repair --issue ${issue} ${flag} ${inspection.sha256} ${confirmation}\n`,
    );
    return 0;
  }
  if (count !== 1) throw new Error("Specify exactly one repair fingerprint");
  const ownerStopped = confirmations.has("--confirm-owner-stopped");
  const allStopped = confirmations.has("--confirm-all-runners-stopped");
  const matchingConfirmation =
    (lease && ownerStopped && !allStopped) ||
    ((guard || state) && allStopped && !ownerStopped);
  if (!matchingConfirmation)
    throw new Error(
      "Repair requires the matching stopped-process confirmation",
    );
  const result = await (dependencies.repair ?? repairIssueRunLease)({
    runStateDir: config.runStateDir,
    issueNumber: issue,
    expectedLeaseSha256: lease,
    expectedGuardSha256: guard,
    expectedStateSha256: state,
    confirmedProcessesStopped: matchingConfirmation,
  });
  stderr.write(`${result.kind}: ${result.path}\n`);
  return 0;
}
export const main = runLeaseRepairCommand;
