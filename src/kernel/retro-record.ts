import { promises as fs } from "node:fs";
import { join } from "node:path";
import { newRunId } from "./names.ts";

/** An Issue run end: a merged implementation pull request or a Needs Info stop. */
export type RetroEnd =
  | { kind: "merged"; pullRequest: number }
  | { kind: "needs-info"; runId: string };
export type RetroClaimMode = "findings-only" | "file-issues";
export type RetroStatus = "started" | "done" | "failed" | "skipped";

export type RetroScope = {
  retroId: string;
  /** `<issueDir>/retros/<retroId>` */
  dir: string;
  /** `<dir>/findings.md` */
  findings: string;
  end: RetroEnd;
  mode: RetroClaimMode;
  /** Run attempt folders that no earlier Retro covers, oldest first. */
  runIds: string[];
  /** startedAt of the oldest covered Run attempt. */
  since: string;
};

type RetroRecord = {
  version: 1;
  end: string;
  runIds: string[];
  since: string;
  mode: RetroClaimMode;
  status: RetroStatus;
  summary: string;
  startedAt: string;
  finishedAt?: string;
};

export const RETROS_DIR = "retros";
const RECORD = "retro.json";

export function retroEndKey(end: RetroEnd): string {
  return end.kind === "merged"
    ? `merged-${end.pullRequest}`
    : `needs-info-${end.runId}`;
}

async function readRecords(retrosDir: string): Promise<Partial<RetroRecord>[]> {
  let names: string[];
  try {
    names = await fs.readdir(retrosDir);
  } catch {
    return [];
  }
  const records: Partial<RetroRecord>[] = [];
  for (const name of names) {
    try {
      const value: unknown = JSON.parse(
        await fs.readFile(join(retrosDir, name, RECORD), "utf8"),
      );
      if (value && typeof value === "object")
        records.push(value as Partial<RetroRecord>);
    } catch {
      // An unreadable record covers nothing and has no end key.
    }
  }
  return records;
}

async function runAttempts(
  issueDir: string,
): Promise<{ runId: string; startedAt: string }[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(issueDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs: { runId: string; startedAt: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === RETROS_DIR) continue;
    const resultPath = join(issueDir, entry.name, "result.json");
    let text: string;
    try {
      text = await fs.readFile(resultPath, "utf8");
    } catch {
      continue;
    }
    let startedAt: string | undefined;
    try {
      const value = JSON.parse(text) as { startedAt?: unknown };
      if (typeof value.startedAt === "string") startedAt = value.startedAt;
    } catch {
      // Fall back to the time of the result file.
    }
    startedAt ??= (await fs.stat(resultPath)).mtime.toISOString();
    runs.push({ runId: entry.name, startedAt });
  }
  return runs.sort(
    (a, b) =>
      a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId),
  );
}

/**
 * Claims the Retro of one Issue run end. Undefined when the end already had a
 * Retro or when no Run attempt is uncovered. The caller holds the issue lock.
 */
export async function claimRetro(input: {
  issueDir: string;
  end: RetroEnd;
  mode: RetroClaimMode;
  now: () => Date;
}): Promise<RetroScope | undefined> {
  const retrosDir = join(input.issueDir, RETROS_DIR);
  const key = retroEndKey(input.end);
  const records = await readRecords(retrosDir);
  if (records.some((record) => record.end === key)) return undefined;
  const covered = new Set(
    records.flatMap((record) =>
      Array.isArray(record.runIds)
        ? record.runIds.filter((id) => typeof id === "string")
        : [],
    ),
  );
  const runs = (await runAttempts(input.issueDir)).filter(
    (run) => !covered.has(run.runId),
  );
  if (!runs.length) return undefined;
  const now = input.now();
  const retroId = newRunId(now);
  const dir = join(retrosDir, retroId);
  await fs.mkdir(retrosDir, { recursive: true });
  await fs.mkdir(dir);
  const scope: RetroScope = {
    retroId,
    dir,
    findings: join(dir, "findings.md"),
    end: input.end,
    mode: input.mode,
    runIds: runs.map((run) => run.runId),
    since: runs[0]!.startedAt,
  };
  const record: RetroRecord = {
    version: 1,
    end: key,
    runIds: scope.runIds,
    since: scope.since,
    mode: scope.mode,
    status: "started",
    summary: "",
    startedAt: now.toISOString(),
  };
  await fs.writeFile(
    join(dir, RECORD),
    `${JSON.stringify(record, null, 2)}\n`,
    { flag: "wx" },
  );
  return scope;
}

/** Records the final status of a claimed Retro. */
export async function finishRetro(
  scope: RetroScope,
  status: Exclude<RetroStatus, "started">,
  summary: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const path = join(scope.dir, RECORD);
  const record = JSON.parse(await fs.readFile(path, "utf8")) as RetroRecord;
  await fs.writeFile(
    path,
    `${JSON.stringify(
      { ...record, status, summary, finishedAt: now().toISOString() },
      null,
      2,
    )}\n`,
  );
}
