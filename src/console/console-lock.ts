import { resolve } from "node:path";
import {
  acquireLock,
  LockHeldError,
  probeIssueLock,
  type IssueLock,
} from "../kernel/lock.ts";

export const CONSOLE_SESSION_BUSY = (issue: number) =>
  `Issue #${issue}'s Console session is open in another process. Close it first.`;

export function consoleLockPath(
  repoRoot: string,
  runsDir: string,
  issue: number,
): string {
  return resolve(repoRoot, runsDir, `issue-${issue}`, "console", "lock");
}

/**
 * Take the Console session lock. Only one process writes an issue's Console
 * session. Returns `undefined` when another holder has it. Keep the returned
 * lock referenced: its file handle holds the lock.
 */
export async function acquireConsoleLock(
  repoRoot: string,
  runsDir: string,
  issue: number,
): Promise<IssueLock | undefined> {
  try {
    return await acquireLock(consoleLockPath(repoRoot, runsDir, issue));
  } catch (error) {
    if (error instanceof LockHeldError) return undefined;
    throw error;
  }
}

export function consoleLockHeld(
  repoRoot: string,
  runsDir: string,
  issue: number,
): Promise<boolean> {
  return probeIssueLock(consoleLockPath(repoRoot, runsDir, issue));
}
