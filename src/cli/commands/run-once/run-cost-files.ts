import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  aggregateRunCost,
  RunCostReportError,
  type RunCostReport,
  type RunCostSessionFile,
} from "./run-cost.ts";
export type RunCostFileInfo = { size: number; mtimeMs: number };
export type RunCostIo = {
  listJsonlFiles(root: string): Promise<string[]>;
  stat(path: string): Promise<RunCostFileInfo>;
  readFile(path: string): Promise<string>;
};
async function list(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        result.push(path);
    }
  }
  await visit(root);
  return result.sort((a, b) => a.localeCompare(b));
}
export const nodeRunCostIo: RunCostIo = {
  listJsonlFiles: list,
  stat: async (path) => {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },
  readFile: (path) => readFile(path, "utf8"),
};
function startedAt(content: string, path: string, fallback: number): number {
  for (const line of content.split(/\r?\n/u)) {
    try {
      const entry = JSON.parse(line) as { type?: unknown; timestamp?: unknown };
      if (entry.type === "session" && typeof entry.timestamp === "string") {
        const time = Date.parse(entry.timestamp);
        if (!Number.isNaN(time)) return time;
      }
    } catch {
      /* aggregation reports nonblank malformed JSON */
    }
  }
  const match = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\dZ)_/u.exec(basename(path));
  if (match) {
    const time = Date.parse(
      match[1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z/u, "T$1:$2:$3.$4Z"),
    );
    if (!Number.isNaN(time)) return time;
  }
  return fallback;
}
function same(
  left: Map<string, RunCostFileInfo>,
  right: Map<string, RunCostFileInfo>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(([path, info]) => {
      const other = right.get(path);
      return other?.size === info.size && other.mtimeMs === info.mtimeMs;
    })
  );
}
export async function summarizeRunCost(
  piSessionPath: string,
  io: RunCostIo = nodeRunCostIo,
): Promise<RunCostReport> {
  const paths = await io.listJsonlFiles(piSessionPath);
  const before = new Map(
    await Promise.all(
      paths.map(async (path) => [path, await io.stat(path)] as const),
    ),
  );
  const files: RunCostSessionFile[] = [];
  for (const path of paths) {
    const content = await io.readFile(path);
    files.push({
      relativePath: relative(piSessionPath, path),
      startedAtMs: startedAt(content, path, before.get(path)!.mtimeMs),
      content,
    });
  }
  const afterPaths = await io.listJsonlFiles(piSessionPath);
  const after = new Map(
    await Promise.all(
      afterPaths.map(async (path) => [path, await io.stat(path)] as const),
    ),
  );
  if (!same(before, after))
    throw new RunCostReportError(
      "Pi session files changed while calculating run cost",
    );
  return aggregateRunCost(files);
}
