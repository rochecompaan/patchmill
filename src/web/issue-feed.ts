import type { IssueResponse, IssueUpdate } from "./api-types.ts";
import type { RunDataSource } from "./run-data.ts";
import type { SessionChange, SessionHub } from "./session/types.ts";
export type FeedClock = {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
};
type Subscriber = {
  listener: (u: IssueUpdate) => void;
  cursor: string | null;
  ready: boolean;
};
type Hub = {
  epoch: string;
  sequence: number;
  state: IssueResponse | null | undefined;
  log: IssueUpdate[];
  subscribers: Set<Subscriber>;
  fingerprint?: string;
  projectedAt: number;
  busy: boolean;
  stop?: (() => void) | undefined;
  expire?: (() => void) | undefined;
  /** Unsubscribes from the Session hub when this state expires. */
  unsubscribe?: (() => void) | undefined;
  /** The last session key seen, to notice a new, ended or removed session. */
  sessionId?: string | null;
  /** Reproject on the next tick: the run-file filter follows the session. */
  reproject: boolean;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const header = ({
  thread: _thread,
  session: _session,
  ...rest
}: IssueResponse["issue"]) => rest;

/** The run-file filter changes when a session starts, ends or goes away. */
const sessionKey = (
  session: { id: string; state: string } | null | undefined,
) =>
  session
    ? `${session.id}:${session.state === "ended" ? "ended" : "live"}`
    : null;
/** Owns ordered observation, bounded replay, and lifetime of one feed per issue. */
export function createIssueFeed(input: {
  fingerprint(issue: number): Promise<string>;
  project(issue: number): Promise<IssueResponse | null>;
  clock: FeedClock;
  epoch(): string;
  warn(message: string): void;
  sessions?: Pick<SessionHub, "current" | "subscribe">;
}): Pick<RunDataSource, "subscribe"> {
  const hubs = new Map<number, Hub>();
  function deliver(s: Subscriber, update: IssueUpdate) {
    try {
      s.listener(update);
    } catch {
      input.warn("Issue update listener failed.");
    }
  }
  function replay(h: Hub, s: Subscriber) {
    if (h.state === undefined) return;
    s.ready = true;
    const number = s.cursor?.startsWith(h.epoch + "-")
      ? Number(s.cursor.slice(9))
      : NaN;
    if (
      s.cursor &&
      /^\w{8}-\d{1,15}$/.test(s.cursor) &&
      Number.isSafeInteger(number) &&
      number >= (h.log[0] ? Number(h.log[0].id.slice(9)) - 1 : h.sequence) &&
      number <= h.sequence
    ) {
      for (const u of h.log) if (Number(u.id.slice(9)) > number) deliver(s, u);
    } else
      deliver(
        s,
        h.state
          ? { id: `${h.epoch}-${h.sequence}`, kind: "reset", issue: h.state }
          : { id: `${h.epoch}-${h.sequence}`, kind: "unavailable" },
      );
  }
  function emit(
    h: Hub,
    payload:
      | Omit<Extract<IssueUpdate, { kind: "header" }>, "id">
      | Omit<Extract<IssueUpdate, { kind: "thread" }>, "id">
      | Omit<Extract<IssueUpdate, { kind: "session" }>, "id">
      | Omit<Extract<IssueUpdate, { kind: "session-entries" }>, "id">
      | { kind: "unavailable" },
  ) {
    const u = { ...payload, id: `${h.epoch}-${++h.sequence}` } as IssueUpdate;
    h.log.push(u);
    if (h.log.length > 1000) h.log.shift();
    for (const s of h.subscribers) if (s.ready) deliver(s, u);
  }
  /** Fold a session change into the stored state, then log it in order. */
  function sessionChange(issue: number, h: Hub, change: SessionChange) {
    if (!h.state) return; // The next reset reads current().
    const session = input.sessions?.current(issue) ?? null;
    const id =
      change.kind === "session" ? sessionKey(change.session) : undefined;
    if (id !== undefined && id !== h.sessionId) {
      h.sessionId = id;
      h.reproject = true;
    }
    h.state = { ...h.state, issue: { ...h.state.issue, session } };
    emit(h, change);
  }
  async function tick(issue: number, h: Hub, force = false) {
    if (h.busy || !h.subscribers.size) return;
    force ||= h.reproject;
    h.busy = true;
    try {
      const fingerprint = await input.fingerprint(issue);
      if (!h.subscribers.size) return;
      if (
        force ||
        h.state === undefined ||
        fingerprint !== h.fingerprint ||
        input.clock.now() - h.projectedAt >= 60000
      ) {
        h.reproject = false;
        const found = await input.project(issue);
        if (!h.subscribers.size) return;
        // Merging the pull request closes the issue while its Web session
        // still runs or is kept. Keep the last view, so browsers still get
        // the session's last entries and its end, until the hub drops it.
        const projected =
          found === null && h.state && input.sessions?.current(issue)
            ? h.state
            : found;
        // Session changes that arrived during projection are already folded.
        const next =
          projected && h.state
            ? {
                ...projected,
                issue: { ...projected.issue, session: h.state.issue.session },
              }
            : projected;
        h.sessionId = sessionKey(next?.issue.session);
        const previous = h.state;
        if (previous === undefined) h.sequence = 1;
        else if (next === null) {
          if (previous !== null) emit(h, { kind: "unavailable" });
        } else if (previous === null) {
          // Eligibility returned: a reset is necessary because no prior detail exists.
          const u: IssueUpdate = {
            kind: "reset",
            id: `${h.epoch}-${++h.sequence}`,
            issue: next,
          };
          h.log.push(u);
          if (h.log.length > 1000) h.log.shift();
          for (const s of h.subscribers) if (s.ready) deliver(s, u);
        } else {
          let prefix = 0;
          while (
            prefix < previous.issue.thread.length &&
            prefix < next.issue.thread.length &&
            same(previous.issue.thread[prefix], next.issue.thread[prefix])
          )
            prefix++;
          if (
            prefix < previous.issue.thread.length ||
            prefix < next.issue.thread.length
          )
            emit(h, {
              kind: "thread",
              after: prefix ? next.issue.thread[prefix - 1]!.id : null,
              entries: next.issue.thread.slice(prefix),
            });
          if (!same(header(previous.issue), header(next.issue)))
            emit(h, {
              kind: "header",
              header: header(next.issue),
              syncedAt: next.syncedAt,
            });
        }
        h.state = next;
        h.fingerprint = fingerprint;
        h.projectedAt = input.clock.now();
      }
      for (const s of h.subscribers) if (!s.ready) replay(h, s);
    } catch {
      input.warn("Could not refresh optional issue updates.");
    } finally {
      h.busy = false;
    }
  }
  return {
    subscribe(selection, listener) {
      let h = hubs.get(selection.issue);
      if (!h) {
        h = {
          epoch: input.epoch(),
          sequence: 0,
          state: undefined,
          log: [],
          subscribers: new Set(),
          projectedAt: -Infinity,
          busy: false,
          reproject: false,
        };
        hubs.set(selection.issue, h);
        const state = h;
        state.unsubscribe = input.sessions?.subscribe(selection.issue, (c) =>
          sessionChange(selection.issue, state, c),
        );
      }
      const hub = h;
      const idle = !hub.subscribers.size;
      hub.expire?.();
      hub.expire = undefined;
      const s: Subscriber = {
        listener,
        cursor: selection.lastEventId,
        ready: false,
      };
      hub.subscribers.add(s);
      if (idle) {
        hub.stop = input.clock.every(1000, () => {
          void tick(selection.issue, hub);
        });
        void tick(selection.issue, hub, true);
      } else if (!hub.busy) replay(hub, s);
      return () => {
        if (!hub.subscribers.delete(s) || hub.subscribers.size) return;
        hub.stop?.();
        hub.stop = undefined;
        hub.expire = input.clock.after(300000, () => {
          if (hubs.get(selection.issue) !== hub) return;
          hubs.delete(selection.issue);
          hub.unsubscribe?.();
        });
      };
    },
  };
}
