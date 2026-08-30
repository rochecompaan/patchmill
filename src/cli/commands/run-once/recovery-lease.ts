import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { hostname as systemHostname } from "node:os";
import { dirname, join } from "node:path";
import type {
  IssueRunLease,
  RunRecoveryDecision,
  RunRecoveryLeaseOwner,
} from "./types.ts";

export type IssueRunLeaseRecord = RunRecoveryLeaseOwner;
export type IssueRunLeaseGuardRecord = RunRecoveryLeaseOwner;
export type IssueRunLeaseOptions = {
  pid?: number;
  hostname?: string;
  ownerToken?: string;
  now?: () => Date;
  processState?: (pid: number) => "alive" | "dead" | "unverifiable";
  afterObserveLease?: () => Promise<void> | void;
};
export class IssueRunLeaseConflictError extends Error {
  readonly classification = "active-run" as const;
  readonly leasePath: string;
  readonly resource: "lease" | "lease-guard" | "repair-lock";
  readonly issueNumber: number;
  readonly owner?: IssueRunLeaseRecord;
  constructor(
    leasePath: string,
    resource: "lease" | "lease-guard" | "repair-lock",
    issueNumber: number,
    owner?: IssueRunLeaseRecord,
  ) {
    const ownerDetail = owner
      ? ` (owned by ${owner.hostname} process ${owner.pid})`
      : "";
    const repairIssue = issueNumber;
    super(
      `Issue run ${resource} is active: ${leasePath}${ownerDetail}. ` +
        `Inspect only after affected runners stop: patchmill run lease repair --issue ${repairIssue}`,
    );
    this.leasePath = leasePath;
    this.resource = resource;
    this.issueNumber = issueNumber;
    this.owner = owner;
  }
}
function paths(dir: string, issue: number) {
  const locks = join(dir, "locks");
  return {
    locks,
    lease: join(locks, `issue-${issue}.lock`),
    guard: join(locks, `issue-${issue}.lease-guard`),
    repair: join(locks, `issue-${issue}.repair.lock`),
  };
}
async function present(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function processState(pid: number): "alive" | "dead" | "unverifiable" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "dead"
      : "unverifiable";
  }
}
function parse(raw: string): IssueRunLeaseRecord | undefined {
  try {
    const value = JSON.parse(raw) as Partial<IssueRunLeaseRecord>;
    const acquiredAt =
      typeof value.acquiredAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
        value.acquiredAt,
      ) &&
      !Number.isNaN(Date.parse(value.acquiredAt));
    return value.version === 1 &&
      Number.isSafeInteger(value.issueNumber) &&
      value.issueNumber > 0 &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.hostname === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/u.test(value.hostname) &&
      typeof value.ownerToken === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.ownerToken) &&
      acquiredAt
      ? (value as IssueRunLeaseRecord)
      : undefined;
  } catch {
    return undefined;
  }
}
async function exclusive(
  path: string,
  record: IssueRunLeaseRecord,
): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
  } finally {
    await handle.close();
  }
}
async function guard(
  dir: string,
  issue: number,
  record: IssueRunLeaseRecord,
): Promise<() => Promise<void>> {
  const p = paths(dir, issue);
  await mkdir(p.locks, { recursive: true });
  try {
    await exclusive(p.guard, record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new IssueRunLeaseConflictError(p.guard, "lease-guard", issue);
    throw error;
  }
  return async () => {
    let current: string | undefined;
    try {
      current = await readFile(p.guard, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current && parse(current)?.ownerToken === record.ownerToken) {
      try {
        await unlink(p.guard);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  };
}
function record(
  issueNumber: number,
  options: IssueRunLeaseOptions,
): IssueRunLeaseRecord {
  return {
    version: 1,
    issueNumber,
    pid: options.pid ?? process.pid,
    hostname: options.hostname ?? systemHostname(),
    ownerToken: options.ownerToken ?? randomUUID(),
    acquiredAt: (options.now?.() ?? new Date()).toISOString(),
  };
}
export async function acquireIssueRunLease(
  runStateDir: string,
  issueNumber: number,
  options: IssueRunLeaseOptions = {},
): Promise<IssueRunLease> {
  const mine = record(issueNumber, options);
  const p = paths(runStateDir, issueNumber);
  if (await present(p.repair))
    throw new IssueRunLeaseConflictError(p.repair, "repair-lock", issueNumber);
  const releaseGuard = await guard(runStateDir, issueNumber, mine);
  try {
    await options.afterObserveLease?.();
    if (await present(p.repair))
      throw new IssueRunLeaseConflictError(
        p.repair,
        "repair-lock",
        issueNumber,
      );
    try {
      await exclusive(p.lease, mine);
      return { path: p.lease, record: mine };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raw = await readFile(p.lease, "utf8");
      const owner = parse(raw);
      if (!owner || owner.issueNumber !== issueNumber)
        throw new IssueRunLeaseConflictError(p.lease, "lease", issueNumber);
      if (
        owner.hostname !== mine.hostname ||
        (options.processState ?? processState)(owner.pid) !== "dead"
      )
        throw new IssueRunLeaseConflictError(
          p.lease,
          "lease",
          issueNumber,
          owner,
        );
      // Never derive archive paths from lease contents: corrupt lease metadata
      // is untrusted, while this name is entirely controlled by Patchmill.
      const stale = join(
        runStateDir,
        "archive",
        "leases",
        `issue-${issueNumber}`,
        `${Date.now()}-${randomUUID()}.json`,
      );
      await mkdir(dirname(stale), { recursive: true });
      await rename(p.lease, stale);
      await exclusive(p.lease, mine);
      return { path: p.lease, record: mine };
    }
  } finally {
    await releaseGuard();
  }
}
export async function releaseIssueRunLease(
  lease: IssueRunLease,
): Promise<void> {
  const dir = dirname(dirname(lease.path));
  const releaseGuard = await guard(dir, lease.record.issueNumber, {
    ...lease.record,
    ownerToken: randomUUID(),
  });
  try {
    const raw = await readFile(lease.path, "utf8");
    if (parse(raw)?.ownerToken !== lease.record.ownerToken)
      throw new Error(
        `Issue run lease is not owned by this Run attempt: ${lease.path}`,
      );
    await unlink(lease.path);
  } finally {
    await releaseGuard();
  }
}
export async function withIssueRunLease<T>(
  input: { runStateDir: string; issueNumber: number; lease?: IssueRunLease },
  action: (lease: IssueRunLease) => Promise<T>,
): Promise<T> {
  if (input.lease) {
    if (input.lease.record.issueNumber !== input.issueNumber)
      throw new Error("Borrowed Issue run lease belongs to another issue");
    return action(input.lease);
  }
  const lease = await acquireIssueRunLease(
    input.runStateDir,
    input.issueNumber,
  );
  try {
    return await action(lease);
  } finally {
    await releaseIssueRunLease(lease);
  }
}
export function activeRunRecoveryDecision(
  error: IssueRunLeaseConflictError,
): Extract<RunRecoveryDecision, { action: "refuse"; reason: "active-run" }> {
  return {
    action: "refuse",
    reason: "active-run",
    resource: error.resource,
    leasePath: error.leasePath,
    ...(error.owner ? { owner: error.owner } : {}),
    guidance: [
      `Wait for the active Run attempt or inspect with: patchmill run lease repair --issue ${error.issueNumber}`,
    ],
  };
}
