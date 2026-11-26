import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** pi-subagents accepts a `timeoutMs` of at most 2^31 - 1 ms. */
export const MAX_SUBAGENT_TIMEOUT_MS = 2_147_483_647;
/** A child gets "checkpoint and stop" this long before its deadline. */
export const SUBAGENT_CHECKPOINT_MS = 300_000;

/**
 * The pi-subagents deadline that follows the Session cap. Without a cap, a
 * child gets the largest deadline pi-subagents accepts.
 */
export function subagentLimits(timeoutMinutes: number | null): {
  timeoutMs: number;
  checkpointBeforeDeadlineMs: number;
} {
  const timeoutMs =
    timeoutMinutes === null
      ? MAX_SUBAGENT_TIMEOUT_MS
      : Math.min(
          MAX_SUBAGENT_TIMEOUT_MS,
          Math.max(1, Math.round(timeoutMinutes * 60_000)),
        );
  return { timeoutMs, checkpointBeforeDeadlineMs: SUBAGENT_CHECKPOINT_MS };
}

/**
 * Writes the managed deadline keys into the pi-subagents config of the agent
 * dir and keeps every other key. A malformed file is an error, never replaced.
 */
export async function provisionSubagentLimits(
  agentDir: string,
  timeoutMinutes: number | null,
): Promise<void> {
  const file = join(agentDir, "extensions", "subagent", "config.json");
  let existing: string | undefined;
  try {
    existing = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let current: Record<string, unknown> = {};
  if (existing !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      throw new Error(`Invalid JSON in ${file}; fix or remove it`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error(`${file} must contain a JSON object; fix or remove it`);
    current = parsed as Record<string, unknown>;
  }
  const content = `${JSON.stringify({ ...current, ...subagentLimits(timeoutMinutes) }, null, 2)}\n`;
  await writeAtomically(file, content, existing);
}

/** Writes through a temporary file and a rename, only when content changes. */
export async function writeAtomically(
  file: string,
  content: string,
  existing?: string,
): Promise<boolean> {
  if (existing === content) return false;
  await mkdir(dirname(file), { recursive: true });
  // A unique name, so concurrent writers in one process do not share it.
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return true;
}
