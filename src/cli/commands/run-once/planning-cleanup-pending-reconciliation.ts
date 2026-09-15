import type { RunOnceHostProvider } from "../../../host/types.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import {
  planningCleanupPendingResult,
  publishPlanningCleanupPending,
} from "./planning-cleanup-pending.ts";
import type { PlanningCleanupPendingOutcome } from "./planning-phase-runner-shared.ts";
import type { AgentIssueConfig } from "./types.ts";

function cleanupPendingOutcome(
  state: PlanningStateV1,
): PlanningCleanupPendingOutcome | undefined {
  const phase = state.phases.find(
    (candidate) =>
      "workspace" in candidate &&
      candidate.workspace.cleanup.state === "cleanup-pending",
  );
  if (
    phase === undefined ||
    !("workspace" in phase) ||
    !("pullRequest" in phase) ||
    phase.workspace.cleanup.state !== "cleanup-pending"
  )
    return undefined;
  return {
    kind: "cleanup-pending",
    state,
    phase: phase.kind,
    prUrl: phase.pullRequest.url,
    reason: phase.workspace.cleanup.reason,
    ignoredPaths: phase.workspace.cleanup.ignoredPaths,
  };
}

/** Replays only post-checkpoint pending-cleanup publication after a host failure. */
export async function reconcilePlanningCleanupPendingPublication(input: {
  host: Pick<
    RunOnceHostProvider,
    "viewIssue" | "applyLabels" | "commentIssue" | "listLabels" | "createLabel"
  >;
  config: AgentIssueConfig;
  issue: IssueSummary;
  state: PlanningStateV1;
  labels: { ready: string; inProgress: string; needsInfo: string };
}): Promise<PlanningCleanupPendingOutcome | undefined> {
  const outcome = cleanupPendingOutcome(input.state);
  if (
    outcome === undefined ||
    input.issue.labels.includes(input.labels.needsInfo)
  )
    return undefined;
  const result = planningCleanupPendingResult(
    input.issue,
    outcome,
    input.labels.ready,
  );
  await publishPlanningCleanupPending({
    host: input.host,
    config: input.config,
    result,
    labels: input.labels,
  });
  return outcome;
}

export function needsPlanningCleanupPendingPublication(input: {
  state: PlanningStateV1 | undefined;
  labels: readonly string[];
  needsInfoLabel: string;
}): boolean {
  return (
    input.state !== undefined &&
    !input.labels.includes(input.needsInfoLabel) &&
    cleanupPendingOutcome(input.state) !== undefined
  );
}
