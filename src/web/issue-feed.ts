import type { IssueResponse, IssueUpdate } from "./api-types.ts";
import type { RunDataSource } from "./run-data.ts";
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
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const header = ({ thread: _thread, ...rest }: IssueResponse["issue"]) => rest;

/** Owns ordered observation, bounded replay, and lifetime of one feed per issue. */
export function createIssueFeed(input: {
  fingerprint(issue: number): Promise<string>;
  project(issue: number): Promise<IssueResponse | null>;
  clock: FeedClock;
  epoch(): string;
  warn(message: string): void;
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
      | { kind: "unavailable" },
  ) {
    const u = { ...payload, id: `${h.epoch}-${++h.sequence}` } as IssueUpdate;
    h.log.push(u);
    if (h.log.length > 1000) h.log.shift();
    for (const s of h.subscribers) if (s.ready) deliver(s, u);
  }
  async function tick(issue: number, h: Hub, force = false) {
    if (h.busy || !h.subscribers.size) return;
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
        const next = await input.project(issue);
        if (!h.subscribers.size) return;
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
        };
        hubs.set(selection.issue, h);
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
          if (hubs.get(selection.issue) === hub) hubs.delete(selection.issue);
        });
      };
    },
  };
}
