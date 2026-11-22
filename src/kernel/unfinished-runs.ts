import fs from "node:fs/promises";
import { join } from "node:path";
import type { ParsedResult } from "./result.ts";

export type UnfinishedRun = { runId: string; agent?: string };

type Entry = Record<string, unknown>;

const isObject = (value: unknown): value is Entry =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseEntries(sessionText: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of sessionText.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isObject(value)) entries.push(value);
    } catch {
      // A partial or broken line says nothing about runs.
    }
  }
  return entries;
}

function entryTime(entry: Entry): number {
  return typeof entry.timestamp === "string"
    ? Date.parse(entry.timestamp)
    : Number.NaN;
}

/** Entries that the session wrote itself. A forked session copies earlier
 * entries with their old timestamps, so they come before the header. */
function ownEntries(entries: Entry[]): Entry[] {
  const header = entries.find((entry) => entry.type === "session");
  const start = header ? entryTime(header) : Number.NaN;
  if (Number.isNaN(start)) return entries;
  return entries.filter((entry) => {
    if (entry === header) return false;
    const time = entryTime(entry);
    return !Number.isNaN(time) && time >= start;
  });
}

function resultText(message: Entry): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isObject)
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

function runIds(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter(isObject)
    .map((item) => item.runId)
    .filter((id): id is string => typeof id === "string");
}

/** Background runs that a session started or resumed and never saw finish. */
export function unfinishedRuns(sessionText: string): UnfinishedRun[] {
  const calls = new Map<string, Entry>();
  const agents = new Map<string, string>();
  const running = new Map<string, UnfinishedRun>();

  for (const entry of ownEntries(parseEntries(sessionText))) {
    if (entry.type === "custom_message") {
      if (entry.customType === "subagent-notify" && isObject(entry.details))
        for (const id of runIds(entry.details.runs)) running.delete(id);
      continue;
    }
    if (entry.type !== "message" || !isObject(entry.message)) continue;
    const message = entry.message;

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (
          isObject(block) &&
          block.type === "toolCall" &&
          typeof block.id === "string" &&
          isObject(block.arguments)
        )
          calls.set(block.id, block.arguments);
      }
      continue;
    }
    if (message.role !== "toolResult" || message.isError === true) continue;
    const details = isObject(message.details) ? message.details : {};

    if (message.toolName === "bg_wait") {
      for (const id of runIds(details.completions)) running.delete(id);
      continue;
    }
    if (message.toolName !== "subagent") continue;
    const args =
      typeof message.toolCallId === "string"
        ? calls.get(message.toolCallId)
        : undefined;
    if (args?.action === "stop" && typeof args.id === "string") {
      running.delete(args.id);
      continue;
    }
    const runId = details.asyncId;
    if (typeof runId !== "string" || !runId) continue;

    const agent =
      (typeof args?.agent === "string" ? args.agent : undefined) ??
      (args?.action === "resume" && typeof args.id === "string"
        ? agents.get(args.id)
        : undefined) ??
      /^Agent: (\S+)$/m.exec(resultText(message))?.[1];
    if (agent) agents.set(runId, agent);
    running.delete(runId);
    running.set(runId, agent ? { runId, agent } : { runId });
  }

  return [...running.values()];
}

function describe(runs: UnfinishedRun[]): string {
  const [only] = runs;
  if (runs.length === 1 && only)
    return `its ${only.agent ?? "subagent"} run ${only.runId} was still running`;
  const name = (run: UnfinishedRun) =>
    run.agent ? `${run.agent} ${run.runId}` : run.runId;
  return `its subagent runs ${runs.map(name).join(", ")} were still running`;
}

/** Adds the cause to a missing result block when the session files show
 * unfinished runs. Returns every other result unchanged. */
export async function explainMissingResult(
  result: ParsedResult,
  sessionDir: string,
): Promise<ParsedResult> {
  if (result.ok || !result.missing) return result;

  let files: string[];
  try {
    files = (await fs.readdir(sessionDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return result;
  }

  const runs = new Map<string, UnfinishedRun>();
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(join(sessionDir, file), "utf8");
    } catch {
      continue;
    }
    for (const run of unfinishedRuns(text))
      if (!runs.has(run.runId)) runs.set(run.runId, run);
  }
  if (runs.size === 0) return result;

  return {
    ok: false,
    reason: `${result.reason} It ended its turn while ${describe([...runs.values()])}.`,
    missing: true,
  };
}
