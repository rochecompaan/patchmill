import fs from "node:fs/promises";
import { join } from "node:path";
import { readSessionUsage, totalUsage, type PiUsage } from "./pi-cost.ts";
import type { Phase } from "./phase.ts";

export type CostRun = {
  runId: string;
  sessions: readonly { phase: Phase }[];
};
export type IssueCostReport = {
  rows: { phase: Phase; model: string; usage: PiUsage }[];
  total: PiUsage;
};

async function recordedPhases(runDir: string): Promise<Phase[]> {
  let content: string;
  try {
    content = await fs.readFile(join(runDir, "result.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // An interrupted attempt with sessions cannot be silently left out of a total.
    try {
      await fs.access(join(runDir, "sessions"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    throw new Error(`Run metadata unavailable: ${runDir}`, { cause: error });
  }
  const record: unknown = JSON.parse(content);
  if (
    !record ||
    typeof record !== "object" ||
    !("sessions" in record) ||
    !Array.isArray(record.sessions) ||
    !record.sessions.every(
      (session: unknown) =>
        session !== null &&
        typeof session === "object" &&
        "phase" in session &&
        (session.phase === "planning" || session.phase === "implementation"),
    )
  )
    throw new Error(`Invalid run metadata: ${runDir}`);
  return record.sessions.map((session: { phase: Phase }) => session.phase);
}

/** Diagnostic records assign costs to phases; they never select the next phase. */
export async function readIssueCostReport(
  issueDir: string,
  current?: CostRun,
): Promise<IssueCostReport | undefined> {
  const runs: CostRun[] = [];
  const entries = await fs.readdir(issueDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === current?.runId) continue;
    runs.push({
      runId: entry.name,
      sessions: (await recordedPhases(join(issueDir, entry.name))).map(
        (phase) => ({ phase }),
      ),
    });
  }
  if (current) runs.push(current);
  const groups = new Map<
    string,
    { phase: Phase; model: string; usages: PiUsage[] }
  >();
  const seen = new Set<string>();
  for (const run of runs) {
    const sessionRoot = join(issueDir, run.runId, "sessions");
    const directories = await fs
      .readdir(sessionRoot, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" && run.sessions.length === 0) return [];
        throw error;
      });
    const expected = new Set(run.sessions.map((_, index) => String(index + 1)));
    if (
      directories.some(
        (entry) => entry.isDirectory() && !expected.has(entry.name),
      )
    )
      throw new Error(`Session phase metadata unavailable: ${sessionRoot}`);
    for (const [index, session] of run.sessions.entries()) {
      const dir = join(issueDir, run.runId, "sessions", String(index + 1));
      const records = await readSessionUsage(dir);
      if (!records) throw new Error(`Session usage unavailable: ${dir}`);
      for (const record of records) {
        if (record.key && seen.has(record.key)) continue;
        if (record.key) seen.add(record.key);
        const key = JSON.stringify([session.phase, record.model]);
        let group = groups.get(key);
        if (!group) {
          group = { phase: session.phase, model: record.model, usages: [] };
          groups.set(key, group);
        }
        group.usages.push(record.usage);
      }
    }
  }
  const rows = [...groups.values()]
    .map(({ phase, model, usages }) => {
      const usage = totalUsage(usages);
      if (!usage) throw new Error("Usage total is not finite");
      return { phase, model, usage };
    })
    .sort((a, b) => {
      const order = { planning: 0, implementation: 1 };
      return order[a.phase] - order[b.phase] || a.model.localeCompare(b.model);
    });
  const total = totalUsage(rows.map((row) => row.usage));
  if (rows.length === 0) return undefined;
  if (!total) throw new Error("Usage total is not finite");
  return { rows, total };
}
