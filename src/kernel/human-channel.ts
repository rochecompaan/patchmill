import type { PhaseLaunch, PhaseRun } from "./launch.ts";

export type Wait =
  | { kind: "gate"; message: string }
  | { kind: "review"; message: string };
export type BlockAnswer = { kind: "guidance"; text: string } | { kind: "quit" };
export type HumanChannel = {
  /** Runs planning in the Console session. Resolves with the confirmed
   * result, or `session.aborted` when the console quits. `feedback` holds the
   * reasons the previous submission failed verification. */
  runPlanning(launch: PhaseLaunch, feedback?: string): Promise<PhaseRun>;
  /** Runs implementation as a background worker. */
  runImplementation(launch: PhaseLaunch): Promise<PhaseRun>;
  /** Slice 2: continues the blocked worker with confirmed guidance. */
  resumeImplementation(
    launch: PhaseLaunch,
    guidance: string,
  ): Promise<PhaseRun>;
  awaitContinue(wait: Wait): Promise<"continue" | "quit">;
  /** Slice 2. */
  awaitGuidance(summary: string): Promise<BlockAnswer>;
  /** A progress or stop line for the chat. */
  notify(text: string): void;
};
