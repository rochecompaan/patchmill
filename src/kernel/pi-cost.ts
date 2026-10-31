import fs from "node:fs/promises";
import { join } from "node:path";

export type PiUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
};
export type PiUsageRecord = {
  key?: string;
  model: string;
  usage: PiUsage;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

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
  };
}

function usageRecord(
  container: Record<string, unknown> | undefined,
  id: unknown,
): PiUsageRecord | undefined {
  const raw = object(container?.usage);
  if (!raw || !amount(raw.input) || !amount(raw.output)) return undefined;
  const cacheRead = raw.cacheRead ?? 0;
  const cacheWrite = raw.cacheWrite ?? 0;
  if (!amount(cacheRead) || !amount(cacheWrite)) return undefined;
  const inputTokens = raw.input + cacheRead + cacheWrite;
  if (!amount(inputTokens)) return undefined;
  const cost = object(raw.cost)?.total;
  const usage: PiUsage = {
    inputTokens,
    outputTokens: raw.output,
    ...(amount(cost) ? { costUsd: cost } : {}),
  };
  const model =
    typeof container?.model === "string" && container.model.trim()
      ? container.model
      : "Unknown model";
  return {
    model,
    usage,
    // Forked sessions can copy earlier assistant entries. No ID means no deduplication.
    ...(typeof id === "string" && id
      ? { key: JSON.stringify([id, model, usage]) }
      : {}),
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
          const record = object(JSON.parse(line));
          for (const container of [record, object(record?.message)]) {
            const parsed = usageRecord(container, record?.id);
            if (!parsed || (parsed.key && seen.has(parsed.key))) continue;
            if (parsed.key) seen.add(parsed.key);
            records.push(parsed);
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

export function costLine(usage: PiUsage | undefined): string {
  if (!usage) return "Cost: unavailable";
  const tokens = `Cost: ${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out tokens`;
  return usage.costUsd === undefined
    ? tokens
    : `${tokens}, $${usage.costUsd.toFixed(2)}`;
}
