import fs from "node:fs/promises";
import { join, sep } from "node:path";
import {
  limitCommandTimeout,
  type CommandLimits,
} from "../pi/command-timeout-extension.ts";
import type { Phase } from "./phase.ts";
import {
  blockReason,
  callTool,
  recoveryPrompt,
  topSession,
} from "./stall-text.ts";

export type StallLimits = {
  /** Quiet time before a Stall stop. 0 = off. */
  stopAfterMs: number;
  /** The Stall that is the Stall limit. 0 = off. */
  maxStalls: number;
  command: CommandLimits;
};
export type StallCall = {
  /** "planning session", "implementation session", or the subagent session path relative to the session directory. */
  session: string;
  /** The pi-subagents run ID from that path, for a subagent session. */
  run?: string;
  tool: string;
  /** Bash command text, whitespace collapsed. */
  command?: string;
  /** ISO time of the tool call entry. */
  startedAt: string;
  /** Monotonic time since the watch first saw the call. */
  runningMs: number;
};
export type Stall = {
  number: number;
  kind: "command-timeout" | "stall-stop";
  /** command-timeout: the one call; stall-stop: the new open calls, maybe none. */
  calls: StallCall[];
  /** stall-stop: Quiet time; command-timeout: call duration. */
  quietMs: number;
  /** Tool calls of the top-level session after the previous recovery, at most 5. */
  tried: string[];
};
export type StallDecision =
  | { kind: "recorded"; stall: Stall }
  | { kind: "recover"; stall: Stall; prompt: string; restartPrompt: string }
  | { kind: "block"; stalls: Stall[]; reason: string };
export type StallWatch = ReturnType<typeof createStallWatch>;

const EXEMPT_MARGIN_MS = 60_000;
const MAX_TRIED = 5;
const TIMEOUT = /^Command timed out after (\d+(?:\.\d+)?) seconds/;

type Entry = Record<string, unknown>;
type OpenCall = {
  key: string;
  file: string;
  id: string;
  tool: string;
  command?: string;
  commandKey: string;
  startedAt: string;
  seenAt: number;
  exemptUntil?: number;
};
type FileState = { offset: number; rest: Buffer };

const isObject = (value: unknown): value is Entry =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function resultText(message: Entry): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isObject)
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

/** The run ID is the path segment before `run-<n>`. */
function runOf(relative: string): string | undefined {
  const parts = relative.split(sep);
  const index = parts.findIndex((part) => /^run-\d+$/.test(part));
  return index > 0 ? parts[index - 1] : undefined;
}

/**
 * The Stall rules for one unattended phase session: Activity, Quiet
 * time, Command timeouts, the Stall count, the same-command rule and the text
 * of the recovery prompt and the blocked reason. It reads the session files
 * under `sessionDir` and has no timers.
 */
export function createStallWatch(options: {
  sessionDir: string;
  limits: StallLimits;
  phase: Phase;
  /** Monotonic milliseconds. */
  now: () => number;
}) {
  const { sessionDir, limits, now } = options;
  const TOP = topSession(options.phase);
  const stopped = `The ${TOP} stopped`;
  const files = new Map<string, FileState>();
  const open = new Map<string, OpenCall>();
  const listed = new Set<string>();
  const keys = new Set<string>();
  const stalls: Stall[] = [];
  let tried: string[] = [];
  let lastActivity = now();
  let stoppedPeriod: number | undefined;
  let blocked = false;
  let topFile: string | undefined;

  const stallCall = (call: OpenCall, at: number): StallCall => {
    const run = runOf(call.file);
    return {
      session: call.file.includes(sep) ? call.file : TOP,
      ...(call.file.includes(sep) && run ? { run } : {}),
      tool: call.tool,
      ...(call.command !== undefined ? { command: call.command } : {}),
      startedAt: call.startedAt,
      runningMs: at - call.seenAt,
    };
  };

  const block = (
    opening: string,
  ): Extract<StallDecision, { kind: "block" }> => {
    blocked = true;
    return {
      kind: "block",
      stalls: [...stalls],
      reason: blockReason(opening, stalls),
    };
  };

  /** Adds a Stall and decides whether it is the Stall limit. */
  const add = (
    stall: Omit<Stall, "number" | "tried">,
    stallKeys: string[],
  ): StallDecision => {
    const repeat = stallKeys.some((key) => keys.has(key));
    for (const key of stallKeys) keys.add(key);
    const full: Stall = {
      ...stall,
      number: stalls.length + 1,
      tried: [...tried],
    };
    stalls.push(full);
    if (repeat) return block(`${stopped}: the same command stalled twice.`);
    if (limits.maxStalls > 0 && full.number >= limits.maxStalls)
      return block(`${stopped} after ${full.number} stalls.`);
    if (stall.kind === "command-timeout")
      return { kind: "recorded", stall: full };
    const text = (restart: boolean) =>
      recoveryPrompt({
        stall: full,
        stopAfterMs: limits.stopAfterMs,
        maxStalls: limits.maxStalls,
        openEarlier: open.size > 0 && full.calls.length === 0,
        restart,
      });
    return {
      kind: "recover",
      stall: full,
      prompt: text(false),
      restartPrompt: text(true),
    };
  };

  const onEntry = (
    file: string,
    entry: Entry,
    at: number,
    out: StallDecision[],
  ) => {
    if (entry.type !== "message" || !isObject(entry.message)) return;
    const message = entry.message;
    const time = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (message.role === "user" || message.role === "assistant") {
      // Pi never writes a result for a call that a killed process left behind.
      for (const [key, call] of open) if (call.file === file) open.delete(key);
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isObject(block) || block.type !== "toolCall") continue;
        if (typeof block.id !== "string" || typeof block.name !== "string")
          continue;
        const args = isObject(block.arguments) ? block.arguments : {};
        const command =
          block.name === "bash" && typeof args.command === "string"
            ? args.command.replace(/\s+/g, " ").trim()
            : undefined;
        const call: OpenCall = {
          key: `${file}\0${block.id}`,
          file,
          id: block.id,
          tool: block.name,
          ...(command !== undefined ? { command } : {}),
          commandKey:
            command !== undefined
              ? `bash ${command}`
              : `${block.name} ${stableJson(args)}`,
          startedAt: time,
          seenAt: at,
        };
        if (block.name === "bash") {
          const timeout = limitCommandTimeout(
            typeof args.timeout === "number" ? args.timeout : undefined,
            limits.command,
          );
          if (timeout !== undefined && timeout > 0)
            call.exemptUntil = at + timeout * 1000 + EXEMPT_MARGIN_MS;
        }
        open.set(call.key, call);
        if (file === topFile) {
          tried.push(callTool(call));
          if (tried.length > MAX_TRIED) tried = tried.slice(-MAX_TRIED);
        }
      }
      return;
    }
    if (message.role !== "toolResult" || typeof message.toolCallId !== "string")
      return;
    const key = `${file}\0${message.toolCallId}`;
    const call = open.get(key);
    open.delete(key);
    if (blocked || message.toolName !== "bash" || message.isError !== true)
      return;
    const last = resultText(message).trimEnd().split("\n\n").at(-1) ?? "";
    const match = TIMEOUT.exec(last.trimStart());
    if (!match) return;
    const known: OpenCall = call ?? {
      key,
      file,
      id: message.toolCallId,
      tool: "bash",
      commandKey: `bash ${message.toolCallId}`,
      startedAt: time,
      seenAt: at,
    };
    listed.add(key);
    out.push(
      add(
        {
          kind: "command-timeout",
          calls: [stallCall(known, at)],
          quietMs: Number(match[1]) * 1000,
        },
        [known.commandKey],
      ),
    );
  };

  const readFile = async (
    relative: string,
    at: number,
    out: StallDecision[],
  ) => {
    const path = join(sessionDir, relative);
    const state = files.get(relative) ?? { offset: 0, rest: Buffer.alloc(0) };
    files.set(relative, state);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(path, "r");
      const { size } = await handle.stat();
      if (size < state.offset) {
        state.offset = 0;
        state.rest = Buffer.alloc(0);
      }
      if (size === state.offset) return false;
      const chunk = Buffer.alloc(size - state.offset);
      const { bytesRead } = await handle.read(
        chunk,
        0,
        chunk.length,
        state.offset,
      );
      state.offset += bytesRead;
      let data = Buffer.concat([state.rest, chunk.subarray(0, bytesRead)]);
      const end = data.lastIndexOf(0x0a);
      state.rest = end < 0 ? data : data.subarray(end + 1);
      data = end < 0 ? Buffer.alloc(0) : data.subarray(0, end);
      for (const line of data.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (isObject(entry)) onEntry(relative, entry, at, out);
      }
      return bytesRead > 0;
    } catch {
      return false;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };

  const sessionFiles = async () => {
    try {
      const names = await fs.readdir(sessionDir, { recursive: true });
      return names
        .filter(
          (name) =>
            name.endsWith(".jsonl") &&
            !name.split(sep).includes("subagent-artifacts"),
        )
        .sort();
    } catch {
      return [];
    }
  };

  return {
    /** Each RPC record of the phase Pi process. Only `message_update` is Activity. */
    record(record: { type?: unknown }): void {
      if (record.type === "message_update") lastActivity = now();
    },
    /** Read new session file bytes and return the decisions since the last poll. */
    async poll(): Promise<StallDecision[]> {
      if (blocked) return [];
      const out: StallDecision[] = [];
      const names = await sessionFiles();
      topFile ??= names.find((name) => !name.includes(sep));
      for (const name of names) {
        const at = now();
        if (await readFile(name, at, out)) lastActivity = at;
        if (blocked) return out;
      }
      const at = now();
      if (limits.stopAfterMs <= 0) return out;
      let quietStart = lastActivity;
      for (const call of open.values()) {
        if (call.exemptUntil === undefined) continue;
        if (call.exemptUntil > at) return out;
        quietStart = Math.max(quietStart, call.exemptUntil);
      }
      if (at - quietStart < limits.stopAfterMs || stoppedPeriod === quietStart)
        return out;
      stoppedPeriod = quietStart;
      const fresh = [...open.values()].filter((call) => !listed.has(call.key));
      for (const call of fresh) listed.add(call.key);
      out.push(
        add(
          {
            kind: "stall-stop",
            calls: fresh.map((call) => stallCall(call, at)),
            quietMs: at - quietStart,
          },
          fresh.map((call) => call.commandKey),
        ),
      );
      return out;
    },
    /** After a recovery prompt: Quiet time restarts and later tool calls count as "tried". */
    recovered(): void {
      lastActivity = now();
      tried = [];
    },
    /** Turn the last Stall into the Stall limit, for example when Pi cannot restart. */
    fail(cause: string): Extract<StallDecision, { kind: "block" }> {
      return block(
        `${stopped}: Patchmill could not restart Pi after a stall (${cause}).`,
      );
    },
    stalls(): readonly Stall[] {
      return stalls;
    },
    /** The top-level session file of the phase session, when it exists. */
    sessionFile(): string | undefined {
      return topFile ? join(sessionDir, topFile) : undefined;
    },
  };
}
