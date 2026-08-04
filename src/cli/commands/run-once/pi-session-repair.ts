import { readFile } from "node:fs/promises";
import { finalJsonCandidates } from "./final-json.ts";
import { errorFromUnknown } from "./pi-errors.ts";

const UNRESOLVED_STATES = new Set([
  "queued",
  "running",
  "paused",
  "needs-attention",
  "unknown",
]);
const TERMINAL_STATES = new Set([
  "completed",
  "complete",
  "done",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
]);
const RUN_ID_PATTERN = /\b(?:pm-subagents|pi-subagents)-[A-Za-z0-9_-]+\b/gu;
const RUN_ID = /^\b(?:pm-subagents|pi-subagents)-[A-Za-z0-9_-]+\b$/u;

type JsonObject = Record<string, unknown>;

type MutableRun = {
  id: string;
  asyncLaunched: boolean;
  lastAction?: string;
  lastState?: string;
};

export type PiRepairSubagentRunFact = {
  id: string;
  lastAction?: string;
  lastState?: string;
  unresolved: boolean;
};

export type PiRepairFacts = {
  sessionPath: string;
  parseErrorMessage: string;
  lastAssistantTextExcerpt?: string;
  subagentRuns: PiRepairSubagentRunFact[];
  unresolvedSummary: string;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .flatMap((part) =>
      isObject(part) && part.type === "text" && typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("");
  return text || undefined;
}

function normalizedState(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const state = value.trim().toLowerCase();
  return state || undefined;
}

function runFacts(value: unknown): Array<{ id: string; state?: string }> {
  if (Array.isArray(value)) return value.flatMap(runFacts);
  if (!isObject(value)) return [];
  const id = value.id ?? value.runId;
  const state = normalizedState(value.state ?? value.status);
  return [
    ...(typeof id === "string" && RUN_ID.test(id)
      ? [{ id, ...(state ? { state } : {}) }]
      : []),
    ...Object.values(value).flatMap(runFacts),
  ];
}

function regexRunIds(text: string): string[] {
  return [...text.matchAll(RUN_ID_PATTERN)].map((match) => match[0]);
}

function stateFromText(text: string): string | undefined {
  const match = text.match(
    /\b(queued|running|paused|needs-attention|completed|complete|done|failed|cancelled|canceled|interrupted)\b/iu,
  );
  return normalizedState(match?.[1]);
}

function assistantToolCalls(content: unknown): Array<{
  id?: string;
  action?: string;
  asyncLaunched: boolean;
}> {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (
      !isObject(part) ||
      part.type !== "toolCall" ||
      part.name !== "subagent"
    ) {
      return [];
    }
    const args = isObject(part.arguments) ? part.arguments : {};
    const action = typeof args.action === "string" ? args.action : undefined;
    return [
      {
        ...(typeof part.id === "string" ? { id: part.id } : {}),
        ...(action ? { action } : {}),
        asyncLaunched: args.async === true,
      },
    ];
  });
}

function isTerminalAssistantJson(text: string): boolean {
  return finalJsonCandidates(text).some(
    (candidate) =>
      candidate.status === "merged" ||
      candidate.status === "pr-created" ||
      candidate.status === "blocked",
  );
}

function excerpt(text: string): string | undefined {
  const singleLine = text.replace(/\s+/gu, " ").trim();
  if (!singleLine) return undefined;
  return singleLine.length > 500
    ? `${singleLine.slice(0, 497)}...`
    : singleLine;
}

function unresolvedSummary(runs: PiRepairSubagentRunFact[]): string {
  const count = runs.filter((run) => run.unresolved).length;
  if (count === 0) return "no unresolved async subagent runs detected";
  return `${count} unresolved async subagent run${count === 1 ? "" : "s"}`;
}

export async function readPiRepairFacts(input: {
  sessionPath: string;
  parseError: unknown;
}): Promise<PiRepairFacts> {
  const runs = new Map<string, MutableRun>();
  const calls = new Map<string, { action?: string; asyncLaunched: boolean }>();
  let lastAssistantTextExcerpt: string | undefined;
  let source = "";
  try {
    source = await readFile(input.sessionPath, "utf8");
  } catch {
    // Diagnostics are best-effort; an unavailable session must not mask parsing.
  }

  const updateRun = (id: string, update: Partial<MutableRun>) => {
    const existing = runs.get(id) ?? { id, asyncLaunched: false };
    Object.assign(existing, update, {
      asyncLaunched: existing.asyncLaunched || update.asyncLaunched === true,
    });
    runs.set(id, existing);
  };

  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !isObject(entry) ||
      entry.type !== "message" ||
      !isObject(entry.message)
    )
      continue;
    const message = entry.message;
    if (message.role === "assistant") {
      const text = textContent(message.content);
      if (text && !isTerminalAssistantJson(text))
        lastAssistantTextExcerpt = excerpt(text);
      for (const call of assistantToolCalls(message.content)) {
        if (call.id) calls.set(call.id, call);
      }
      continue;
    }
    if (message.role !== "toolResult" || message.toolName !== "subagent")
      continue;

    const call =
      typeof message.toolCallId === "string"
        ? calls.get(message.toolCallId)
        : undefined;
    const text = textContent(message.content);
    if (!text) continue;
    const discovered = (() => {
      try {
        return runFacts(JSON.parse(text));
      } catch {
        const state = stateFromText(text);
        return regexRunIds(text).map((id) => ({
          id,
          ...(state ? { state } : {}),
        }));
      }
    })();
    for (const fact of discovered) {
      updateRun(fact.id, {
        ...(call?.action ? { lastAction: call.action } : {}),
        ...(call ? { asyncLaunched: call.asyncLaunched } : {}),
        ...(fact.state ? { lastState: fact.state } : {}),
      });
    }
  }

  const subagentRuns = [...runs.values()].map((run) => {
    const unresolved =
      run.lastState !== undefined
        ? UNRESOLVED_STATES.has(run.lastState)
        : run.asyncLaunched;
    return {
      id: run.id,
      ...(run.lastAction ? { lastAction: run.lastAction } : {}),
      ...(run.lastState ? { lastState: run.lastState } : {}),
      unresolved: TERMINAL_STATES.has(run.lastState ?? "") ? false : unresolved,
    };
  });

  return {
    sessionPath: input.sessionPath,
    parseErrorMessage: errorFromUnknown(input.parseError).message,
    ...(lastAssistantTextExcerpt ? { lastAssistantTextExcerpt } : {}),
    subagentRuns,
    unresolvedSummary: unresolvedSummary(subagentRuns),
  };
}
