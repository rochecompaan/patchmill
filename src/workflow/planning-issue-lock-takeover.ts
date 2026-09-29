import { lstat, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type PlanningLockObservation<Record> = Readonly<{
  classification: "active" | "stale" | "unverifiable" | "malformed";
  path: string;
  bytes: Buffer;
  fingerprint: string;
  record?: Record;
}>;

export type PlanningIssueLockTakeoverAdapter<Record, Lock> = Readonly<{
  observe(path: string): Promise<PlanningLockObservation<Record> | undefined>;
  serialize(record: Record): Buffer;
  createCanonical(): Promise<Lock>;
  conflict(
    observation: PlanningLockObservation<Record>,
    resource: "canonical-lock" | "takeover-transition",
  ): never;
}>;

type Owner = { ownershipId: string };

function issueNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(
      "Planning issue lock takeover requires a positive issue number",
    );
  return value;
}

function ownershipId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    throw new TypeError(
      "Planning issue lock takeover requires a UUID ownership ID",
    );
  return value;
}

function locations(runStateDir: string, number: number, id: string) {
  const root = resolve(runStateDir, "planning-pr-v1");
  const locks = join(root, "locks");
  return {
    locks,
    transition: join(locks, `issue-${number}.takeover`),
    transitionTemp: join(locks, `.issue-${number}.takeover.${id}.tmp`),
    transitionRetired: join(locks, `.issue-${number}.takeover.${id}.retired`),
    issueArchive: join(root, "archive", "issue-locks", `issue-${number}`),
    transitionArchive: join(
      root,
      "archive",
      "issue-lock-transitions",
      `issue-${number}`,
    ),
  };
}

async function stageDirectory(input: {
  path: string;
  ownerFile: string;
  bytes: Buffer;
}): Promise<void> {
  await mkdir(input.path, { recursive: false, mode: 0o700 });
  const handle = await open(join(input.path, input.ownerFile), "wx", 0o600);
  try {
    await handle.writeFile(input.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isAlreadyPresent(error: unknown): boolean {
  return ["EEXIST", "ENOTEMPTY", "ENOTDIR"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );
}

async function removePrivateDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** Avoid rename's replacement semantics for forensic archive destinations. */
async function renameWithoutReplacing(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await lstat(destination);
    const error = new Error(
      "Planning issue lock archive already exists",
    ) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(source, destination);
}

async function acquireTransition<Record extends Owner, Lock>(input: {
  location: ReturnType<typeof locations>;
  transitionOwner: Record;
  adapter: PlanningIssueLockTakeoverAdapter<Record, Lock>;
}): Promise<void> {
  while (true) {
    const current = await input.adapter.observe(input.location.transition);
    if (current !== undefined) {
      if (current.classification !== "stale" || current.record === undefined)
        input.adapter.conflict(current, "takeover-transition");

      const archive = join(
        input.location.transitionArchive,
        ownershipId(current.record.ownershipId),
      );
      await mkdir(input.location.transitionArchive, { recursive: true });
      await renameWithoutReplacing(input.location.transition, archive);
      continue;
    }

    try {
      await stageDirectory({
        path: input.location.transitionTemp,
        ownerFile: "owner.lock",
        bytes: input.adapter.serialize(input.transitionOwner),
      });
      try {
        await rename(input.location.transitionTemp, input.location.transition);
        return;
      } catch (error) {
        await removePrivateDirectory(input.location.transitionTemp);
        if (!isAlreadyPresent(error)) throw error;
      }
    } catch (error) {
      if (!isAlreadyPresent(error)) throw error;
    }
  }
}

async function retireTransition<Record extends Owner, Lock>(input: {
  location: ReturnType<typeof locations>;
  transitionOwnershipId: string;
  adapter: PlanningIssueLockTakeoverAdapter<Record, Lock>;
}): Promise<void> {
  const current = await input.adapter.observe(input.location.transition);
  if (current === undefined)
    throw new Error(
      "Planning issue lock transition disappeared before retirement",
    );
  if (current.classification === "malformed" || current.record === undefined)
    throw new Error(
      "Planning issue lock transition is malformed during retirement",
    );
  if (current.record.ownershipId !== input.transitionOwnershipId)
    throw new Error(
      "Planning issue lock transition ownership changed before retirement",
    );
  try {
    await rename(input.location.transition, input.location.transitionRetired);
  } catch (error) {
    if (!isAlreadyPresent(error)) throw error;
    throw new Error(
      "Planning issue lock transition retirement path already exists",
      {
        cause: error,
      },
    );
  }
  await removePrivateDirectory(input.location.transitionRetired);
}

/**
 * Serializes stale canonical-lock takeover through a durable ownership directory.
 * The adapter keeps the public lock facade independent of transition mechanics.
 */
export async function takeOverStalePlanningIssueLock<
  Record extends Owner,
  Lock,
>(input: {
  runStateDir: string;
  issueNumber: number;
  canonicalPath: string;
  triggeringObservation: PlanningLockObservation<Record>;
  transitionOwner: Record;
  adapter: PlanningIssueLockTakeoverAdapter<Record, Lock>;
}): Promise<{
  lock: Lock;
  evidence?: Readonly<{
    owner: Record;
    fingerprint: string;
    sourcePath: string;
    archivePath: string;
  }>;
}> {
  const number = issueNumber(input.issueNumber);
  const transitionId = ownershipId(input.transitionOwner.ownershipId);
  const location = locations(input.runStateDir, number, transitionId);
  await mkdir(location.locks, { recursive: true });
  await acquireTransition({
    location,
    transitionOwner: input.transitionOwner,
    adapter: input.adapter,
  });

  try {
    const canonical = await input.adapter.observe(input.canonicalPath);
    if (canonical === undefined)
      return { lock: await input.adapter.createCanonical() };
    if (canonical.classification !== "stale" || canonical.record === undefined)
      input.adapter.conflict(canonical, "canonical-lock");

    const source = await stat(input.canonicalPath);
    const ownerId = ownershipId(canonical.record.ownershipId);
    const archive = source.isDirectory()
      ? join(location.issueArchive, ownerId)
      : join(location.issueArchive, `${ownerId}.lock`);
    await mkdir(location.issueArchive, { recursive: true });
    await renameWithoutReplacing(input.canonicalPath, archive);
    return {
      lock: await input.adapter.createCanonical(),
      evidence: {
        owner: canonical.record,
        fingerprint: canonical.fingerprint,
        sourcePath: canonical.path,
        archivePath: source.isDirectory()
          ? join(archive, "owner.record")
          : archive,
      },
    };
  } finally {
    await retireTransition({
      location,
      transitionOwnershipId: transitionId,
      adapter: input.adapter,
    });
  }
}
