import type { HumanChannel } from "./human-channel.ts";
import type { PhaseLaunch, PhaseLauncher, PhaseRun } from "./launch.ts";
import type { Outcome } from "./verify.ts";

/** Keep channel methods bound to their owner (Console channels hold state). */
export function launchPhase(
  launch: PhaseLaunch,
  fallback: PhaseLauncher,
  human?: HumanChannel,
  feedback?: string,
): Promise<PhaseRun> {
  if (!human) return fallback(launch);
  return launch.phase === "planning"
    ? human.runPlanning(launch, feedback)
    : human.runImplementation(launch);
}

export function planningFeedback(
  phase: PhaseLaunch["phase"],
  run: PhaseRun,
  verified: Outcome,
  human?: HumanChannel,
): string | undefined {
  if (
    human &&
    phase === "planning" &&
    !run.session.aborted &&
    verified.kind === "stop" &&
    verified.label === "needsInfo"
  )
    return verified.comment;
  return undefined;
}
