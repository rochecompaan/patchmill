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
