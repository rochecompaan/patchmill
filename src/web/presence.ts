import type { PresencePerson } from "./api-types.ts";

/** How long a typing flag lasts after the last typing signal. */
export const TYPING_MS = 6000;

export type PresenceClock = {
  after(ms: number, fn: () => void): () => void;
};
export type PresenceSend = (people: readonly PresencePerson[]) => void;

/**
 * Presence and typing for every issue in one `patchmill serve` process. It is
 * kept in memory only.
 */
export type Presence = {
  /**
   * Add one open stream. `name: null` watches but is not listed. `send` gets
   * the current list at once, then each change. The returned leave function
   * is idempotent.
   */
  join(issue: number, name: string | null, send: PresenceSend): () => void;
  /** Set or clear a typing flag. False when no open stream has this name. */
  typing(issue: number, name: string, typing: boolean): boolean;
};

type IssueState = {
  readonly streams: Set<PresenceSend>;
  /** Open streams per name, in the order of the first join. */
  readonly names: Map<string, number>;
  /** Cancel functions of the typing timers, per typing name. */
  readonly typing: Map<string, () => void>;
  version: number;
};

export function createPresence(input: {
  clock: PresenceClock;
  typingMs?: number;
}): Presence {
  const typingMs = input.typingMs ?? TYPING_MS;
  const issues = new Map<number, IssueState>();

  const list = (state: IssueState): PresencePerson[] =>
    [...state.names.keys()].map((name) => ({
      name,
      typing: state.typing.has(name),
    }));
  const deliver = (send: PresenceSend, people: readonly PresencePerson[]) => {
    try {
      send(people);
    } catch {
      // A failing stream must not stop the others; its cleanup leaves.
    }
  };
  const broadcast = (state: IssueState) => {
    const version = ++state.version;
    const people = list(state);
    for (const send of [...state.streams]) {
      // A send can cause a leave and a newer list; stop sending this one.
      if (state.version !== version) return;
      if (state.streams.has(send)) deliver(send, people);
    }
  };
  const clearTyping = (state: IssueState, name: string) => {
    const cancel = state.typing.get(name);
    if (!cancel) return false;
    cancel();
    state.typing.delete(name);
    return true;
  };

  return {
    join(issue, name, send) {
      let state = issues.get(issue);
      if (!state) {
        state = {
          streams: new Set(),
          names: new Map(),
          typing: new Map(),
          version: 0,
        };
        issues.set(issue, state);
      }
      const current = state;
      current.streams.add(send);
      const isNew = name !== null && !current.names.has(name);
      if (name !== null)
        current.names.set(name, (current.names.get(name) ?? 0) + 1);
      if (isNew) broadcast(current);
      else deliver(send, list(current));
      let left = false;
      return () => {
        if (left) return;
        left = true;
        current.streams.delete(send);
        let changed = false;
        if (name !== null) {
          const count = (current.names.get(name) ?? 1) - 1;
          if (count > 0) current.names.set(name, count);
          else {
            current.names.delete(name);
            clearTyping(current, name);
            changed = true;
          }
        }
        if (!current.streams.size) {
          if (issues.get(issue) === current) issues.delete(issue);
          return;
        }
        if (changed) broadcast(current);
      };
    },
    typing(issue, name, typing) {
      const state = issues.get(issue);
      if (!state?.names.has(name)) return false;
      if (!typing) {
        if (clearTyping(state, name)) broadcast(state);
        return true;
      }
      const wasTyping = clearTyping(state, name);
      state.typing.set(
        name,
        input.clock.after(typingMs, () => {
          state.typing.delete(name);
          broadcast(state);
        }),
      );
      if (!wasTyping) broadcast(state);
      return true;
    },
  };
}
