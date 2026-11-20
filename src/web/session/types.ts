import type {
  LiveSession,
  LiveSessionHeader,
  ThreadEvent,
} from "../api-types.ts";
import type {
  InteractivePi,
  InteractivePiOptions,
} from "../../kernel/pi-rpc-interactive.ts";

export type PiHandlers = Pick<InteractivePiOptions, "onEvent" | "onDialog">;
export type LaunchResult =
  | { kind: "started"; pi: InteractivePi }
  | { kind: "refused"; reason: string };
/** Starts the Pi process of one Web session. `signal` is aborted by Pause Web
 * session or server stop. */
export type SessionLauncher = (
  issue: number,
  handlers: PiHandlers,
  report: (line: string) => void,
  signal: AbortSignal,
) => Promise<LaunchResult>;

export type SessionInput = { author: string; requestId: string };
export type SessionChange =
  | { kind: "session"; session: LiveSessionHeader | null }
  /** Upsert by entry id. */
  | { kind: "session-entries"; entries: readonly ThreadEvent[] };
export type HubErrorCode =
  | "session_live"
  | "run_live"
  | "no_session"
  | "no_question"
  | "already_answered"
  /** HTTP 400; the other codes are 409. */
  | "invalid_choice"
  | "not_accepting"
  | "closing";
export type HubResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; code: HubErrorCode; message: string };

export type SessionHub = {
  start(issue: number, input: SessionInput): Promise<HubResult>;
  send(issue: number, input: SessionInput & { text: string }): HubResult;
  answer(
    issue: number,
    input: SessionInput & { questionId: string; choice: string },
  ): HubResult;
  stopReply(issue: number, input: SessionInput): HubResult;
  /** Returns at once; the effect shows on the stream. */
  pause(issue: number, input: SessionInput): HubResult;
  current(issue: number): LiveSession | null;
  subscribe(
    issue: number,
    listener: (change: SessionChange) => void,
  ): () => void;
  /** Idempotent. */
  close(): Promise<void>;
};
