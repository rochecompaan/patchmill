/** Typed public facade for Run recovery planning and legacy compatibility. */
import { assessRunRecovery } from "./recovery-assessment.ts";
import { decideRunRecovery } from "./recovery-policy.ts";
export { createRunRecoveryPaths } from "./recovery-policy.ts";
import type { PlanRunRecoveryInput, RunRecoveryDecision } from "./types.ts";

export {
  formatBlockedRunRecoveryReport,
  hasBlockedRunRecoveryState,
  inspectBlockedRunRecovery,
} from "./recovery-legacy.ts";
export type {
  BlockedRunRecoveryKind,
  BlockedRunRecoveryReport,
} from "./recovery-legacy.ts";

/** Assess immutable recovery evidence before returning a policy-only action. */
export async function planRunRecovery(
  input: PlanRunRecoveryInput,
): Promise<RunRecoveryDecision> {
  return decideRunRecovery(
    input.intent,
    await assessRunRecovery(input),
    input.recoveryPaths,
  );
}

export function formatRunRecoveryDecision(
  decision: RunRecoveryDecision,
): string {
  if (decision.action === "refuse") {
    if (decision.reason === "active-run") {
      const owner = decision.owner
        ? ` (owned by ${decision.owner.hostname}:${decision.owner.pid})`
        : "";
      return [
        `Issue run is active at ${decision.leasePath}${owner}.`,
        ...decision.guidance,
      ].join("\n");
    }
    return [
      `Issue #${decision.assessment.issueNumber} recovery refused: ${decision.reason}.`,
      ...decision.guidance,
    ].join("\n");
  }
  if (decision.action === "refresh-and-resume")
    return `Issue #${decision.assessment.issueNumber} has a stale empty branch; refresh to pinned base ${decision.refresh.baseOid} before resuming.`;
  if (decision.action === "recreate-and-resume")
    return `Issue #${decision.assessment.issueNumber} will recreate its clean workspace before resuming.`;
  if (decision.action === "archive-reset-and-start")
    return `Issue #${decision.assessment.issueNumber} will archive recovery state and start a new Run attempt.`;
  return `Issue #${decision.assessment.issueNumber} will resume (${decision.assessment.classification}).`;
}
