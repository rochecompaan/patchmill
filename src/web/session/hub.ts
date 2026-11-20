import { randomUUID } from "node:crypto";
import type { LiveSession } from "../api-types.ts";
import type { FeedClock } from "../issue-feed.ts";
import type {
  HubResult,
  SessionChange,
  SessionHub,
  SessionInput,
  SessionLauncher,
} from "./types.ts";
import { createWebSession, type WebSession } from "./web-session.ts";

const OK: HubResult = { ok: true, duplicate: false };
const DUPLICATE: HubResult = { ok: true, duplicate: true };
const MAX_REQUEST_IDS = 1000;
const realClock: Pick<FeedClock, "after"> = {
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
const failure = (
  code: Extract<HubResult, { ok: false }>["code"],
  message: string,
): HubResult => ({ ok: false, code, message });
const NO_SESSION = () =>
  failure("no_session", "This issue has no live Web session.");

/** Owns the Web sessions of one `patchmill serve` process. */
export function createSessionHub(input: {
  launch: SessionLauncher;
  lockHeld: (issue: number) => Promise<boolean>;
  now?: () => Date;
  clock?: Pick<FeedClock, "after">;
  id?: () => string;
  retainMs?: number;
  warn: (message: string) => void;
}): SessionHub {
  const now = input.now ?? (() => new Date());
  const clock = input.clock ?? realClock;
  const newId = input.id ?? (() => randomUUID());
  const retainMs = input.retainMs ?? 30 * 60_000;
  const sessions = new Map<number, WebSession>();
  const removals = new Map<number, () => void>();
  const reserved = new Set<number>();
  const requests = new Map<number, { order: string[]; seen: Set<string> }>();
  const listeners = new Map<number, Set<(change: SessionChange) => void>>();
  const launches = new Set<Promise<void>>();
  const exits = new Set<Promise<unknown>>();
  let closing = false;
  let closed: Promise<void> | undefined;

  const emit = (issue: number, change: SessionChange) => {
    for (const listener of [...(listeners.get(issue) ?? [])]) {
      try {
        listener(change);
      } catch (error) {
        input.warn(`Web session listener failed: ${String(error)}`);
      }
    }
  };
  const ids = (issue: number) => {
    let entry = requests.get(issue);
    if (!entry) requests.set(issue, (entry = { order: [], seen: new Set() }));
    return entry;
  };
  const seen = (issue: number, requestId: string) =>
    requests.get(issue)?.seen.has(requestId) ?? false;
  const remember = (issue: number, requestId: string) => {
    const entry = ids(issue);
    entry.seen.add(requestId);
    entry.order.push(requestId);
    while (entry.order.length > MAX_REQUEST_IDS)
      entry.seen.delete(entry.order.shift()!);
  };
  const forget = (issue: number, requestId: string) => {
    const entry = requests.get(issue);
    if (!entry) return;
    entry.seen.delete(requestId);
    const index = entry.order.lastIndexOf(requestId);
    if (index >= 0) entry.order.splice(index, 1);
  };
  const live = (issue: number) => {
    const session = sessions.get(issue);
    return session && session.snapshot().state !== "ended"
      ? session
      : undefined;
  };
  const track = <T>(set: Set<Promise<T>>, promise: Promise<T>) => {
    set.add(promise);
    void promise.finally(() => set.delete(promise)).catch(() => undefined);
  };
  /** Request IDs first, then the live session, then the session's checks. */
  const withSession = (
    issue: number,
    request: SessionInput,
    act: (session: WebSession) => HubResult,
  ): HubResult => {
    if (seen(issue, request.requestId)) return DUPLICATE;
    const session = live(issue);
    if (!session) return NO_SESSION();
    const result = act(session);
    if (result.ok) remember(issue, request.requestId);
    return result;
  };

  const begin = (issue: number) => {
    removals.get(issue)?.();
    removals.delete(issue);
    const session: WebSession = createWebSession({
      id: newId(),
      now,
      after: (ms, fn) => clock.after(ms, fn),
      onChange: (change) => {
        if (sessions.get(issue) === session) emit(issue, change);
      },
    });
    sessions.set(issue, session);
    emit(issue, { kind: "session", session: headerOf(session.snapshot()) });
    const report = (line: string) => input.warn(`Issue #${issue}: ${line}`);
    track(
      launches,
      input.launch(issue, session.handlers, report, session.signal).then(
        (result) => {
          if (result.kind === "refused") return session.refuse(result.reason);
          track(exits, result.pi.exited);
          session.attach(result.pi);
        },
        (error: unknown) =>
          session.refuse(
            error instanceof Error ? error.message : String(error),
          ),
      ),
    );
    void session.ended.then(() => {
      if (sessions.get(issue) !== session) return;
      removals.set(
        issue,
        clock.after(retainMs, () => {
          if (sessions.get(issue) !== session) return;
          sessions.delete(issue);
          removals.delete(issue);
          emit(issue, { kind: "session", session: null });
        }),
      );
    });
  };

  return {
    async start(issue, request) {
      if (closing) return failure("closing", "The server is stopping.");
      if (seen(issue, request.requestId)) return DUPLICATE;
      if (reserved.has(issue) || live(issue))
        return failure("session_live", "This issue already has a Web session.");
      // Reserve before any await: two starts in one tick give one session.
      reserved.add(issue);
      remember(issue, request.requestId);
      const refuse = (result: HubResult) => {
        reserved.delete(issue);
        forget(issue, request.requestId);
        return result;
      };
      let held: boolean;
      try {
        held = await input.lockHeld(issue);
      } catch (error) {
        return refuse(
          failure(
            "run_live",
            `Patchmill could not check the issue lock: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      if (closing) return refuse(failure("closing", "The server is stopping."));
      if (held)
        return refuse(
          failure(
            "run_live",
            "This issue has a live run in another process. Wait for it to finish.",
          ),
        );
      reserved.delete(issue);
      begin(issue);
      return OK;
    },
    send: (issue, request) =>
      withSession(issue, request, (session) => session.send(request)),
    answer: (issue, request) =>
      withSession(issue, request, (session) => session.answer(request)),
    stopReply: (issue, request) =>
      withSession(issue, request, (session) => session.stopReply(request)),
    pause: (issue, request) =>
      withSession(issue, request, (session) => {
        void session.pause(request);
        return OK;
      }),
    current: (issue) => sessions.get(issue)?.snapshot() ?? null,
    subscribe(issue, listener) {
      let set = listeners.get(issue);
      if (!set) listeners.set(issue, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(issue);
      };
    },
    close() {
      return (closed ??= (async () => {
        closing = true;
        const pauses = [...sessions.values()].map((session) =>
          session.pause(null),
        );
        await Promise.all([...launches]);
        await Promise.all(pauses);
        await Promise.all([...exits]);
        for (const cancel of removals.values()) cancel();
        removals.clear();
      })());
    },
  };
}

function headerOf(session: LiveSession) {
  const { entries: _entries, ...header } = session;
  return header;
}
