import fs from "node:fs/promises";
import { join } from "node:path";
import { amount, parseUsageRecord } from "./pi-usage-records.ts";

export type PiUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Sum of recorded prices. Undefined when any part has no recorded cost. */
  costUsd?: number;
  /** Present and true when some part is Unpriced usage. */
  unpriced?: true;
};
export type PiUsageRecord = {
  key?: string;
  model: string;
  usage: PiUsage;
};

export function totalUsage(entries: PiUsage[]): PiUsage | undefined {
  if (entries.length === 0) return undefined;
  const inputTokens = entries.reduce(
    (sum, entry) => sum + entry.inputTokens,
    0,
  );
  const outputTokens = entries.reduce(
    (sum, entry) => sum + entry.outputTokens,
    0,
  );
  if (!amount(inputTokens) || !amount(outputTokens)) return undefined;
  const cost = entries.every((entry) => entry.costUsd !== undefined)
    ? entries.reduce((sum, entry) => sum + entry.costUsd!, 0)
    : undefined;
  return {
    inputTokens,
    outputTokens,
    ...(amount(cost) ? { costUsd: cost } : {}),
    ...(entries.some((entry) => entry.unpriced) ? { unpriced: true } : {}),
  };
}

export async function readSessionUsage(
  sessionDir: string,
): Promise<PiUsageRecord[] | undefined> {
  const records: PiUsageRecord[] = [];
  const seen = new Set<string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.name.endsWith(".jsonl")) {
        for (const line of (await fs.readFile(path, "utf8")).split("\n")) {
          if (!line.trim()) continue;
          const parsed = parseUsageRecord(JSON.parse(line));
          for (const record of [
            ...parsed.own,
            ...parsed.children.map((child) => child.record),
          ]) {
            if (record.key && seen.has(record.key)) continue;
            if (record.key) seen.add(record.key);
            records.push(record);
          }
        }
      }
    }
  }
  try {
    await walk(sessionDir);
    return records.length > 0 ? records : undefined;
  } catch {
    return undefined;
  }
}

export async function sumSessionUsage(
  sessionDir: string,
): Promise<PiUsage | undefined> {
  return totalUsage(
    (await readSessionUsage(sessionDir))?.map((r) => r.usage) ?? [],
  );
}

/**
 * The cost text of usage, or undefined when some cost was not recorded.
 * Unavailable wins over Unpriced; a sum that leaves out Unpriced usage is partial.
 */
export function costText(
  usage: PiUsage,
  fractionDigits: number,
): string | undefined {
  if (usage.costUsd === undefined) return undefined;
  if (usage.unpriced && usage.costUsd === 0) return "Unpriced";
  const dollars = `$${usage.costUsd.toFixed(fractionDigits)}`;
  return usage.unpriced ? `${dollars} (partial)` : dollars;
}

export function costLine(usage: PiUsage | undefined): string {
  if (!usage) return "Cost: unavailable";
  const tokens = `Cost: ${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out tokens`;
  const cost = costText(usage, 2);
  return cost === undefined ? tokens : `${tokens}, ${cost}`;
}
