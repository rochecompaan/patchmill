import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

export type PiTokenUsage = {
  task: number;
  text: string;
  total: number;
};

export type PiSessionObservation =
  | { type: "assistant-usage"; outputTokens: number }
  | {
      type: "tool-call";
      toolName?: string;
      toolCallId?: string;
      arguments?: JsonObject;
    }
  | { type: "text"; text: string };

type SessionStreamerOptions = {
  pollMs?: number;
  onTokenUsage?: (usage: PiTokenUsage) => void;
  totalTokensSoFar?: number;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionLine(line: string): JsonObject | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function textContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .map((part) => {
      if (!isObject(part)) return "";
      return part.type === "text" && typeof part.text === "string"
        ? part.text
        : "";
    })
    .join("");
  return text.length > 0 ? text : undefined;
}

function toolCallObservations(content: unknown): PiSessionObservation[] {
  if (!Array.isArray(content)) return [];

  return content.flatMap((part) => {
    if (!isObject(part) || part.type !== "toolCall") return [];
    const toolName = typeof part.name === "string" ? part.name : undefined;
    const toolCallId = typeof part.id === "string" ? part.id : undefined;
    const args = isObject(part.arguments) ? part.arguments : undefined;
    return [
      {
        type: "tool-call" as const,
        ...(toolName ? { toolName } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(args ? { arguments: args } : {}),
      },
    ];
  });
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function numberField(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function outputTokens(usage: JsonObject): number | undefined {
  return numberField(usage, "output");
}

function formatThousands(tokens: number): string {
  return `${Math.max(1, Math.round(tokens / 1000))}k`;
}

function usageTotalTokens(usage: JsonObject): number | undefined {
  const direct = numberField(usage, "totalTokens");
  if (direct !== undefined) return direct;

  const fields = ["input", "output", "cacheRead", "cacheWrite"];
  let total = 0;
  let found = false;
  for (const field of fields) {
    const value = numberField(usage, field);
    if (value === undefined) continue;
    total += value;
    found = true;
  }
  return found ? total : undefined;
}

function tokenUsageText(
  message: JsonObject,
  options: SessionStreamerOptions,
): string | undefined {
  const usage = message.usage;
  if (!isObject(usage)) return undefined;

  const task = numberField(usage, "input");
  if (task === undefined) return undefined;

  const total =
    (options.totalTokensSoFar ?? 0) + (usageTotalTokens(usage) ?? task);
  const text = `tok: task=${formatThousands(task)} total=${formatThousands(total)}`;
  options.onTokenUsage?.({ task, text, total });
  return `${text}\n`;
}

export function sessionEntryToObservations(
  entry: JsonObject,
): PiSessionObservation[] {
  if (entry.type === "custom_message" && entry.display === true) {
    const text = textContent(entry.content);
    return text === undefined ? [] : [{ type: "text", text }];
  }

  if (entry.type !== "message" || !isObject(entry.message)) return [];

  const message = entry.message;
  const observations: PiSessionObservation[] = [];

  if (message.role === "assistant") {
    if (isObject(message.usage)) {
      const output = outputTokens(message.usage);
      if (output !== undefined) {
        observations.push({ type: "assistant-usage", outputTokens: output });
      }
    }
    const text = textContent(message.content);
    if (text !== undefined) observations.push({ type: "text", text });
    observations.push(...toolCallObservations(message.content));
    return observations;
  }

  if (message.role === "toolResult") {
    const toolName =
      typeof message.toolName === "string" ? message.toolName : undefined;
    const toolCallId =
      typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    observations.push({
      type: "tool-call",
      ...(toolName ? { toolName } : {}),
      ...(toolCallId ? { toolCallId } : {}),
    });
    return observations;
  }

  if (message.role === "bashExecution") {
    observations.push({ type: "tool-call", toolName: "bash" });
    if (typeof message.output === "string")
      observations.push({ type: "text", text: message.output });
    return observations;
  }

  return [];
}

export function sessionEntryToStreamText(
  entry: JsonObject,
  options: SessionStreamerOptions = {},
): string | undefined {
  if (entry.type === "custom_message" && entry.display === true) {
    const text = textContent(entry.content);
    return text === undefined ? undefined : withTrailingNewline(text);
  }

  if (entry.type !== "message" || !isObject(entry.message)) {
    return undefined;
  }

  const message = entry.message;
  if (message.role === "assistant") {
    const text = textContent(message.content);
    const tokenUsage = tokenUsageText(message, options);
    const chunks = [
      text === undefined ? undefined : withTrailingNewline(text),
      tokenUsage,
    ].filter((chunk): chunk is string => chunk !== undefined);
    return chunks.length > 0 ? chunks.join("") : undefined;
  }

  if (message.role === "toolResult") {
    const text = textContent(message.content);
    return text === undefined ? undefined : withTrailingNewline(text);
  }

  if (message.role === "bashExecution" && typeof message.output === "string") {
    return withTrailingNewline(message.output);
  }

  return undefined;
}

function sessionEntryToRawText(entry: JsonObject): string | undefined {
  if (entry.type === "custom_message" && entry.display === true) {
    const text = textContent(entry.content);
    return text === undefined ? undefined : withTrailingNewline(text);
  }

  if (entry.type !== "message" || !isObject(entry.message)) return undefined;

  const message = entry.message;
  if (message.role === "assistant" || message.role === "toolResult") {
    const text = textContent(message.content);
    return text === undefined ? undefined : withTrailingNewline(text);
  }

  if (message.role === "bashExecution" && typeof message.output === "string") {
    return withTrailingNewline(message.output);
  }

  return undefined;
}

async function findNewestSessionFile(dir: string): Promise<string | undefined> {
  let newest: { path: string; mtimeMs: number } | undefined;

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          return;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;

        const info = await stat(path);
        if (!newest || info.mtimeMs > newest.mtimeMs) {
          newest = { path, mtimeMs: info.mtimeMs };
        }
      }),
    );
  }

  await walk(dir);
  return newest?.path;
}

function readRange(path: string, start: number, end: number): Promise<string> {
  if (end <= start) return Promise.resolve("");

  return new Promise((resolve, reject) => {
    let text = "";
    const stream = createReadStream(path, {
      start,
      end: end - 1,
      encoding: "utf8",
    });
    stream.on("data", (chunk) => {
      text += chunk;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(text));
  });
}

export function createPiSessionMessageStreamer(
  sessionDir: string,
  streamOutput: (chunk: string) => void,
  options: SessionStreamerOptions = {},
): { start(): void; stop(): Promise<void> } {
  const pollMs = options.pollMs ?? 100;
  let timer: NodeJS.Timeout | undefined;
  let polling: Promise<void> | undefined;
  let sessionPath: string | undefined;
  let offset = 0;
  let buffered = "";
  let totalTokensSoFar = options.totalTokensSoFar ?? 0;

  const processLine = (line: string) => {
    const entry = parseSessionLine(line);
    if (!entry) return;
    const text = sessionEntryToStreamText(entry, {
      ...options,
      totalTokensSoFar,
      onTokenUsage: (usage) => {
        totalTokensSoFar = usage.total;
        options.onTokenUsage?.(usage);
      },
    });
    if (text !== undefined) streamOutput(text);
  };

  const poll = async () => {
    if (!sessionPath) {
      sessionPath = await findNewestSessionFile(sessionDir);
      if (!sessionPath) return;
    }

    const info = await stat(sessionPath);
    if (info.size < offset) {
      offset = 0;
      buffered = "";
    }
    if (info.size === offset) return;

    const chunk = await readRange(sessionPath, offset, info.size);
    offset = info.size;
    buffered += chunk;

    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      processLine(buffered.slice(0, newlineIndex));
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
    }
  };

  const runPoll = async () => {
    if (polling) return polling;
    polling = poll().finally(() => {
      polling = undefined;
    });
    return polling;
  };

  return {
    start() {
      if (timer) return;
      void runPoll();
      timer = setInterval(() => {
        void runPoll();
      }, pollMs);
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await runPoll();
      if (buffered.trim()) {
        processLine(buffered);
        buffered = "";
      }
    },
  };
}

export function createPiSessionObservationStreamer(
  sessionDir: string,
  onObservation: (observation: PiSessionObservation) => void,
  options: { pollMs?: number; verboseOutput?: (chunk: string) => void } = {},
): { start(): void; stop(): Promise<void> } {
  const pollMs = options.pollMs ?? 100;
  let timer: NodeJS.Timeout | undefined;
  let polling: Promise<void> | undefined;
  let sessionPath: string | undefined;
  let offset = 0;
  let buffered = "";
  const observedToolCallIds = new Set<string>();

  const processLine = (line: string) => {
    const entry = parseSessionLine(line);
    if (!entry) return;
    for (const observation of sessionEntryToObservations(entry)) {
      if (observation.type === "tool-call" && observation.toolCallId) {
        if (observedToolCallIds.has(observation.toolCallId)) continue;
        observedToolCallIds.add(observation.toolCallId);
      }
      onObservation(observation);
    }
    if (options.verboseOutput) {
      const text = sessionEntryToRawText(entry);
      if (text !== undefined) options.verboseOutput(text);
    }
  };

  const poll = async () => {
    if (!sessionPath) {
      sessionPath = await findNewestSessionFile(sessionDir);
      if (!sessionPath) return;
    }

    const info = await stat(sessionPath);
    if (info.size < offset) {
      offset = 0;
      buffered = "";
    }
    if (info.size === offset) return;

    const chunk = await readRange(sessionPath, offset, info.size);
    offset = info.size;
    buffered += chunk;

    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      processLine(buffered.slice(0, newlineIndex));
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
    }
  };

  const runPoll = async () => {
    if (polling) return polling;
    polling = poll().finally(() => {
      polling = undefined;
    });
    return polling;
  };

  return {
    start() {
      if (timer) return;
      void runPoll();
      timer = setInterval(() => {
        void runPoll();
      }, pollMs);
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await runPoll();
      if (buffered.trim()) {
        processLine(buffered);
        buffered = "";
      }
    },
  };
}
