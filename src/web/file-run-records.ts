import { join, resolve } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import { parseRunProgress, type RunProgress } from "../kernel/run-progress.ts";
import type { Phase } from "../kernel/phase.ts";
import { object, runFiles, timestamp } from "./run-files.ts";

export const runName = /^\d{8}-\d{6}-[a-f0-9]{4}$/;
export type IssueRunRecord = {
  resultRecorded: boolean;
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: {
    status: "completed" | "stopped";
    label: "done" | "inProgress" | "needsInfo";
    summary: string | null;
  } | null;
  sessions: readonly { phase: Phase }[];
  progress: RunProgress | null;
};

function result(
  v: unknown,
  issue: number,
  runId: string,
): IssueRunRecord | undefined {
  if (
    !object(v) ||
    v.issue !== issue ||
    v.runId !== runId ||
    !timestamp(v.startedAt) ||
    !timestamp(v.finishedAt) ||
    Date.parse(v.finishedAt) < Date.parse(v.startedAt) ||
    !Array.isArray(v.sessions) ||
    !v.sessions.every(
      (s) =>
        object(s) && ["planning", "implementation"].includes(String(s.phase)),
    ) ||
    !object(v.outcome) ||
    v.outcome.issue !== issue
  )
    return;
  const o = v.outcome;
  if (
    o.status !== "completed" &&
    !(
      o.status === "stopped" &&
      ["done", "inProgress", "needsInfo"].includes(String(o.label))
    )
  )
    return;
  const progress = parseRunProgress(v.progress, issue);
  return {
    resultRecorded: true,
    runId,
    startedAt: v.startedAt,
    finishedAt: v.finishedAt,
    outcome: {
      status: o.status,
      label:
        o.status === "completed"
          ? "done"
          : (o.label as "done" | "inProgress" | "needsInfo"),
      summary: typeof o.summary === "string" ? o.summary : null,
    },
    sessions: v.sessions.map((s) => ({ phase: (s as { phase: Phase }).phase })),
    progress:
      progress?.runId === runId && progress.state === "ended" ? progress : null,
  };
}

export function runRecordMetadata(records: readonly IssueRunRecord[]) {
  const latest = records.at(-1);
  const phase =
    latest?.progress?.phase ?? latest?.sessions.at(-1)?.phase ?? null;
  const stage = latest?.progress?.facts?.stage ?? null;
  return {
    startedAt: records[0]?.startedAt ?? null,
    finishedAt: latest?.finishedAt ?? null,
    elapsedSeconds:
      records.length && records.every((r) => r.finishedAt !== null)
        ? records.reduce(
            (sum, r) =>
              sum +
              (Date.parse(r.finishedAt!) - Date.parse(r.startedAt)) / 1000,
            0,
          )
        : null,
    phase,
    stage,
    step:
      phase === "implementation"
        ? "Implementation"
        : stage === "spec"
          ? "Spec"
          : stage === "plan"
            ? "Plan"
            : phase === "planning"
              ? "Planning"
              : null,
    historicalPullRequests: records.flatMap((r) =>
      r.progress?.facts?.pullRequest ? [r.progress.facts.pullRequest] : [],
    ),
  };
}

/** Metadata only: board callers never inspect history or Pi conversations. */
export async function readIssueRunRecords(input: {
  repoRoot: string;
  config: PatchmillConfig;
  issue: number;
  warn: (message: string) => void;
}): Promise<readonly IssueRunRecord[]> {
  const root = resolve(input.repoRoot, input.config.paths.runsDir);
  const dir = join(root, `issue-${input.issue}`);
  const files = runFiles(root, input.warn);
  const records: IssueRunRecord[] = [];
  for (const entry of await files.list(dir)) {
    if (!entry.isDirectory() || !runName.test(entry.name)) continue;
    const raw = await files.json(join(dir, entry.name, "result.json"));
    if (raw === undefined) continue;
    const parsed = result(raw, input.issue, entry.name);
    if (parsed) records.push(parsed);
    else input.warn("Could not read optional issue run metadata.");
  }
  const raw = await files.json(join(dir, "progress.json"));
  const progress = parseRunProgress(raw, input.issue);
  if (raw !== undefined && !progress)
    input.warn("Could not read optional issue run metadata.");
  if (progress) {
    const recorded = records.find((r) => r.runId === progress.runId);
    if (recorded) recorded.progress ??= progress;
    else
      records.push({
        resultRecorded: false,
        runId: progress.runId,
        startedAt: progress.startedAt,
        finishedAt: progress.state === "ended" ? progress.updatedAt : null,
        outcome: progress.outcome
          ? { ...progress.outcome, summary: progress.summary }
          : null,
        sessions: [],
        progress,
      });
  }
  return records.sort(
    (a, b) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
      a.runId.localeCompare(b.runId),
  );
}
