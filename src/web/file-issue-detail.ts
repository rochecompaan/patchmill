import { join, resolve } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import type { IssueDetail, IssueSummary, ThreadEvent } from "./api-types.ts";
import type { RunObservation } from "./file-run-observations.ts";
import {
  readIssueRunRecords,
  runRecordMetadata,
  runName,
  type IssueRunRecord,
} from "./file-run-records.ts";
import { runFiles } from "./run-files.ts";
import { readAttemptThread, readHistory } from "./issue-history.ts";
import { issueFinalUsage } from "./issue-final-usage.ts";

/** One requested issue's evidence, never workflow authority or a filesystem endpoint. */
export async function readIssueDetail(input: {
  repoRoot: string;
  config: PatchmillConfig;
  issue: Issue;
  summary: IssueSummary;
  observation: RunObservation;
  warn: (message: string) => void;
}): Promise<IssueDetail> {
  const root = resolve(input.repoRoot, input.config.paths.runsDir);
  const dir = join(root, `issue-${input.issue.number}`);
  const files = runFiles(root, input.warn);
  const records = [
    ...(input.observation.records ??
      (await readIssueRunRecords({ ...input, issue: input.issue.number }))),
  ];
  // A failed latest projection can leave history as the only retained evidence.
  // Only selected-detail reads inspect that history, never a board request.
  for (const entry of await files.list(dir)) {
    if (
      !entry.isDirectory() ||
      !runName.test(entry.name) ||
      records.some((r) => r.runId === entry.name)
    )
      continue;
    const history = await readHistory(
      files,
      join(dir, entry.name),
      input.issue.number,
      entry.name,
    );
    const p = history.projection;
    if (p)
      records.push({
        resultRecorded: false,
        runId: p.runId,
        startedAt: p.startedAt,
        finishedAt: p.state === "ended" ? p.updatedAt : null,
        sessions: [],
        progress: p,
        outcome: p.outcome ? { ...p.outcome, summary: p.summary } : null,
      });
  }
  records.sort(
    (a, b) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
      a.runId.localeCompare(b.runId),
  );
  const latest: IssueRunRecord | undefined = records.at(-1);
  const metadata = runRecordMetadata(records);
  const active = records.find((r) => r.runId === input.observation.activeRunId);
  const ended = records.filter((r) => r !== active);
  const summary = {
    ...input.summary,
    step: input.observation.live ? input.summary.step : metadata.step,
    elapsedSeconds: input.observation.live
      ? ended.length
        ? runRecordMetadata(ended).elapsedSeconds
        : 0
      : metadata.elapsedSeconds,
  };
  const base: IssueDetail = {
    summary,
    body: null,
    run: null,
    participants: [],
    thread: [],
    artifacts: [],
    finalUsage: null,
  };
  if (!latest && !input.observation.live)
    return { ...base, body: input.issue.body };
  const run: NonNullable<IssueDetail["run"]> = {
    startedAt: records[0]?.startedAt ?? "",
    activeSince: active?.startedAt ?? null,
    finishedAt: input.observation.live ? null : (latest?.finishedAt ?? null),
    outcome: input.observation.live
      ? "active"
      : (latest?.outcome?.status ?? "incomplete"),
  };
  const thread: ThreadEvent[] = [];
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    thread.push({
      id: `${record.runId}:attempt`,
      at: record.startedAt,
      kind: "divider",
      tone: "neutral",
      text: `Run attempt ${index + 1}`,
    });
    thread.push(
      ...(await readAttemptThread({
        files,
        dir: join(dir, record.runId),
        issue: input.issue.number,
        record,
        seen,
        active: record === active,
      })),
    );
  }
  return {
    ...base,
    run,
    thread,
    finalUsage: input.observation.live
      ? null
      : await issueFinalUsage(files, dir, records),
  };
}
