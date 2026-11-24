import fs from "node:fs/promises";
import { join } from "node:path";
import type { Stall } from "./stall-watch.ts";

/** The record that a Run attempt stopped at the Stall limit, in the issue directory. */
export const STALL_BLOCK_FILE = "stall-block.json";
const RESUMED_FILE = "stall-block-resumed.json";

export async function writeStallBlock(
  issueDir: string,
  record: { runId: string; stalls: Stall[] },
): Promise<void> {
  await fs.mkdir(issueDir, { recursive: true });
  await fs.writeFile(
    join(issueDir, STALL_BLOCK_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

/** The Stalls of the record, or undefined when it is missing or broken. */
export async function readStallBlock(
  issueDir: string,
): Promise<Stall[] | undefined> {
  try {
    const record: unknown = JSON.parse(
      await fs.readFile(join(issueDir, STALL_BLOCK_FILE), "utf8"),
    );
    const stalls = (record as { stalls?: unknown } | null)?.stalls;
    return Array.isArray(stalls) && stalls.length
      ? (stalls as Stall[])
      : undefined;
  } catch {
    return undefined;
  }
}

/** Moves the record to `<runDir>/stall-block-resumed.json`. A missing record is not an error. */
export async function consumeStallBlock(
  issueDir: string,
  runDir: string,
): Promise<void> {
  try {
    await fs.mkdir(runDir, { recursive: true });
    await fs.rename(
      join(issueDir, STALL_BLOCK_FILE),
      join(runDir, RESUMED_FILE),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
