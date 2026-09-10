import {
  createPlanningState,
  PlanningStateValidationError,
  type PlanningStateV1,
} from "../../../workflow/planning-state.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import { isResumableRunState, readRunState } from "./run-state.ts";
import {
  hasBlockedRunRecoveryState,
  lifecycleLabels,
} from "./pipeline-lifecycle.ts";
import { DEFAULT_TRIAGE_POLICY } from "../triage/labels.ts";
import {
  isActionableWorkflowState,
  resolveWorkflowState,
} from "./workflow-state.ts";
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

export function planningStateDiagnostic(
  error: unknown,
  fallbackPath: string,
): string {
  if (error instanceof PlanningStateValidationError)
    return `${error.statePath ?? fallbackPath}: ${error.reason} at ${error.path}`;
  return `${fallbackPath}: planning state read failed`;
}

function active(state: PlanningStateV1): boolean {
  return state.phases.some((phase) => phase.status !== "complete");
}

/** Identifies finish recovery after the live done label may precede its checkpoint. */
export function planningFinishReachedDoneLabelBoundary(
  state: PlanningStateV1 | undefined,
): boolean {
  return Boolean(
    state?.phases.some(
      (phase) =>
        "finish" in phase &&
        (phase.finish.doneLabelApplied === true ||
          (phase.workspace.cleanup.state === "removed" &&
            phase.finish.visualEvidenceValidated === true &&
            phase.finish.handoffCommentPosted === true &&
            phase.finish.cleanupHookCompleted === true &&
            phase.finish.doneLabelEnsured === true)),
    ),
  );
}

export function planningIssueEligible(input: {
  issue: IssueSummary;
  config: AgentIssueConfig;
  state?: PlanningStateV1;
  activeOwnedWorkflow: boolean;
}): boolean {
  const { issue, config, state, activeOwnedWorkflow } = input;
  const lifecycle = lifecycleLabels(config);
  const excluded =
    config.triagePolicy?.runOnceSelection?.excludedLabels ??
    DEFAULT_TRIAGE_POLICY.runOnceSelection.excludedLabels;
  const doneCheckpoint = planningFinishReachedDoneLabelBoundary(state);
  const blocked = issue.labels.filter((label) => {
    if (activeOwnedWorkflow && label === lifecycle.inProgress) return false;
    if (doneCheckpoint && label === lifecycle.done) return false;
    return (
      label === lifecycle.done ||
      label === lifecycle.needsInfo ||
      excluded.includes(label)
    );
  });
  if (blocked.length === 0) return true;
  // Ready acknowledges only the lifecycle needs-info blocker for both retries.
  return (
    activeOwnedWorkflow &&
    issue.labels.includes(lifecycle.ready) &&
    blocked.every((label) => label === lifecycle.needsInfo)
  );
}

export function hasFinishedPlanningWorkspaceState(
  state: Awaited<ReturnType<typeof readRunState>>,
): boolean {
  return Boolean(
    state?.status === "finished" &&
    state.implementationStatus === undefined &&
    (state.specPath || state.planPath) &&
    (state.branch || state.worktreePath),
  );
}

/** Matches the legacy entry point's routing and explicit blocked-retry policy. */
export function legacyActiveForIssue(
  issue: IssueSummary,
  config: AgentIssueConfig,
  legacy: Awaited<ReturnType<typeof readRunState>>,
): boolean {
  if (!legacy) return false;
  if (isResumableRunState(legacy) || hasFinishedPlanningWorkspaceState(legacy))
    return true;
  return (
    config.issueNumber !== undefined &&
    hasBlockedRunRecoveryState(legacy) &&
    issue.labels.includes(lifecycleLabels(config).ready)
  );
}

export async function selectRunOnceWorkflow(
  issues: readonly IssueSummary[],
  config: AgentIssueConfig,
  planningState: Pick<PlanningStateStore, "read" | "path">,
): Promise<RunOnceWorkflowSelection> {
  const choices: Array<Exclude<RunOnceWorkflowSelection, { kind: "none" }>> =
    [];
  for (const issue of issues) {
    if (config.issueNumber !== undefined && issue.number !== config.issueNumber)
      continue;
    if (issue.state !== "open") continue;
    let state: PlanningStateV1 | undefined;
    try {
      state = await planningState.read(issue.number);
    } catch (error) {
      return {
        kind: "invalid-planning-state",
        issue,
        reason: planningStateDiagnostic(
          error,
          planningState.path(issue.number),
        ),
      };
    }
    const legacy = await readRunState(config.runStateDir, issue.number);
    const legacyActive = legacyActiveForIssue(issue, config, legacy);
    const ordinaryLegacyResume = Boolean(
      legacy &&
      isResumableRunState(legacy) &&
      issue.labels.includes(lifecycleLabels(config).inProgress),
    );
    if (state && active(state) && legacyActive)
      return {
        kind: "invalid-planning-state",
        issue,
        reason: "planning and legacy state are both active",
      };
    if (
      state &&
      active(state) &&
      planningIssueEligible({
        issue,
        config,
        state,
        activeOwnedWorkflow: true,
      })
    )
      choices.push({ kind: "planning", issue, state });
    else if (
      legacyActive &&
      (ordinaryLegacyResume ||
        planningIssueEligible({
          issue,
          config,
          activeOwnedWorkflow: true,
        })) &&
      (issue.labels.includes(lifecycleLabels(config).inProgress) ||
        issue.labels.includes(lifecycleLabels(config).ready) ||
        (hasFinishedPlanningWorkspaceState(legacy) &&
          isActionableWorkflowState(
            resolveWorkflowState(issue.labels, {
              readyLabel: lifecycleLabels(config).ready,
              policy: config.approvalPolicy,
            }),
          )))
    )
      choices.push({ kind: "legacy", issue });
    else if (
      issue.labels.includes(config.readyLabel) &&
      planningIssueEligible({
        issue,
        config,
        activeOwnedWorkflow: false,
      })
    )
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
