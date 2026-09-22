import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { hostname as localHostname } from "node:os";
import { join, resolve } from "node:path";
import {
  takeOverStalePlanningIssueLock,
  type PlanningLockObservation,
} from "./planning-issue-lock-takeover.ts";

export type PlanningIssueLockRecord = Readonly<{
  version: 1;
  issueNumber: number;
  runId: string;
  ownershipId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}>;
export type PlanningIssueLockResource =
  | "canonical-lock"
  | "takeover-transition";
export type PlanningIssueLockTakeoverEvidence = Readonly<{
  owner: PlanningIssueLockRecord;
  fingerprint: string;
  sourcePath: string;
  archivePath: string;
}>;
export type PlanningIssueLock = Readonly<{
  path: string;
  record: PlanningIssueLockRecord;
  takeover?: PlanningIssueLockTakeoverEvidence;
}>;
export type PlanningIssueLockOptions = Readonly<{
  ownershipId?: string;
  transitionOwnershipId?: string;
  pid?: number;
  hostname?: string;
  now?: () => Date;
  processState?: (pid: number) => "alive" | "dead" | "unverifiable";
}>;
export type PlanningIssueLockDiagnostic = Readonly<{
  classification: "active" | "stale" | "unverifiable" | "malformed";
  resource: PlanningIssueLockResource;
  path: string;
  fingerprint: string;
  owner?: Readonly<{
    issueNumber: number;
    runId: string;
    pid: number;
    hostname: string;
    acquiredAt: string;
  }>;
}>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const HOST = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,252}$/u;

type Observation = PlanningLockObservation<PlanningIssueLockRecord>;

function fail(reason: string): never {
  throw new TypeError(`Planning issue lock is invalid: ${reason}`);
}
function positive(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : fail("positive-integer");
}
function uuid(value: unknown): string {
  return typeof value === "string" && UUID.test(value) ? value : fail("uuid");
}
function time(value: unknown): string {
  return typeof value === "string" &&
    TIMESTAMP.test(value) &&
    new Date(value).toISOString() === value
    ? value
    : fail("timestamp");
}
export function planningIssueLockPath(
  runStateDir: string,
  issueNumber: number,
): string {
  positive(issueNumber);
  return join(
    resolve(runStateDir),
    "planning-pr-v1",
    "locks",
    `issue-${issueNumber}.lock`,
  );
}
export function parsePlanningIssueLockRecord(
  raw: string,
): PlanningIssueLockRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail("json");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail("object");
  const v = value as Record<string, unknown>;
  const keys = [
    "version",
    "issueNumber",
    "runId",
    "ownershipId",
    "pid",
    "hostname",
    "acquiredAt",
  ];
  if (
    Object.keys(v).length !== keys.length ||
    keys.some((key) => !(key in v)) ||
    Object.keys(v).some((key) => !keys.includes(key))
  )
    return fail("keys");
  if (v.version !== 1) return fail("version");
  const host =
    typeof v.hostname === "string" && HOST.test(v.hostname)
      ? v.hostname
      : fail("hostname");
  return {
    version: 1,
    issueNumber: positive(v.issueNumber),
    runId: uuid(v.runId),
    ownershipId: uuid(v.ownershipId),
    pid: positive(v.pid),
    hostname: host,
    acquiredAt: time(v.acquiredAt),
  };
}
function liveness(pid: number): "alive" | "dead" | "unverifiable" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "dead"
      : "unverifiable";
  }
}
function resourceDiagnostic(
  observation: Observation,
  resource: PlanningIssueLockResource,
): PlanningIssueLockDiagnostic {
  return {
    classification: observation.classification,
    resource,
    path: observation.path,
    fingerprint: observation.fingerprint,
    ...(observation.record === undefined
      ? {}
      : {
          owner: {
            issueNumber: observation.record.issueNumber,
            runId: observation.record.runId,
            pid: observation.record.pid,
            hostname: observation.record.hostname,
            acquiredAt: observation.record.acquiredAt,
          },
        }),
  };
}
async function observeLock(
  path: string,
  options: PlanningIssueLockOptions,
): Promise<Observation | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  let record: PlanningIssueLockRecord;
  try {
    record = parsePlanningIssueLockRecord(bytes.toString("utf8"));
  } catch {
    return { classification: "malformed", path, bytes, fingerprint };
  }
  const here = options.hostname ?? localHostname();
  const state =
    record.hostname === here
      ? (options.processState ?? liveness)(record.pid)
      : "unverifiable";
  return {
    classification:
      state === "alive"
        ? "active"
        : state === "dead"
          ? "stale"
          : "unverifiable",
    path,
    bytes,
    fingerprint,
    record,
  };
}

export class PlanningIssueLockConflictError extends Error {
  readonly diagnostic: PlanningIssueLockDiagnostic;
  constructor(diagnostic: PlanningIssueLockDiagnostic) {
    super(`Planning issue lock conflict: ${diagnostic.classification}`);
    this.name = "PlanningIssueLockConflictError";
    this.diagnostic = diagnostic;
  }
}

async function createExclusivePlanningIssueLock(
  path: string,
  record: PlanningIssueLockRecord,
): Promise<PlanningIssueLock> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    return { path, record };
  } catch (error) {
    if (handle === undefined) throw error;
    const failures: unknown[] = [error];
    try {
      await handle.close();
    } catch (closeError) {
      failures.push(closeError);
    }
    try {
      await unlink(path);
    } catch (unlinkError) {
      if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT")
        failures.push(unlinkError);
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "Planning issue lock cleanup failed", {
        cause: error,
      });
    throw error;
  }
}

export async function acquirePlanningIssueLock(
  runStateDir: string,
  input: { issueNumber: number; runId: string },
  options: PlanningIssueLockOptions = {},
): Promise<PlanningIssueLock> {
  const path = planningIssueLockPath(runStateDir, input.issueNumber);
  const record: PlanningIssueLockRecord = {
    version: 1,
    issueNumber: positive(input.issueNumber),
    runId: uuid(input.runId),
    ownershipId: uuid(options.ownershipId ?? randomUUID()),
    pid: positive(options.pid ?? process.pid),
    hostname: options.hostname ?? localHostname(),
    acquiredAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  if (!HOST.test(record.hostname)) fail("hostname");
  await mkdir(join(resolve(runStateDir), "planning-pr-v1", "locks"), {
    recursive: true,
  });
  try {
    return await createExclusivePlanningIssueLock(path, record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const initial = await observeLock(path, options);
  if (initial === undefined)
    return createExclusivePlanningIssueLock(path, record);
  if (initial.classification !== "stale")
    throw new PlanningIssueLockConflictError(
      resourceDiagnostic(initial, "canonical-lock"),
    );

  const transitionOwner: PlanningIssueLockRecord = {
    ...record,
    ownershipId: uuid(options.transitionOwnershipId ?? randomUUID()),
  };
  const takeover = await takeOverStalePlanningIssueLock({
    runStateDir,
    issueNumber: record.issueNumber,
    canonicalPath: path,
    triggeringObservation: initial,
    transitionOwner,
    adapter: {
      observe: (target) => observeLock(target, options),
      serialize: (owner) => Buffer.from(`${JSON.stringify(owner)}\n`),
      createCanonical: () => createExclusivePlanningIssueLock(path, record),
      conflict: (observation, resource): never => {
        throw new PlanningIssueLockConflictError(
          resourceDiagnostic(observation, resource),
        );
      },
    },
  });
  return takeover.evidence === undefined
    ? takeover.lock
    : { ...takeover.lock, takeover: takeover.evidence };
}
export async function assertPlanningIssueLockOwned(
  lock: PlanningIssueLock,
  expected: { issueNumber: number; runId: string; lockPath?: string },
): Promise<void> {
  if (
    expected.lockPath !== undefined &&
    resolve(expected.lockPath) !== resolve(lock.path)
  )
    throw new PlanningIssueLockConflictError({
      classification: "malformed",
      resource: "canonical-lock",
      path: lock.path,
      fingerprint: "",
    });
  if (
    expected.issueNumber !== lock.record.issueNumber ||
    expected.runId !== lock.record.runId
  )
    throw new PlanningIssueLockConflictError({
      classification: "malformed",
      resource: "canonical-lock",
      path: lock.path,
      fingerprint: "",
    });
  const current = parsePlanningIssueLockRecord(
    await readFile(lock.path, "utf8"),
  );
  if (
    current.issueNumber !== expected.issueNumber ||
    current.runId !== expected.runId ||
    current.ownershipId !== lock.record.ownershipId
  )
    throw new PlanningIssueLockConflictError({
      classification: "malformed",
      resource: "canonical-lock",
      path: lock.path,
      fingerprint: "",
    });
}
export async function releasePlanningIssueLock(
  lock: PlanningIssueLock,
): Promise<void> {
  try {
    await assertPlanningIssueLockOwned(lock, {
      issueNumber: lock.record.issueNumber,
      runId: lock.record.runId,
      lockPath: lock.path,
    });
    await unlink(lock.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
