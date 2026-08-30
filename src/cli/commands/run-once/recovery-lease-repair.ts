import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentIssueRunState, RunLegacyMigrationFence } from "./types.ts";
import {
  IssueRunLeaseConflictError,
  type IssueRunLeaseGuardRecord,
  type IssueRunLeaseRecord,
} from "./recovery-lease.ts";

export type IssueRunLeaseRepairInspection =
  | { kind: "remote-lease"; sha256: string; owner: IssueRunLeaseRecord }
  | {
      kind: "abandoned-guard";
      sha256: string;
      owner?: IssueRunLeaseGuardRecord;
    }
  | {
      kind: "legacy-active-state";
      sha256: string;
      status: RunLegacyMigrationFence["status"];
    }
  | { kind: "nothing-to-repair" };
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const file = (dir: string, issue: number, name: string) =>
  join(dir, "locks", `issue-${issue}${name}`);
async function content(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function owner(raw: string): IssueRunLeaseRecord | undefined {
  try {
    const value = JSON.parse(raw) as Partial<IssueRunLeaseRecord>;
    return value.version === 1 &&
      typeof value.issueNumber === "number" &&
      typeof value.pid === "number" &&
      typeof value.hostname === "string" &&
      typeof value.ownerToken === "string" &&
      typeof value.acquiredAt === "string"
      ? (value as IssueRunLeaseRecord)
      : undefined;
  } catch {
    return undefined;
  }
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
export async function readRunLegacyMigrationFence(
  runStateDir: string,
  issueNumber: number,
): Promise<RunLegacyMigrationFence | undefined> {
  const raw = await content(
    file(runStateDir, issueNumber, ".legacy-fence.json"),
  );
  if (!raw) return undefined;
  return JSON.parse(raw) as RunLegacyMigrationFence;
}
export async function inspectIssueRunLeaseRepair(
  runStateDir: string,
  issueNumber: number,
): Promise<IssueRunLeaseRepairInspection> {
  const lease = await content(file(runStateDir, issueNumber, ".lock"));
  const parsed = lease && owner(lease);
  if (
    lease &&
    parsed &&
    parsed.hostname !== (await import("node:os")).hostname()
  )
    return { kind: "remote-lease", sha256: hash(lease), owner: parsed };
  const guard = await content(file(runStateDir, issueNumber, ".lease-guard"));
  if (guard)
    return {
      kind: "abandoned-guard",
      sha256: hash(guard),
      ...(owner(guard) ? { owner: owner(guard) } : {}),
    };
  const stateRaw = await content(
    join(runStateDir, `issue-${issueNumber}.json`),
  );
  if (stateRaw) {
    const state = JSON.parse(stateRaw) as AgentIssueRunState;
    if (active(state) && !state.leaseProtocolVersion)
      return {
        kind: "legacy-active-state",
        sha256: hash(stateRaw),
        status: state.status,
      };
  }
  return { kind: "nothing-to-repair" };
}
export async function repairIssueRunLease(input: {
  runStateDir: string;
  issueNumber: number;
  expectedLeaseSha256?: string;
  expectedGuardSha256?: string;
  expectedStateSha256?: string;
  confirmedProcessesStopped: boolean;
  now?: () => Date;
}): Promise<{
  kind: "lease-quarantined" | "guard-quarantined" | "legacy-fence-written";
  path: string;
}> {
  const requested = [
    ["lease", input.expectedLeaseSha256],
    ["guard", input.expectedGuardSha256],
    ["state", input.expectedStateSha256],
  ].filter(([, value]) => value) as Array<
    ["lease" | "guard" | "state", string]
  >;
  if (requested.length !== 1 || !input.confirmedProcessesStopped)
    throw new Error(
      "Repair requires exactly one expected SHA-256 and confirmation that affected runners are stopped",
    );
  const repair = file(input.runStateDir, input.issueNumber, ".repair.lock");
  await mkdir(dirname(repair), { recursive: true });
  let handle;
  let guardPath: string | undefined;
  let guardToken: string | undefined;
  try {
    handle = await open(repair, "wx", 0o600);
    await handle.writeFile("repair\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new IssueRunLeaseConflictError(repair, "repair-lock");
    throw error;
  }
  try {
    const [kind, expected] = requested[0];
    const source =
      kind === "lease"
        ? file(input.runStateDir, input.issueNumber, ".lock")
        : kind === "guard"
          ? file(input.runStateDir, input.issueNumber, ".lease-guard")
          : join(input.runStateDir, `issue-${input.issueNumber}.json`);
    if (kind === "lease") {
      guardPath = file(input.runStateDir, input.issueNumber, ".lease-guard");
      guardToken = randomUUID();
      try {
        const guard = await open(guardPath, "wx", 0o600);
        await guard.writeFile(
          `${JSON.stringify({ version: 1, issueNumber: input.issueNumber, pid: process.pid, hostname: hostname(), ownerToken: guardToken, acquiredAt: (input.now?.() ?? new Date()).toISOString() })}\n`,
        );
        await guard.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new IssueRunLeaseConflictError(guardPath, "lease-guard");
        throw error;
      }
    }
    const raw = await content(source);
    if (!raw || hash(raw) !== expected)
      throw new Error(
        "Repair fingerprint changed; no recovery file was changed",
      );
    if (kind === "state") {
      const state = JSON.parse(raw) as AgentIssueRunState;
      if (!active(state))
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
      await writeFile(target, `${JSON.stringify(fence, null, 2)}\n`);
      return { kind: "legacy-fence-written", path: target };
    }
    const target = join(
      input.runStateDir,
      "archive",
      "leases",
      `issue-${input.issueNumber}`,
      `${(input.now?.() ?? new Date()).toISOString().replaceAll(/[:.]/gu, "-")}-${kind}.json`,
    );
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
    return {
      kind: kind === "lease" ? "lease-quarantined" : "guard-quarantined",
      path: target,
    };
  } finally {
    if (guardPath && guardToken) {
      const raw = await content(guardPath);
      if (raw && owner(raw)?.ownerToken === guardToken)
        await unlink(guardPath).catch(() => undefined);
    }
    await handle.close();
    await unlink(repair).catch(() => undefined);
  }
}
