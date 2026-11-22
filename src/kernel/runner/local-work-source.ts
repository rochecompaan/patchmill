import type { PatchmillConfig } from "../../config/config.ts";
import type { RunOnceDeps, RunOnceOutcome, runOneIssue } from "../run-once.ts";
import type { PassResult, WorkSource } from "./shell.ts";

/** From this many Needs Info stops in a row, each one is an error pass. */
export const NEEDS_INFO_STREAK_LIMIT = 3;

export type LocalWorkSourceInput = {
  config: PatchmillConfig;
  deps: RunOnceDeps;
  runOneIssue: typeof runOneIssue;
};

/**
 * One pass is one `runOneIssue` call without an issue number. A throw from
 * `pass` is an error pass: the run threw, its publication failed, or too many
 * runs in a row stopped with Needs Info.
 */
export function localWorkSource(input: LocalWorkSourceInput): WorkSource {
  let needsInfoStreak = 0;
  const countStop = (outcome: RunOnceOutcome) => {
    if (outcome.status === "completed") needsInfoStreak = 0;
    else if (outcome.status === "stopped")
      needsInfoStreak = outcome.label === "needsInfo" ? needsInfoStreak + 1 : 0;
  };
  return {
    async pass(signal: AbortSignal): Promise<PassResult> {
      const outcome = await input.runOneIssue(input.config, input.deps, {
        signal,
      });
      countStop(outcome);
      switch (outcome.status) {
        case "completed":
        case "stopped": {
          if (outcome.publicationErrors?.length)
            throw new Error(
              `publication failed for issue #${outcome.issue}: ${outcome.publicationErrors.join("; ")}`,
            );
          if (outcome.status === "completed") return { kind: "worked" };
          if (outcome.label === "inProgress")
            return {
              kind: "idle",
              reason: `issue #${outcome.issue} waits for a planning pull request`,
            };
          if (
            outcome.label === "needsInfo" &&
            needsInfoStreak >= NEEDS_INFO_STREAK_LIMIT
          )
            throw new Error(
              `${needsInfoStreak} runs in a row stopped with Needs Info; the last was issue #${outcome.issue}`,
            );
          return { kind: "worked" };
        }
        case "no-work":
          return { kind: "idle", reason: "no eligible issue" };
        case "claimed-elsewhere":
          return {
            kind: "idle",
            reason: `issue #${outcome.issue} is claimed elsewhere`,
          };
        case "refused":
          return { kind: "idle", reason: outcome.reason };
        case "paused":
          return signal.aborted
            ? { kind: "idle", reason: "stopping" }
            : { kind: "fatal", reason: "run paused without a stop request" };
        case "dry-run":
          return { kind: "fatal", reason: "unexpected dry-run outcome" };
        default: {
          const unknown: never = outcome;
          throw new Error(`Unknown run outcome: ${JSON.stringify(unknown)}`);
        }
      }
    },
  };
}
