import type { PiUsage, PiUsageRecord } from "./pi-cost.ts";

/** Files that a parent tool result names for one subagent child. */
export type ChildFiles = { sessionFile?: string; transcriptPath?: string };
export type ParsedRecord = {
  /** Own container usage, or the aggregate fallback of a tool result. */
  own: PiUsageRecord[];
  /** One entry per Child usage record with valid usage, in index order. */
  children: { record: PiUsageRecord; files: ChildFiles }[];
  /** Files of every child entry, also of entries without valid usage. */
  childFiles: ChildFiles[];
};

const UNKNOWN_MODEL = "Unknown model";
const SUBAGENT_TOOLS = new Set(["subagent", "bg_wait"]);
const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Token and cost rules shared by session records and Child usage records. */
function parseUsage(raw: unknown): PiUsage | undefined {
  const usage = object(raw);
  if (!usage || !amount(usage.input) || !amount(usage.output)) return undefined;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  if (!amount(cacheRead) || !amount(cacheWrite)) return undefined;
  const inputTokens = usage.input + cacheRead + cacheWrite;
  if (!amount(inputTokens)) return undefined;
  // Session records keep cost in `cost.total`; pi-subagents children use a number.
  const cost =
    typeof usage.cost === "number" ? usage.cost : object(usage.cost)?.total;
  return {
    inputTokens,
    outputTokens: usage.output,
    ...(amount(cost) ? { costUsd: cost } : {}),
    ...(cost === 0 && inputTokens + usage.output > 0
      ? { unpriced: true as const }
      : {}),
  };
}

function recordedModel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** pi-subagents records `provider/id[:thinking]`; parent rows use the bare id. */
function childModel(raw: unknown): string {
  const model = recordedModel(raw);
  if (!model) return UNKNOWN_MODEL;
  const slash = model.indexOf("/");
  let id = slash === -1 ? model : model.slice(slash + 1);
  const colon = id.lastIndexOf(":");
  if (colon !== -1 && THINKING_LEVELS.has(id.slice(colon + 1)))
    id = id.slice(0, colon);
  return id.trim() ? id : UNKNOWN_MODEL;
}

function keyed(
  id: unknown,
  model: string,
  usage: PiUsage,
  parts: unknown[] = [],
): PiUsageRecord {
  return {
    model,
    usage,
    // Forked sessions can copy earlier entries. No ID means no deduplication.
    ...(typeof id === "string" && id
      ? { key: JSON.stringify([id, ...parts, model, usage]) }
      : {}),
  };
}

function childEntries(message: Record<string, unknown>): unknown[] {
  const details = object(message.details);
  const entries: unknown[] = [];
  if (Array.isArray(details?.results)) entries.push(...details.results);
  if (Array.isArray(details?.completions))
    for (const completion of details.completions) {
      const results = object(completion)?.results;
      if (Array.isArray(results)) entries.push(...results);
    }
  return entries;
}

function filesOf(child: Record<string, unknown> | undefined): ChildFiles {
  const sessionFile = recordedModel(child?.sessionFile);
  const transcriptPath =
    recordedModel(child?.transcriptPath) ??
    recordedModel(object(child?.artifactPaths)?.transcriptPath);
  return {
    ...(sessionFile ? { sessionFile } : {}),
    ...(transcriptPath ? { transcriptPath } : {}),
  };
}

/** Turns one JSON session record into the usage records it holds. */
export function parseUsageRecord(record: unknown): ParsedRecord {
  const result: ParsedRecord = { own: [], children: [], childFiles: [] };
  const top = object(record);
  if (!top) return result;
  const message = object(top.message);
  // A transcript record repeats its usage at the top level and in `message`.
  const container = message && "usage" in message ? message : top;
  const own = parseUsage(container.usage);
  // The tool name alone marks a tool result; its aggregate can be absent.
  if (message && SUBAGENT_TOOLS.has(message.toolName as string)) {
    const aggregate = parseUsage(message.usage);
    for (const [index, entry] of childEntries(message).entries()) {
      const child = object(entry);
      const files = filesOf(child);
      result.childFiles.push(files);
      const usage = parseUsage(child?.usage);
      if (!usage) continue;
      result.children.push({
        record: keyed(top.id, childModel(child?.model), usage, [
          "child",
          index,
        ]),
        files,
      });
    }
    // The aggregate counts only when pi-subagents recorded no child usage.
    if (result.children.length === 0 && aggregate)
      result.own.push(keyed(top.id, UNKNOWN_MODEL, aggregate));
    return result;
  }
  if (own)
    result.own.push(
      keyed(top.id, recordedModel(container.model) ?? UNKNOWN_MODEL, own),
    );
  return result;
}
