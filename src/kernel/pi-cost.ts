import fs from "node:fs/promises";
import { join } from "node:path";
import {
  amount,
  parseUsageRecord,
  type ParsedRecord,
} from "./pi-usage-records.ts";

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

export type SessionFileUsage = {
  path: string;
  /** Path relative to the session directory, with `/` separators. */
  relative: string;
  records: ParsedRecord[];
};

/**
 * Reads every JSONL file below a directory. A file or folder that cannot be
 * read or parsed goes to `unreadable` and does not hide the others.
 */
export async function readSessionFiles(
  dir: string,
): Promise<{ files: SessionFileUsage[]; unreadable: string[] }> {
  const files: SessionFileUsage[] = [];
  const unreadable: string[] = [];
  async function walk(dir: string, relative: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      unreadable.push(dir);
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path, name);
      } else if (entry.name.endsWith(".jsonl")) {
        try {
          const records: ParsedRecord[] = [];
          for (const line of (await fs.readFile(path, "utf8")).split("\n"))
            if (line.trim()) records.push(parseUsageRecord(JSON.parse(line)));
          files.push({ path, relative: name, records });
        } catch {
          unreadable.push(path);
        }
      }
    }
  }
  await walk(dir, "");
  return { files, unreadable };
}

/**
 * Recorded child paths are absolute. A suffix match keeps moved or archived
 * run directories working.
 */
export function matchesFile(
  file: Pick<SessionFileUsage, "path" | "relative">,
  recorded: Iterable<string>,
): boolean {
  for (const path of recorded)
    if (path === file.path || path.endsWith(`/${file.relative}`)) return true;
  return false;
}

/**
 * Reads the usage records below a session directory and counts each subagent
 * child once. `seen` holds the keys already counted by the caller, for example
 * in an earlier session of the same run. This function adds the key of each
 * record it counts or skips.
 *
 * Returns `[]` when usage records exist but all are already counted, and
 * `undefined` on a read or parse failure or when no usage record exists.
 */
export async function readSessionUsage(
  sessionDir: string,
  seen: Set<string> = new Set(),
): Promise<PiUsageRecord[] | undefined> {
  const { files, unreadable } = await readSessionFiles(sessionDir);
  if (unreadable.length) return undefined;
  const transcripts = new Set<string>();
  for (const file of files)
    for (const record of file.records)
      for (const child of record.childFiles)
        if (child.transcriptPath) transcripts.add(child.transcriptPath);
  // A child record whose session file is walked counts through that file.
  const covered = (sessionFile: string | undefined) =>
    sessionFile !== undefined &&
    files.some((file) => matchesFile(file, [sessionFile]));
  const records: PiUsageRecord[] = [];
  let found = false;
  for (const file of files) {
    // A transcript copies its child session.
    const skipFile = matchesFile(file, transcripts);
    for (const parsed of file.records) {
      const candidates = [
        ...parsed.own.map((record) => ({ record, skip: skipFile })),
        ...parsed.children.map(({ record, files }) => ({
          record,
          skip: skipFile || covered(files.sessionFile),
        })),
      ];
      for (const { record, skip } of candidates) {
        found = true;
        if (record.key && seen.has(record.key)) continue;
        if (record.key) seen.add(record.key);
        if (!skip) records.push(record);
      }
    }
  }
  return found ? records : undefined;
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
