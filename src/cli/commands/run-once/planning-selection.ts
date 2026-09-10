import {
  createPlanningState,
  type PlanningStateV1,
} from "../../../workflow/planning-state.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import { isResumableRunState, readRunState } from "./run-state.ts";
import {
  hasBlockedRunRecoveryState,
  lifecycleLabels,
} from "./pipeline-lifecycle.ts";
import { compareIssuesByPriority } from "./selection.ts";
import type { AgentIssueConfig, IssueSummary } from "./types.ts";

export type RunOnceWorkflowSelection =
  | { kind: "none" }
  | { kind: "invalid-planning-state"; issue: IssueSummary; reason: string }
  | { kind: "planning"; issue: IssueSummary; state: PlanningStateV1 }
  | { kind: "legacy"; issue: IssueSummary }
  | {
      kind: "fresh-planning";
      issue: IssueSummary;
      initialState: PlanningStateV1;
    };

function active(state: PlanningStateV1): boolean {
  return state.phases.some((phase) => phase.status !== "complete");
}

export async function selectRunOnceWorkflow(
  issues: readonly IssueSummary[],
  config: AgentIssueConfig,
  planningState: Pick<PlanningStateStore, "read" | "path">,
): Promise<RunOnceWorkflowSelection> {
  const choices: Array<Exclude<RunOnceWorkflowSelection, { kind: "none" }>> =
    [];
  for (const issue of issues) {
    if (issue.state !== "open") continue;
    let state: PlanningStateV1 | undefined;
    try {
      state = await planningState.read(issue.number);
    } catch (error) {
      return {
        kind: "invalid-planning-state",
        issue,
        reason:
          error instanceof Error ? error.message : "invalid planning state",
      };
    }
    const legacy = await readRunState(config.runStateDir, issue.number);
    const legacyActive = Boolean(
      legacy &&
      (isResumableRunState(legacy) ||
        (hasBlockedRunRecoveryState(legacy) &&
          issue.labels.includes(lifecycleLabels(config).ready))),
    );
    if (state && active(state) && legacyActive)
      return {
        kind: "invalid-planning-state",
        issue,
        reason: "planning and legacy state are both active",
      };
    if (state && active(state))
      choices.push({ kind: "planning", issue, state });
    else if (
      legacyActive &&
      (issue.labels.includes("in-progress") ||
        issue.labels.includes(lifecycleLabels(config).ready))
    )
      choices.push({ kind: "legacy", issue });
    else if (issue.labels.includes(config.readyLabel))
      choices.push({
        kind: "fresh-planning",
        issue,
        initialState: createPlanningState({
          issueNumber: issue.number,
          issueTitle: issue.title,
          gates: {
            specRequired: config.approvalPolicy.specApproval.required,
            planRequired: config.approvalPolicy.planApproval.required,
          },
        }),
      });
  }
  if (config.issueNumber !== undefined) {
    const selected = choices.find(
      (choice) => choice.issue.number === config.issueNumber,
    );
    return selected ?? { kind: "none" };
  }
  const rank = (choice: Exclude<RunOnceWorkflowSelection, { kind: "none" }>) =>
    choice.kind === "planning"
      ? 0
      : choice.kind === "legacy"
        ? 1
        : choice.kind === "fresh-planning"
          ? 2
          : -1;
  choices.sort(
    (left, right) =>
      rank(left) - rank(right) ||
      compareIssuesByPriority(
        left.issue,
        right.issue,
        config.triagePolicy?.runOnceSelection.priorityOrder ?? [],
      ),
  );
  return choices[0] ?? { kind: "none" };
}
