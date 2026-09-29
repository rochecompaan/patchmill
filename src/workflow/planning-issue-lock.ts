import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { hostname as localHostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
const OWNER_RECORD = "owner.record";
const TRANSITION_RECORD = "owner.lock";

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
function fingerprint(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
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

function malformed(path: string, bytes: Buffer): Observation {
  return {
    classification: "malformed",
    path,
    bytes,
    fingerprint: fingerprint(bytes),
  };
}

async function ownerBytesFromDirectory(
  path: string,
  ownerFile: string,
): Promise<Buffer | undefined> {
  const entries = await readdir(path, { withFileTypes: true });
  const [entry] = entries;
  if (
    entries.length !== 1 ||
    entry === undefined ||
    entry.name !== ownerFile ||
    !entry.isFile() ||
    entry.isSymbolicLink()
  )
    return undefined;
  const ownerPath = join(path, ownerFile);
  const owner = await lstat(ownerPath);
  if (
    !owner.isFile() ||
    owner.isSymbolicLink() ||
    (owner.mode & 0o777) !== 0o600
  )
    return undefined;
  return readFile(ownerPath);
}

async function structuralBytes(path: string): Promise<Buffer> {
  const entries = await readdir(path, { withFileTypes: true });
  const inventory = await Promise.all(
    entries.map(async (entry) => {
      const entryStat = await lstat(join(path, entry.name));
      return `${entry.name}:${entryStat.mode & 0o777}:${entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other"}`;
    }),
  );
  return Buffer.from(inventory.sort().join("\n"));
}

async function observeLock(
  path: string,
  options: PlanningIssueLockOptions,
  ownerFile = OWNER_RECORD,
): Promise<Observation | undefined> {
  let source;
  try {
    source = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const bytes = source.isDirectory()
    ? await ownerBytesFromDirectory(path, ownerFile)
    : source.isFile() && !source.isSymbolicLink()
      ? await readFile(path)
      : undefined;
  if (bytes === undefined)
    return malformed(
      path,
      source.isDirectory()
        ? await structuralBytes(path)
        : Buffer.from(`invalid-lock-type:${source.mode}`),
    );
  let record: PlanningIssueLockRecord;
  try {
    record = parsePlanningIssueLockRecord(bytes.toString("utf8"));
  } catch {
    return malformed(path, bytes);
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
    fingerprint: fingerprint(bytes),
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

function isAlreadyPresent(error: unknown): boolean {
  return ["EEXIST", "ENOTEMPTY"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );
}

function planningIssueLockTransitionPath(
  runStateDir: string,
  issueNumber: number,
): string {
  return join(
    resolve(runStateDir),
    "planning-pr-v1",
    "locks",
    `issue-${positive(issueNumber)}.takeover`,
  );
}

async function createExclusivePlanningIssueLock(
  path: string,
  record: PlanningIssueLockRecord,
): Promise<PlanningIssueLock> {
  try {
    await lstat(path);
    const error = new Error(
      "Planning issue lock already exists",
    ) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${record.ownershipId}.tmp`,
  );
  try {
    await mkdir(temporary, { recursive: false, mode: 0o700 });
    const handle = await open(join(temporary, OWNER_RECORD), "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    return { path, record };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function lockRecord(
  input: { issueNumber: number; runId: string },
  options: PlanningIssueLockOptions,
): PlanningIssueLockRecord {
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
  return record;
}

export async function acquirePlanningIssueLock(
  runStateDir: string,
  input: { issueNumber: number; runId: string },
  options: PlanningIssueLockOptions = {},
): Promise<PlanningIssueLock> {
  const path = planningIssueLockPath(runStateDir, input.issueNumber);
  const transitionPath = planningIssueLockTransitionPath(
    runStateDir,
    input.issueNumber,
  );
  const record = lockRecord(input, options);
  await mkdir(dirname(path), { recursive: true });
  const initial = await observeLock(path, options);
  const transitionOwner = (): PlanningIssueLockRecord => ({
    ...record,
    ownershipId: uuid(options.transitionOwnershipId ?? randomUUID()),
  });
  const adapter = {
    observe: (target: string) =>
      observeLock(
        target,
        options,
        target.endsWith(".takeover") ? TRANSITION_RECORD : OWNER_RECORD,
      ),
    serialize: (owner: PlanningIssueLockRecord) =>
      Buffer.from(`${JSON.stringify(owner)}\n`),
    createCanonical: async () => {
      try {
        return await createExclusivePlanningIssueLock(path, record);
      } catch (error) {
        if (!isAlreadyPresent(error)) throw error;
        const replacement = await observeLock(path, options);
        if (replacement === undefined) throw error;
        throw new PlanningIssueLockConflictError(
          resourceDiagnostic(replacement, "canonical-lock"),
        );
      }
    },
    conflict: (
      observation: Observation,
      resource: PlanningIssueLockResource,
    ): never => {
      throw new PlanningIssueLockConflictError(
        resourceDiagnostic(observation, resource),
      );
    },
  };
  let transition: Observation | undefined;
  if (initial === undefined) {
    transition = await observeLock(transitionPath, options, TRANSITION_RECORD);
    if (transition === undefined) {
      try {
        return await adapter.createCanonical();
      } catch (error) {
        if (!(error instanceof PlanningIssueLockConflictError)) throw error;
      }
    } else if (transition.classification !== "stale") {
      throw new PlanningIssueLockConflictError(
        resourceDiagnostic(transition, "takeover-transition"),
      );
    }
  }
  const conflict = initial ?? (await observeLock(path, options));
  if (conflict !== undefined && conflict.classification !== "stale")
    throw new PlanningIssueLockConflictError(
      resourceDiagnostic(conflict, "canonical-lock"),
    );

  const takeover = await takeOverStalePlanningIssueLock({
    runStateDir,
    issueNumber: record.issueNumber,
    canonicalPath: path,
    triggeringObservation: conflict ?? transition!,
    transitionOwner: transitionOwner(),
    adapter,
  });
  return takeover.evidence === undefined
    ? takeover.lock
    : { ...takeover.lock, takeover: takeover.evidence };
}

async function currentCanonicalRecord(
  path: string,
): Promise<PlanningIssueLockRecord> {
  const bytes = await ownerBytesFromDirectory(path, OWNER_RECORD);
  if (bytes === undefined)
    throw new Error("Planning issue lock ownership changed");
  return parsePlanningIssueLockRecord(bytes.toString("utf8"));
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
  const current = await currentCanonicalRecord(lock.path);
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
    const retired = join(
      dirname(lock.path),
      `.${basename(lock.path)}.${lock.record.ownershipId}.retired`,
    );
    await rename(lock.path, retired);
    await rm(retired, { recursive: true, force: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
