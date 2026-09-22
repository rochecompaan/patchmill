import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  link,
} from "node:fs/promises";
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

function paths(runStateDir: string, number: number, id: string) {
  const root = resolve(runStateDir, "planning-pr-v1");
  const locks = join(root, "locks");
  return {
    transition: join(locks, `issue-${number}.takeover`),
    transitionOwner: join(locks, `issue-${number}.takeover`, "owner.lock"),
    transitionTemp: join(locks, `.issue-${number}.takeover.${id}.tmp`),
    retired: join(locks, `.issue-${number}.takeover.${id}.retired`),
    issueArchive: join(root, "archive", "issue-locks", `issue-${number}`),
    transitionArchive: join(
      root,
      "archive",
      "issue-lock-transitions",
      `issue-${number}`,
    ),
  };
}

async function writeOwner(path: string, bytes: Buffer): Promise<void> {
  await mkdir(path, { recursive: false, mode: 0o700 });
  const handle = await open(join(path, "owner.lock"), "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function retireTransition(input: {
  transition: string;
  transitionOwner: string;
  retired: string;
  ownershipId: string;
  observe: () => Promise<PlanningLockObservation<Owner> | undefined>;
}): Promise<void> {
  const observation = await input.observe();
  if (observation?.record?.ownershipId !== input.ownershipId) return;
  await rename(input.transition, input.retired);
  await rm(input.retired, { recursive: true, force: false });
}

/**
 * Serializes stale canonical-lock takeover through a durable directory owner.
 * The adapter keeps the public lock facade independent of this filesystem protocol.
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
  const location = paths(input.runStateDir, number, transitionId);
  await mkdir(join(resolve(input.runStateDir), "planning-pr-v1", "locks"), {
    recursive: true,
  });

  while (true) {
    try {
      await writeOwner(
        location.transitionTemp,
        input.adapter.serialize(input.transitionOwner),
      );
      await rename(location.transitionTemp, location.transition);
      break;
    } catch (error) {
      await rm(location.transitionTemp, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await input.adapter.observe(location.transitionOwner);
      if (existing === undefined) continue;
      if (existing.classification !== "stale" || !existing.record)
        input.adapter.conflict(existing, "takeover-transition");
      const staleId = ownershipId(existing.record.ownershipId);
      const archive = join(location.transitionArchive, staleId);
      await mkdir(location.transitionArchive, { recursive: true });
      await rename(location.transition, archive);
    }
  }

  try {
    const canonical = await input.adapter.observe(input.canonicalPath);
    if (canonical === undefined)
      return { lock: await input.adapter.createCanonical() };
    if (canonical.classification !== "stale" || !canonical.record)
      input.adapter.conflict(canonical, "canonical-lock");

    const archivePath = join(
      location.issueArchive,
      `${ownershipId(canonical.record.ownershipId)}.lock`,
    );
    await mkdir(location.issueArchive, { recursive: true });
    try {
      await link(input.canonicalPath, archivePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const archived = await readFile(archivePath);
      if (!archived.equals(canonical.bytes)) throw error;
    }
    await unlink(input.canonicalPath);
    return {
      lock: await input.adapter.createCanonical(),
      evidence: {
        owner: canonical.record,
        fingerprint: canonical.fingerprint,
        sourcePath: canonical.path,
        archivePath,
      },
    };
  } finally {
    await retireTransition({
      transition: location.transition,
      transitionOwner: location.transitionOwner,
      retired: location.retired,
      ownershipId: transitionId,
      observe: () => input.adapter.observe(location.transitionOwner),
    });
  }
}
