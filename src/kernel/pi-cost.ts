import fs from "node:fs/promises";
import { join } from "node:path";

export type PiUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function sumSessionUsage(
  sessionDir: string,
): Promise<PiUsage | undefined> {
  const total: PiUsage = { inputTokens: 0, outputTokens: 0 };
  let cost = 0;
  let completeCost = true;
  let found = false;
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
            const usage = object(container?.usage);
            if (!usage || !amount(usage.input) || !amount(usage.output))
              continue;
            found = true;
            total.inputTokens += usage.input;
            total.outputTokens += usage.output;
            const value = object(usage.cost)?.total;
            if (amount(value)) cost += value;
            else completeCost = false;
          }
        }
      }
    }
  }
  try {
    await walk(sessionDir);
    if (!found || !amount(total.inputTokens) || !amount(total.outputTokens))
      return undefined;
    if (completeCost && amount(cost)) total.costUsd = cost;
    return total;
  } catch {
    return undefined;
  }
}

export function costLine(usage: PiUsage | undefined): string {
  if (!usage) return "Cost: unavailable";
  const tokens = `Cost: ${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out tokens`;
  return usage.costUsd === undefined
    ? tokens
    : `${tokens}, $${usage.costUsd.toFixed(2)}`;
}
