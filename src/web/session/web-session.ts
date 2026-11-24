import type {
  DialogAnswer,
  DialogRequest,
  InteractivePi,
  InteractivePiExit,
} from "../../kernel/pi-rpc-interactive.ts";
import type { RpcRecord } from "../../kernel/pi-rpc-protocol.ts";
import type {
  LiveQuestion,
  LiveSession,
  LiveSessionHeader,
  LiveSessionState,
  TextBlock,
  ThreadEvent,
} from "../api-types.ts";
import { providerFailureEntry } from "../../kernel/provider-failure.ts";
import { shortened, text as contentText } from "../pi-thread.ts";
import type {
  HubResult,
  PiHandlers,
  SessionChange,
  SessionInput,
} from "./types.ts";

export type WebSession = {
  readonly id: string;
  snapshot(): LiveSession;
  /** After launch. Ends `pi` at once when the session was paused first. */
  attach(pi: InteractivePi): void;
  /** Aborted by `pause()`. Give it to the launcher. */
  signal: AbortSignal;
  /** The launch was refused: the session ends as "refused". */
  refuse(reason: string): void;
  /** Give these to the launcher. */
  handlers: PiHandlers;
  send(input: SessionInput & { text: string }): HubResult;
  answer(
    input: SessionInput & { questionId: string; choice: string },
  ): HubResult;
  stopReply(input: SessionInput): HubResult;
  /** `null`: the server stops. */
  pause(input: SessionInput | null): Promise<void>;
  ended: Promise<void>;
};

export const MAX_ENTRIES = 2000;
const STREAM_MS = 100;
const OK: HubResult = { ok: true, duplicate: false };
const TEXT_DIALOG_NOTE =
  "Patchmill cancelled a text dialog that the web page cannot show.";
const EARLIER_TEXT =
  "Earlier Web session messages appear after the Web session ends.";
type Entry = ThreadEvent;
type Ended = NonNullable<LiveSessionHeader["ended"]>;
type NewEntry = Entry extends infer E
  ? E extends Entry
    ? Omit<E, "id" | "at">
    : never
  : never;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const paragraph = (value: string): TextBlock[] => [
  { kind: "paragraph", content: [{ kind: "text", text: value }] },
];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function createWebSession(input: {
  id: string;
  now: () => Date;
  after: (ms: number, fn: () => void) => () => void;
  onChange: (change: SessionChange) => void;
}): WebSession {
  const { id, now, after, onChange } = input;
  const startedAt = now().toISOString();
  const controller = new AbortController();
  const endedSignal = Promise.withResolvers<void>();
  const attached = Promise.withResolvers<InteractivePi>();
  attached.promise.catch(() => undefined);
  const entries: Entry[] = [];
  const sent: string[] = [];
  const answered = new Map<string, string>();
  const streams = new Map<number, string>();
  const tools = new Map<string, string>();
  const flushes = new Map<string, () => void>();
  let header: Mutable<LiveSessionHeader> = {
    id,
    startedAt,
    state: "starting",
    status: null,
    question: null,
    ended: null,
  };
  let pi: InteractivePi | undefined;
  let next = 0;
  let queue = Promise.resolve();
  let lastProgress: string | undefined;
  let pausedBy: "person" | "server" | undefined;

  const at = () => now().toISOString();
  const changeHeader = (patch: Partial<LiveSessionHeader>) => {
    header = { ...header, ...patch };
    onChange({ kind: "session", session: { ...header } });
  };
  const emitEntries = (list: Entry[]) => {
    if (list.length) onChange({ kind: "session-entries", entries: list });
  };
  const trim = () => {
    if (entries.length <= MAX_ENTRIES) return [];
    const marked = entries[0]?.kind === "earlier";
    // Keep the marker at index 0 and drop the oldest entries after it.
    entries.splice(
      marked ? 1 : 0,
      entries.length - MAX_ENTRIES + (marked ? 0 : 1),
    );
    if (marked) return [];
    const marker: Entry = {
      id: `web:${id}:earlier`,
      at: entries[0]?.at ?? at(),
      kind: "earlier",
      text: EARLIER_TEXT,
    };
    entries.unshift(marker);
    return [marker];
  };
  const add = (entry: NewEntry) => {
    const full = { ...entry, at: at(), id: `web:${id}:${++next}` } as Entry;
    entries.push(full);
    if (full.kind === "progress") lastProgress = full.text;
    emitEntries([full, ...trim()]);
    return full.id;
  };
  const replace = (entryId: string, patch: Partial<Entry>, emit = true) => {
    const index = entries.findIndex((e) => e.id === entryId);
    if (index < 0) return;
    entries[index] = { ...entries[index], ...patch } as Entry;
    if (emit) emitEntries([entries[index]]);
  };
  const flushLater = (entryId: string) => {
    if (flushes.has(entryId)) return;
    flushes.set(
      entryId,
      after(STREAM_MS, () => {
        flushes.delete(entryId);
        const entry = entries.find((e) => e.id === entryId);
        if (entry) emitEntries([entry]);
      }),
    );
  };
  const cancelFlush = (entryId: string) => {
    flushes.get(entryId)?.();
    flushes.delete(entryId);
  };
  const divider = (value: string) =>
    add({ kind: "divider", tone: "neutral", text: value });
  const error = (title: string, value: string) =>
    add({ kind: "error", title, text: value });
  const accepting = () =>
    header.state !== "pausing" && header.state !== "ended";
  const refusal = (): HubResult => ({
    ok: false,
    code: "not_accepting",
    message: "The Web session is not accepting input.",
  });
  const enqueue = (work: (pi: InteractivePi) => Promise<void>) => {
    queue = queue.then(async () => {
      const current = await attached.promise;
      await current.ready;
      await work(current);
    });
    queue = queue.catch(() => undefined);
  };
  const settleQuestion = (state: LiveSessionState = "replying") => {
    changeHeader({ question: null, ...(accepting() ? { state } : {}) });
  };
  const cancelQuestion = () => {
    const question = header.question;
    if (!question) return false;
    answered.set(question.id, "");
    pi?.answer(question.id, { cancelled: true });
    settleQuestion();
    return true;
  };

  const end = (ended: Ended) => {
    if (header.state === "ended") return;
    for (const cancel of flushes.values()) cancel();
    flushes.clear();
    if (header.question) answered.set(header.question.id, "");
    changeHeader({ state: "ended", question: null, ended });
    endedSignal.resolve();
  };
  const onExit = (exit: InteractivePiExit) => {
    if (exit.requested || pausedBy)
      return end({ reason: "paused", message: "The Web session is paused." });
    if (exit.exitCode === 0 && !exit.signal)
      return end({
        reason: "finished",
        message: lastProgress ?? "The Issue run ended.",
      });
    const code =
      exit.exitCode !== null ? `exit code ${exit.exitCode}` : `${exit.signal}`;
    const message = `Pi stopped unexpectedly (${code}). Press Resume to continue the Issue run. A worker that is still running stops when the next session starts.`;
    error("The Web session stopped", message);
    end({ reason: "crashed", message });
  };

  const assistantEntry = (index: number, value: string, final: boolean) => {
    const existing = streams.get(index);
    if (existing) {
      replace(existing, { blocks: paragraph(value) } as Partial<Entry>, final);
      if (final) cancelFlush(existing);
      else flushLater(existing);
      return;
    }
    streams.set(
      index,
      add({
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: paragraph(value),
        note: null,
      }),
    );
  };
  const streamText = new Map<number, string>();
  const onMessageEnd = (message: Record<string, unknown>) => {
    if (message.role === "user") {
      const value = contentText(message.content);
      const index = sent.indexOf(value);
      if (index >= 0) sent.splice(index, 1);
      else if (value) add({ kind: "prompt", text: value });
      return;
    }
    if (message.role === "custom") {
      if (message.customType !== "patchmill") return;
      const value = contentText(message.content);
      if (value) add({ kind: "progress", text: value });
      return;
    }
    if (message.role !== "assistant") return;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const [index, block] of content.entries())
      if (
        object(block) &&
        block.type === "text" &&
        typeof block.text === "string"
      )
        if (block.text || streams.has(index))
          assistantEntry(index, block.text, true);
    const failure = providerFailureEntry(message);
    if (failure) error(failure.title, failure.text);
    streams.clear();
    streamText.clear();
  };
  const onEvent = (record: RpcRecord) => {
    const r = record as Record<string, unknown>;
    switch (r.type) {
      case "agent_start":
        if (!header.question && accepting())
          changeHeader({ state: "replying" });
        return;
      case "agent_settled":
        if (!header.question && accepting()) changeHeader({ state: "idle" });
        return;
      case "message_update": {
        const event = r.assistantMessageEvent;
        if (!object(event) || event.type !== "text_delta") return;
        const index = Number(event.contentIndex);
        const value = (streamText.get(index) ?? "") + String(event.delta ?? "");
        streamText.set(index, value);
        assistantEntry(index, value, false);
        return;
      }
      case "message_end":
        if (object(r.message)) onMessageEnd(r.message);
        return;
      case "tool_execution_start": {
        const callId = String(r.toolCallId);
        tools.set(
          callId,
          add({
            kind: "tool",
            name: String(r.toolName),
            arguments: object(r.args) ? r.args : {},
            result: null,
            state: "running",
          }),
        );
        return;
      }
      case "tool_execution_end": {
        const entryId = tools.get(String(r.toolCallId));
        if (!entryId) return;
        tools.delete(String(r.toolCallId));
        const result = object(r.result) ? r.result.content : r.result;
        replace(entryId, {
          state: r.isError === true ? "failed" : "completed",
          result: shortened(contentText(result, true)),
        } as Partial<Entry>);
        return;
      }
      case "extension_error":
        error("Extension error", String(r.error ?? ""));
        return;
      case "extension_ui_request":
        if (r.method === "notify" && typeof r.message === "string")
          add({ kind: "progress", text: r.message });
        else if (r.method === "setStatus" && r.statusKey === "patchmill")
          changeHeader({
            status: typeof r.statusText === "string" ? r.statusText : null,
          });
        return;
    }
  };
  const onDialog = (request: DialogRequest) => {
    if (request.method === "input" || request.method === "editor") {
      pi?.answer(request.id, { cancelled: true });
      add({ kind: "progress", text: TEXT_DIALOG_NOTE });
      return;
    }
    if (!accepting()) {
      pi?.answer(request.id, { cancelled: true });
      return;
    }
    const question: LiveQuestion = {
      id: request.id,
      kind: request.method,
      title: request.title,
      message: request.message ?? null,
      options:
        request.method === "confirm" ? ["Yes", "No"] : (request.options ?? []),
    };
    changeHeader({ state: "question", question });
  };

  const pause = async (person: SessionInput | null) => {
    if (accepting()) {
      pausedBy = person ? "person" : "server";
      changeHeader({ state: "pausing" });
      divider(
        person
          ? `${person.author} paused the Web session.`
          : "The server stopped the Web session.",
      );
      if (header.question) {
        const question = header.question;
        answered.set(question.id, "");
        pi?.answer(question.id, { cancelled: true });
        changeHeader({ question: null });
      }
      controller.abort();
      if (pi) void pi.end().catch(() => undefined);
    }
    await endedSignal.promise;
  };

  return {
    id,
    signal: controller.signal,
    handlers: { onEvent, onDialog },
    ended: endedSignal.promise,
    snapshot: () => ({ ...header, entries: [...entries] }),
    attach(next) {
      if (pi || header.state === "ended") {
        void next.end().catch(() => undefined);
        return;
      }
      pi = next;
      attached.resolve(next);
      void next.exited.then(onExit);
      if (pausedBy) {
        void next.end().catch(() => undefined);
        return;
      }
      void next.ready.then(
        () => {
          if (header.state === "starting") changeHeader({ state: "idle" });
        },
        () => undefined,
      );
    },
    refuse(message) {
      attached.reject(new Error(message));
      if (pausedBy)
        return end({ reason: "paused", message: "The Web session is paused." });
      error("The Web session did not start", message);
      end({ reason: "refused", message });
    },
    send({ author, text }) {
      if (!accepting()) return refusal();
      add({
        kind: "message",
        author,
        role: "person",
        blocks: paragraph(text),
        note: null,
      });
      const message = `${author}: ${text}`;
      enqueue(async (current) => {
        sent.push(message);
        try {
          await current.prompt(message);
        } catch (failure) {
          const index = sent.indexOf(message);
          if (index >= 0) sent.splice(index, 1);
          error(
            "Message not delivered",
            `The agent did not get ${author}'s message: ${reason(failure)}. Send it again.`,
          );
        }
      });
      return OK;
    },
    answer({ author, questionId, choice }) {
      if (!accepting()) return refusal();
      const question = header.question;
      if (!question || question.id !== questionId) {
        const by = answered.get(questionId);
        return by
          ? {
              ok: false,
              code: "already_answered",
              message: `Already answered by ${by}.`,
            }
          : {
              ok: false,
              code: "no_question",
              message: "This question is no longer open.",
            };
      }
      if (!question.options.includes(choice))
        return {
          ok: false,
          code: "invalid_choice",
          message: `“${choice}” is not one of the choices.`,
        };
      answered.set(question.id, author);
      const answer: DialogAnswer =
        question.kind === "confirm"
          ? { confirmed: choice === "Yes" }
          : { value: choice };
      pi?.answer(question.id, answer);
      divider(`${author} chose “${choice}”.`);
      settleQuestion();
      return OK;
    },
    stopReply({ author }) {
      if (!accepting()) return refusal();
      cancelQuestion();
      divider(`${author} stopped the reply.`);
      enqueue((current) => current.abort());
      return OK;
    },
    pause,
  };
}
