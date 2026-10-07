import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import type { RunRepositoryNamespace } from "./run-repository-namespace.ts";

export type { RunRepositoryNamespace } from "./run-repository-namespace.ts";
export type RunAdmissionMode = "explicit" | "automatic" | "recovery";
export type RunAdmission = {
  namespace: RunRepositoryNamespace;
  attemptId: string;
  mode: RunAdmissionMode;
  recordPath: string;
  ownerToken: string;
};
type AdmissionRecord = {
  version: 1;
  attemptId: string;
  ownerToken: string;
  mode: RunAdmissionMode;
  issueNumber?: number;
  pid: number;
  hostname: string;
};
type GuardRecord = {
  version: 1;
  ownerToken: string;
  pid: number;
  hostname: string;
};

export class RunAdmissionConflictError extends Error {
  readonly recordPath: string;
  constructor(recordPath: string) {
    super(`Run-once admission conflicts with active attempt: ${recordPath}`);
    this.name = "RunAdmissionConflictError";
    this.recordPath = recordPath;
  }
}

function recordPath(
  namespace: RunRepositoryNamespace,
  attemptId: string,
): string {
  const id = createHash("sha256").update(attemptId).digest("hex");
  return join(
    namespace.commonDir,
    "patchmill",
    "run-once",
    "admissions",
    `${id}.json`,
  );
}
function parse(raw: string): AdmissionRecord | undefined {
  try {
    const value = JSON.parse(raw) as Partial<AdmissionRecord>;
    return value.version === 1 &&
      typeof value.attemptId === "string" &&
      typeof value.ownerToken === "string" &&
      (value.mode === "explicit" ||
        value.mode === "automatic" ||
        value.mode === "recovery") &&
      Number.isSafeInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.hostname === "string"
      ? (value as AdmissionRecord)
      : undefined;
  } catch {
    return undefined;
  }
}
function parseGuard(raw: string): GuardRecord | undefined {
  try {
    const value = JSON.parse(raw) as Partial<GuardRecord>;
    return value.version === 1 &&
      typeof value.ownerToken === "string" &&
      Number.isSafeInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.hostname === "string"
      ? (value as GuardRecord)
      : undefined;
  } catch {
    return undefined;
  }
}
function live(record: Pick<AdmissionRecord, "hostname" | "pid">): boolean {
  if (record.hostname !== hostname()) return true;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
function waits(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function guardOwnerPath(guard: string): string {
  return join(guard, "owner.json");
}
async function archiveDeadDirectory(
  root: string,
  guard: string,
  raw: string,
): Promise<void> {
  const reconciliation = join(root, "admission-reconciliation.lock");
  const mine = `${JSON.stringify({ version: 1, ownerToken: randomUUID(), pid: process.pid, hostname: hostname() })}\n`;
  let handle;
  try {
    handle = await open(reconciliation, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new RunAdmissionConflictError(reconciliation);
    throw error;
  }
  try {
    await handle.writeFile(mine);
    await handle.sync();
    const current = await readFile(guardOwnerPath(guard), "utf8");
    const owner = parseGuard(current);
    if (
      current !== raw ||
      !owner ||
      owner.hostname !== hostname() ||
      live(owner)
    )
      throw new RunAdmissionConflictError(guard);
    const archiveRoot = join(root, "archive", "admission-guards");
    await mkdir(archiveRoot, { recursive: true });
    await rename(guard, join(archiveRoot, `${Date.now()}-${randomUUID()}`));
  } finally {
    await handle.close();
    if ((await readFile(reconciliation, "utf8")) === mine)
      await unlink(reconciliation);
  }
}
async function acquireGuard(
  root: string,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  const guard = join(root, "admission-guard");
  while (true) {
    if (signal?.aborted) throw signal.reason ?? new Error("Admission aborted");
    const mine: GuardRecord = {
      version: 1,
      ownerToken: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
    };
    const expected = `${JSON.stringify(mine)}\n`;
    try {
      await mkdir(guard, { recursive: false, mode: 0o700 });
      const owner = await open(guardOwnerPath(guard), "wx", 0o600);
      try {
        await owner.writeFile(expected);
        await owner.sync();
      } finally {
        await owner.close();
      }
      return async () => {
        const current = await readFile(guardOwnerPath(guard), "utf8");
        if (
          current !== expected ||
          parseGuard(current)?.ownerToken !== mine.ownerToken
        )
          throw new Error(
            "Run-once admission guard is not owned by this attempt",
          );
        await rm(guard, { recursive: true, force: false });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let raw: string;
      try {
        raw = await readFile(guardOwnerPath(guard), "utf8");
      } catch {
        throw new RunAdmissionConflictError(guard);
      }
      const owner = parseGuard(raw);
      if (!owner || owner.hostname !== hostname())
        throw new RunAdmissionConflictError(guard);
      if (live(owner)) {
        await waits(10);
        continue;
      }
      await archiveDeadDirectory(root, guard, raw);
    }
  }
}
async function archiveDeadRecord(
  root: string,
  path: string,
  raw: string,
): Promise<void> {
  const current = await readFile(path, "utf8");
  if (current !== raw) throw new RunAdmissionConflictError(path);
  const archiveRoot = join(root, "archive", "admissions");
  await mkdir(archiveRoot, { recursive: true });
  await rename(path, join(archiveRoot, `${Date.now()}-${basename(path)}`));
}
async function activeRecords(
  root: string,
  directory: string,
): Promise<Array<{ path: string; record: AdmissionRecord }>> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: Array<{ path: string; record: AdmissionRecord }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json"))
      throw new RunAdmissionConflictError(join(directory, entry.name));
    const path = join(directory, entry.name);
    const raw = await readFile(path, "utf8");
    const record = parse(raw);
    if (!record) throw new RunAdmissionConflictError(path);
    if (live(record)) records.push({ path, record });
    else await archiveDeadRecord(root, path, raw);
  }
  return records;
}
function conflicts(
  mode: RunAdmissionMode,
  records: AdmissionRecord[],
): boolean {
  return mode === "automatic"
    ? records.length > 0
    : records.some((record) => record.mode === "automatic");
}
async function removeOwned(admission: RunAdmission): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(admission.recordPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (parse(raw)?.ownerToken !== admission.ownerToken) return;
  await unlink(admission.recordPath);
}

/** Registers only an attempt admission; the repository guard ends before action work. */
export async function withRunAdmission<T>(
  input: {
    namespace: RunRepositoryNamespace;
    attemptId: string;
    mode: RunAdmissionMode;
    issueNumber?: number;
    signal?: AbortSignal;
  },
  action: (admission: RunAdmission) => Promise<T>,
): Promise<T> {
  const root = join(input.namespace.commonDir, "patchmill", "run-once");
  const directory = join(root, "admissions");
  await mkdir(directory, { recursive: true });
  const releaseGuard = await acquireGuard(root, input.signal);
  const ownerToken = randomUUID();
  const admission: RunAdmission = {
    namespace: input.namespace,
    attemptId: input.attemptId,
    mode: input.mode,
    recordPath: recordPath(input.namespace, input.attemptId),
    ownerToken,
  };
  try {
    const active = await activeRecords(root, directory);
    if (
      conflicts(
        input.mode,
        active.map(({ record }) => record),
      )
    )
      throw new RunAdmissionConflictError(active[0]?.path ?? directory);
    const handle = await open(admission.recordPath, "wx", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({
          version: 1,
          attemptId: input.attemptId,
          ownerToken,
          mode: input.mode,
          ...(input.issueNumber === undefined
            ? {}
            : { issueNumber: input.issueNumber }),
          pid: process.pid,
          hostname: hostname(),
        })}\n`,
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
  } finally {
    await releaseGuard();
  }
  let result: T | undefined;
  let workFailed = false;
  let workFailure: unknown;
  try {
    result = await action(admission);
  } catch (error) {
    workFailed = true;
    workFailure = error;
  }
  try {
    const release = await acquireGuard(root);
    try {
      await removeOwned(admission);
    } finally {
      await release();
    }
  } catch (releaseFailure) {
    if (workFailed)
      throw new AggregateError(
        [workFailure, releaseFailure],
        "Run admission work and release failed",
        { cause: releaseFailure },
      );
    throw releaseFailure;
  }
  if (workFailed) throw workFailure;
  return result as T;
}
