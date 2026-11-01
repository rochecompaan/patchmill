import { setTimeout as delay } from "node:timers/promises";
import type { SubagentsClient } from "./subagents-client.ts";

export const STOP_WAIT_MS = 60_000;
export type StopResult =
  | { ok: true; stopped: string[] }
  | { ok: false; stuck: string[] };

/** Stops the given worker IDs, or every active Patchmill worker when `ids`
 * is omitted, and waits until none of them is active. */
export async function stopWorkers(
  client: SubagentsClient,
  options?: { ids?: string[]; waitMs?: number; pollMs?: number },
): Promise<StopResult> {
  const ids =
    options?.ids ?? (await client.activeWorkers()).map(({ id }) => id);
  if (ids.length === 0) return { ok: true, stopped: [] };

  for (const id of ids) {
    try {
      await client.stop(id);
    } catch {
      // A stop reply can fail even when the worker exits; status decides.
    }
  }

  const deadline = Date.now() + (options?.waitMs ?? STOP_WAIT_MS);
  for (;;) {
    const active = new Set((await client.activeWorkers()).map(({ id }) => id));
    const stuck = ids.filter((id) => active.has(id));
    if (stuck.length === 0) return { ok: true, stopped: ids };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, stuck };
    await delay(Math.min(options?.pollMs ?? 250, remaining));
  }
}
