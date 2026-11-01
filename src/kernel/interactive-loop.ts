import type { HumanChannel } from "./human-channel.ts";
import type { PhaseLaunch, PhaseLauncher, PhaseRun } from "./launch.ts";
import { closesIssue, type Outcome, type OutcomeLabel } from "./verify.ts";
import type { Facts } from "./facts.ts";
import { planningGateComment } from "./comments.ts";

export async function continueGate(
  facts: Facts,
  human?: HumanChannel,
): Promise<boolean> {
  return (
    !!human &&
    (await human.awaitContinue({
      kind: "gate",
      message: planningGateComment(facts),
    })) === "continue"
  );
}

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

/** Preserve the non-interactive stop explanation before considering a gate wait. */
export function derivedStop(
  facts: Facts,
  issue: number,
  repository: Pick<import("../host/types.ts").Repository, "owner" | "repo">,
  initialLabel: OutcomeLabel,
): { label: OutcomeLabel; summary: string } {
  let label = initialLabel;
  let summary =
    label === "done"
      ? "The pull request is merged."
      : planningGateComment(facts);
  const closing =
    facts.pullRequest && closesIssue(facts.pullRequest.body, issue, repository);
  if (label === "done" && !closing) {
    label = "needsInfo";
    summary = `The merged pull request does not close issue #${issue}; it cannot prove implementation completion.`;
  } else if (facts.stage !== "implementation" && closing) {
    label = "needsInfo";
    summary = `The planning pull request would close issue #${issue}. Replace its closing reference with Refs #${issue} before merging it.`;
  }
  return { label, summary };
}
