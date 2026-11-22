import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import type { CommandRunner } from "../../process/command.ts";
import { flock } from "../../process/flock.ts";

export type LifetimeLockRecord = {
  instanceId: string;
  pid: number;
  /** The process start marker; null when the platform has none. */
  processStart: string | null;
  host: string;
  /** The canonical Git common directory of the clone. */
  repository: string;
  startedAt: string;
};

export type LifetimeLock = {
  path: string;
  record: LifetimeLockRecord;
  release(): Promise<void>;
};

export class LifetimeLockHeldError extends Error {
  readonly record: LifetimeLockRecord | undefined;
  readonly path: string;

  constructor(path: string, record: LifetimeLockRecord | undefined, note = "") {
    super(
      `Another patchmill run owns ${path}` +
        (record
          ? ` (pid ${record.pid} on ${record.host}, started ${record.startedAt})`
          : " (owner unknown)") +
        (note ? `. ${note}` : "."),
    );
    this.name = "LifetimeLockHeldError";
    this.record = record;
    this.path = path;
  }
}

/** The lock file in the Git common directory, shared by all worktrees. */
export async function lifetimeLockPath(
  repoRoot: string,
  runner: CommandRunner,
): Promise<string> {
  const result = await runner(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repoRoot },
  );
  if (result.code !== 0)
    throw new Error(
      `Cannot find the Git common directory: ${result.stderr.trim()}`,
    );
  const common = await fs.realpath(result.stdout.trim());
  return join(common, "patchmill", "run.lock");
}

/** Field 22 (starttime) of /proc/<pid>/stat, or null without /proc. */
export async function processStartMarker(pid: number): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  // The command name in field 2 may contain spaces and parentheses.
  const fields = text
    .slice(text.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  return fields[19] ?? null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseRecord(text: string): LifetimeLockRecord | undefined {
  try {
    const value = JSON.parse(text) as Partial<LifetimeLockRecord>;
    if (
      typeof value.pid === "number" &&
      typeof value.host === "string" &&
      typeof value.instanceId === "string" &&
      typeof value.startedAt === "string" &&
      (value.processStart === null || typeof value.processStart === "string") &&
      typeof value.repository === "string"
    )
      return value as LifetimeLockRecord;
  } catch {
    // An unreadable record is the remains of an interrupted write.
  }
  return undefined;
}

type Verdict = { stale: true } | { stale: false; note: string };

async function judge(record: LifetimeLockRecord): Promise<Verdict> {
  if (record.host !== hostname())
    return {
      stale: false,
      note: `It was started on another host. Remove the file when that runner is gone.`,
    };
  if (!alive(record.pid)) return { stale: true };
  const marker = await processStartMarker(record.pid);
  if (
    marker !== null &&
    record.processStart !== null &&
    marker !== record.processStart
  )
    return { stale: true };
  return {
    stale: false,
    note: "Its process is still alive. Stop it first, or remove the file when it is gone.",
  };
}

/**
 * Takes the one-runner lock of the clone. The `flock` decides ownership; the
 * kernel frees it when the owner exits. A record left behind by an unclean
 * exit is replaced only when it is demonstrably stale on this host.
 */
export async function acquireLifetimeLock(input: {
  repoRoot: string;
  runner: CommandRunner;
  now: () => Date;
  log: (line: string) => void;
}): Promise<LifetimeLock> {
  const path = await lifetimeLockPath(input.repoRoot, input.runner);
  await fs.mkdir(dirname(path), { recursive: true });
  // Keep this inode permanent, including across release and crash recovery.
  const handle = await fs.open(path, constants.O_CREAT | constants.O_RDWR);
  let record: LifetimeLockRecord;
  try {
    try {
      await flock(handle.fd, "exnb");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN" || code === "EWOULDBLOCK")
        throw new LifetimeLockHeldError(
          path,
          parseRecord(await fs.readFile(path, "utf8").catch(() => "")),
        );
      throw error;
    }
    const previous = parseRecord(await fs.readFile(path, "utf8"));
    if (previous) {
      const verdict = await judge(previous);
      if (!verdict.stale)
        throw new LifetimeLockHeldError(path, previous, verdict.note);
      input.log(
        `patchmill run: replaced a stale run lock (pid ${previous.pid}, started ${previous.startedAt})`,
      );
    }
    record = {
      instanceId: randomUUID(),
      pid: process.pid,
      processStart: await processStartMarker(process.pid),
      host: hostname(),
      repository: dirname(dirname(path)),
      startedAt: input.now().toISOString(),
    };
    const text = Buffer.from(JSON.stringify(record));
    await handle.truncate(0);
    await handle.write(text, 0, text.length, 0);
  } catch (error) {
    // Closing the descriptor also frees a flock taken above.
    await handle.close().catch(() => {});
    throw error;
  }
  let released: Promise<void> | undefined;
  return {
    path,
    record,
    release() {
      return (released ??= (async () => {
        try {
          await handle.truncate(0);
        } finally {
          await handle.close();
        }
      })());
    },
  };
}
