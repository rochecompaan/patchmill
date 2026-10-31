import fs from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import fsExt from "fs-ext";

export type LockRecord = { pid: number; startedAt: string };

export class LockHeldError extends Error {
  readonly record: LockRecord | undefined;

  constructor(record: LockRecord | undefined) {
    super(
      record
        ? `Issue lock held (pid ${record.pid})`
        : "Issue lock held (owner unknown)",
    );
    this.name = "LockHeldError";
    this.record = record;
  }
}

export type IssueLock = { path: string; release(): Promise<void> };

/** Diagnostic data only: neither its presence nor absence establishes ownership. */
export async function readLock(path: string): Promise<LockRecord | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      typeof value.pid === "number" &&
      "startedAt" in value &&
      typeof value.startedAt === "string"
    ) {
      return { pid: value.pid, startedAt: value.startedAt };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return undefined;
}

export async function acquireLock(
  path: string,
  options: { pid?: number; now?: () => Date } = {},
): Promise<IssueLock> {
  await fs.mkdir(dirname(path), { recursive: true });
  // Keep this inode permanent, including across release and crash recovery.
  const handle = await fs.open(path, constants.O_CREAT | constants.O_RDWR);
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        fsExt.flock(handle.fd, "exnb", (error) =>
          error ? reject(error) : resolve(),
        );
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        throw new LockHeldError(await readLock(path));
      }
      throw error;
    }
    await handle.truncate(0);
    await handle.writeFile(
      JSON.stringify({
        pid: options.pid ?? process.pid,
        startedAt: (options.now ?? (() => new Date()))().toISOString(),
      }),
    );
  } catch (error) {
    try {
      await handle.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Issue lock acquisition and close failed",
        { cause: closeError },
      );
    }
    throw error;
  }
  let released: Promise<void> | undefined;
  return {
    path,
    release() {
      return (released ??= (async () => {
        try {
          await handle.truncate(0);
        } catch (error) {
          try {
            await handle.close();
          } catch (closeError) {
            throw new AggregateError(
              [error, closeError],
              "Issue lock clearing and close failed",
              { cause: closeError },
            );
          }
          throw error;
        }
        await handle.close();
      })());
    },
  };
}
