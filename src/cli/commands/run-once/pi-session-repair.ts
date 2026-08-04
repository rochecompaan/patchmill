import { readFile } from "node:fs/promises";
import { finalJsonCandidates } from "./final-json.ts";
import { errorFromUnknown } from "./pi-errors.ts";

const SUBAGENT_STATES = [
  "queued",
  "pending",
  "running",
  "paused",
  "needs-attention",
  "unknown",
  "completed",
  "complete",
  "done",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "stopped",
  "rejected",
] as const;
type SubagentState = (typeof SUBAGENT_STATES)[number];
const SUBAGENT_STATE_PATTERN = new RegExp(
  `\\b(${SUBAGENT_STATES.join("|")})\\b`,
  "iu",
);
const UNRESOLVED_STATES = new Set<SubagentState>([
  "queued",
  "pending",
  "running",
  "paused",
  "needs-attention",
  "unknown",
]);
const TERMINAL_STATES = new Set<SubagentState>([
  "completed",
  "complete",
  "done",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "stopped",
  "rejected",
]);
const PREFIXED_RUN_ID_PATTERN =
  /\b(?:pm-subagents|pi-subagents)-[A-Za-z0-9_-]+\b/gu;
const BRACKETED_RUN_ID_PATTERN = /\[(?<id>[A-Za-z0-9][A-Za-z0-9_-]{5,})\]/gu;
const LABELED_RUN_ID_PATTERN =
  /\b(?:Run|Async id):\s*(?<id>[A-Za-z0-9][A-Za-z0-9_-]{5,})\b/gu;
const RUN_ID =
  /^(?:(?:pm-subagents|pi-subagents)-[A-Za-z0-9_-]+|[A-Za-z0-9][A-Za-z0-9_-]{5,})$/u;

type JsonObject = Record<string, unknown>;

type MutableRun = {
  id: string;
  asyncLaunched: boolean;
  lastAction?: string;
  lastState?: SubagentState;
};

export type PiRepairSubagentRunFact = {
  id: string;
  lastAction?: string;
  lastState?: SubagentState;
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

function normalizedState(value: unknown): SubagentState | undefined {
  if (typeof value !== "string") return undefined;
  const state = value.trim().toLowerCase();
  return SUBAGENT_STATES.includes(state as SubagentState)
    ? (state as SubagentState)
    : undefined;
}

function runFacts(
  value: unknown,
): Array<{ id: string; state?: SubagentState }> {
  if (Array.isArray(value)) return value.flatMap(runFacts);
  if (!isObject(value)) return [];
  const id = value.id ?? value.runId ?? value.asyncId;
  const state = normalizedState(value.state ?? value.status);
  return [
    ...(typeof id === "string" && RUN_ID.test(id)
      ? [{ id, ...(state ? { state } : {}) }]
      : []),
    ...Object.values(value).flatMap(runFacts),
  ];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function preferFirstState(
  facts: Array<{ id: string; state?: SubagentState }>,
): Array<{ id: string; state?: SubagentState }> {
  const merged = new Map<string, { id: string; state?: SubagentState }>();
  for (const fact of facts) {
    const existing = merged.get(fact.id);
    if (!existing) {
      merged.set(fact.id, fact);
      continue;
    }
    if (existing.state === undefined && fact.state !== undefined) {
      existing.state = fact.state;
    }
  }
  return [...merged.values()];
}

function regexRunIds(text: string): string[] {
  return unique([
    ...[...text.matchAll(PREFIXED_RUN_ID_PATTERN)].map((match) => match[0]),
    ...[...text.matchAll(BRACKETED_RUN_ID_PATTERN)].flatMap((match) =>
      match.groups?.id ? [match.groups.id] : [],
    ),
    ...[...text.matchAll(LABELED_RUN_ID_PATTERN)].flatMap((match) =>
      match.groups?.id ? [match.groups.id] : [],
    ),
  ]);
}

function stateFromText(text: string): SubagentState | undefined {
  const match = text.match(SUBAGENT_STATE_PATTERN);
  return normalizedState(match?.[1]);
}

function stringRunId(value: unknown): string | undefined {
  return typeof value === "string" && RUN_ID.test(value) ? value : undefined;
}

function hasAsyncLaunchId(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAsyncLaunchId);
  if (!isObject(value)) return false;
  return (
    stringRunId(value.asyncId) !== undefined ||
    Object.values(value).some(hasAsyncLaunchId)
  );
}

function isAsyncLaunchText(text: string): boolean {
  return /^Async(?:\s|:)/mu.test(text);
}

function assistantToolCalls(content: unknown): Array<{
  id?: string;
  action?: string;
  asyncLaunched: boolean;
  targetRunId?: string;
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
    const targetRunId = stringRunId(args.id ?? args.runId);
    return [
      {
        ...(typeof part.id === "string" ? { id: part.id } : {}),
        ...(action ? { action } : {}),
        asyncLaunched: args.async === true,
        ...(targetRunId ? { targetRunId } : {}),
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
  const calls = new Map<
    string,
    { action?: string; asyncLaunched: boolean; targetRunId?: string }
  >();
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
    const textState = stateFromText(text);
    const asyncResultLaunched =
      call?.asyncLaunched === true ||
      isAsyncLaunchText(text) ||
      hasAsyncLaunchId(message.details);
    const discovered = preferFirstState([
      ...(() => {
        try {
          return runFacts(JSON.parse(text));
        } catch {
          return regexRunIds(text).map((id) => ({
            id,
            ...(textState ? { state: textState } : {}),
          }));
        }
      })(),
      ...runFacts(message.details),
    ]);
    if (call?.targetRunId && discovered.length === 0) {
      discovered.push({
        id: call.targetRunId,
        ...(textState ? { state: textState } : {}),
      });
    }
    for (const fact of discovered) {
      updateRun(fact.id, {
        ...(call?.action ? { lastAction: call.action } : {}),
        asyncLaunched: asyncResultLaunched,
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
      unresolved: run.lastState
        ? !TERMINAL_STATES.has(run.lastState) && unresolved
        : unresolved,
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
