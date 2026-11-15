import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { parseRunProgress, type RunProgress } from "../kernel/run-progress.ts";
import type { ThreadEvent } from "./api-types.ts";
import type { IssueRunRecord } from "./file-run-records.ts";
import { object, timestamp, type RunFiles } from "./run-files.ts";
import { projectPiThread } from "./pi-thread.ts";

type Session = {
  number: number;
  phase: "planning" | "implementation";
  at: string | null;
};
export async function readHistory(
  files: RunFiles,
  dir: string,
  issue: number,
  runId: string,
  active = false,
) {
  const sessions = new Map<number, Session>();
  const progress: { session: number; event: ThreadEvent }[] = [];
  let projection: RunProgress | null = null;
  let sequence = 0;
  let current = 0;
  let found = false;
  for await (const r of files.lines(join(dir, "history.jsonl"), {
    complete: active,
  })) {
    if (
      !object(r) ||
      r.schemaVersion !== 1 ||
      r.issue !== issue ||
      r.runId !== runId ||
      !timestamp(r.at) ||
      !Number.isSafeInteger(r.sequence) ||
      Number(r.sequence) <= sequence
    )
      continue;
    sequence = Number(r.sequence);
    if (r.kind === "snapshot") {
      const p = parseRunProgress(r.progress, issue);
      if (p?.runId === runId) {
        projection = p;
        found = true;
      }
    } else if (
      r.kind === "session" &&
      Number.isSafeInteger(r.number) &&
      Number(r.number) > 0 &&
      ["planning", "implementation"].includes(String(r.phase))
    ) {
      current = Number(r.number);
      sessions.set(current, {
        number: current,
        phase: r.phase as Session["phase"],
        at: r.at,
      });
      found = true;
    } else if (
      r.kind === "progress" &&
      ["stdout", "stderr"].includes(String(r.stream)) &&
      typeof r.text === "string"
    ) {
      progress.push({
        session: current,
        event: {
          kind: "progress",
          id: `${runId}:history:${sequence}`,
          at: r.at,
          text: stripVTControlCharacters(r.text),
        },
      });
      found = true;
    }
  }
  return { found, sessions, progress, projection };
}

export async function readAttemptThread(input: {
  files: RunFiles;
  dir: string;
  issue: number;
  record: IssueRunRecord;
  seen: Set<string>;
  active?: boolean;
}): Promise<ThreadEvent[]> {
  const { files, dir, record } = input;
  const history = await readHistory(
    files,
    dir,
    input.issue,
    record.runId,
    input.active,
  );
  const events: ThreadEvent[] = [];
  const notice = (text: string, suffix: string): ThreadEvent => ({
    kind: "progress",
    id: `${record.runId}:${suffix}`,
    at: null,
    text,
  });
  if (!history.found)
    events.push(
      notice(
        "Terminal progress was not recorded for this attempt.",
        "missing-progress",
      ),
    );
  events.push(
    ...history.progress.filter((p) => p.session === 0).map((p) => p.event),
  );
  const sessions = new Map<number, Session>(
    record.sessions.map((s, i) => [
      i + 1,
      { number: i + 1, phase: s.phase, at: null },
    ]),
  );
  for (const [number, session] of history.sessions)
    sessions.set(number, session);
  const dirs = (await files.list(join(dir, "sessions"))).filter(
    (e) =>
      e.isDirectory() &&
      /^[1-9]\d*$/.test(e.name) &&
      Number.isSafeInteger(Number(e.name)),
  );
  const numbers = [
    ...new Set([...sessions.keys(), ...dirs.map((d) => Number(d.name))]),
  ].sort((a, b) => a - b);
  let hasTranscript = false;
  for (const number of numbers) {
    const session = sessions.get(number);
    if (session)
      events.push({
        kind: "step",
        id: `${record.runId}:step:${number}`,
        at: session.at,
        number,
        label: session.phase,
      });
    const projected: ThreadEvent[] = [];
    const sessionDir = join(dir, "sessions", String(number));
    for (const entry of await files.list(sessionDir)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const records: unknown[] = [];
      for await (const r of files.lines(join(sessionDir, entry.name), {
        complete: !!input.active,
      }))
        records.push(r);
      const normalized = projectPiThread({
        records,
        prefix: `${record.runId}:${number}:${entry.name}`,
        ...(session?.at ? { cutoff: session.at } : {}),
        collapseFirstUser: entry.name !== "console-planning.jsonl",
        seen: input.seen,
        active: !!input.active,
      });
      if (normalized.length) hasTranscript = true;
      projected.push(...normalized);
    }
    projected.push(
      ...history.progress
        .filter(
          (p) =>
            p.session === number &&
            !(
              session &&
              p.event.kind === "progress" &&
              p.event.text ===
                `${String(number).padStart(2, "0")} ${session.phase}`
            ),
        )
        .map((p) => p.event),
    );
    events.push(
      ...projected
        .map((e, index) => ({ e, index }))
        .sort(
          (a, b) =>
            (a.e.at ? Date.parse(a.e.at) : -Infinity) -
              (b.e.at ? Date.parse(b.e.at) : -Infinity) || a.index - b.index,
        )
        .map(({ e }) => e),
    );
  }
  if (!hasTranscript && !input.active)
    events.push(
      notice(
        "Agent transcript not recorded for this attempt.",
        "missing-transcript",
      ),
    );
  if (
    input.active &&
    record.progress?.interactive &&
    !events.some(
      (e) =>
        ["message", "tool", "prompt"].includes(e.kind) &&
        e.id.startsWith(`${record.runId}:${numbers.at(-1)}:`),
    )
  )
    events.push(
      notice(
        "Agent messages appear when this interactive session ends.",
        "interactive-pending",
      ),
    );
  if (
    !input.active &&
    (record.outcome?.label === "needsInfo" || !record.finishedAt)
  )
    events.push({
      kind: "error",
      id: `${record.runId}:error`,
      at: record.finishedAt,
      title: "Run needs attention",
      text:
        record.outcome?.summary ??
        record.progress?.summary ??
        "Run ended before recording a result.",
    });
  return events;
}
