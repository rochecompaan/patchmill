import { localPiAgentDir } from "../init/pi-agent-settings.ts";
import { runPiSessionPath } from "./progress.ts";
import { withLogPath } from "./pipeline-progress.ts";
import { createRunOnceHostProvider } from "../../../host/factory.ts";
import { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { blockerComment, startedComment } from "./pipeline-comments.ts";
import { lifecycleLabels } from "./pipeline-lifecycle.ts";
import { createPlanningRuntime } from "./planning-runtime.ts";
import { applyPlanningBlockedLabels } from "./planning-lifecycle-labels.ts";
import {
  planningCleanupPendingResult,
  publishPlanningCleanupPending,
} from "./planning-cleanup-pending.ts";
import { reconcilePlanningCleanupPendingPublication } from "./planning-cleanup-pending-reconciliation.ts";
import {
  planningFinishReachedDoneLabelBoundary,
  planningIssueEligible,
} from "./planning-selection.ts";
import type { PlanningCoordinatorOutcome } from "./planning-phase-coordinator.ts";
import { readRunState } from "./run-state.ts";
import { planLabelChange } from "../triage/labels.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import type { CommandRunner } from "../../../command/types.ts";
import {
  publicFailureForBlocked,
  statePaths,
} from "./planning-pipeline-diagnostics.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import { runPlanningIssue } from "./planning-pipeline-issue.ts";
import type { AgentIssueInternalBlockedResult } from "./types.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueStoppedResult,
} from "./types.ts";
import type { RunOneIssueOptions } from "./pipeline-legacy.ts";

export type PlanningPipelineResult =
  | AgentIssueStoppedResult
  | {
      status: "blocked";
      issue: IssueSummary;
      result: AgentIssueInternalBlockedResult;
    }
  | {
      status: "coordinated";
      issue: IssueSummary;
      outcome: PlanningCoordinatorOutcome;
    };

export { runPlanningIssue } from "./planning-pipeline-issue.ts";

export function planningIssueNeedsClaim(input: {
  issue: IssueSummary;
  fresh: boolean;
  state: PlanningStateV1;
  labels: Pick<
    ReturnType<typeof lifecycleLabels>,
    "ready" | "inProgress" | "done"
  >;
}): boolean {
  const doneLabelAlreadyApplied =
    input.issue.labels.includes(input.labels.done) &&
    planningFinishReachedDoneLabelBoundary(input.state);
  return (
    !doneLabelAlreadyApplied &&
    (input.fresh ||
      input.issue.labels.includes(input.labels.ready) ||
      !input.issue.labels.includes(input.labels.inProgress))
  );
}

export function mapPlanningOutcome(
  issue: IssueSummary,
  outcome: PlanningCoordinatorOutcome,
  readyLabel: string,
): AgentIssuePipelineResult {
  const paths = statePaths(outcome.state);
  switch (outcome.kind) {
    case "cleanup-pending":
      return planningCleanupPendingResult(issue, outcome, readyLabel);
    case "review-pending":
      return {
        status: "review-pending",
        issue,
        phase: outcome.phase,
        prUrl: outcome.prUrl,
      };
    case "stopped":
      return {
        status: "stopped",
        issue,
        reason: outcome.reason,
        publicFailure: runOnceFailure("plan-only", {
          issueNumber: issue.number,
          status: "stopped",
          phase: "implementation",
          ...paths,
          nextPhase: outcome.nextPhase,
        }),
        nextPhase: outcome.nextPhase,
        ...paths,
      };
    case "blocked":
      return {
        issue,
        ...paths,
        ...outcome.result,
        publicFailure: publicFailureForBlocked(issue, outcome.result, paths),
      };
    case "complete":
      if (!paths.planPath || !paths.branch || !paths.worktreePath)
        throw new Error(
          "Planning completion is missing durable implementation paths",
        );
      return {
        issue,
        ...outcome.result,
        planPath: paths.planPath,
        branch: paths.branch,
        worktreePath: paths.worktreePath,
        ...(paths.specPath === undefined ? {} : { specPath: paths.specPath }),
      };
  }
}

/** Constructs the production planning pipeline around the strict state store. */
export async function runPlanningWorkflow(input: {
  runner: CommandRunner;
  config: AgentIssueConfig;
  options: RunOneIssueOptions;
  issue: IssueSummary;
  state: PlanningStateV1;
  expectedStatePresence: "present" | "absent";
  host?: RunOnceHostProvider;
}): Promise<AgentIssuePipelineResult> {
  const host =
    input.host ??
    createRunOnceHostProvider({
      runner: input.runner,
      repoRoot: input.config.repoRoot,
      host: input.config.host,
    });
  const stateStore = new PlanningStateStore(input.config.runStateDir);
  const labels = lifecycleLabels(input.config);
  const attemptTimestamp = (input.options.now ?? new Date()).toISOString();
  const piSessionPath = runPiSessionPath(
    input.config.runStateDir,
    attemptTimestamp,
    input.issue.number,
  );
  const runOptions = { ...input.options, piSessionPath };
  await input.options.progress?.event({
    time: attemptTimestamp,
    level: "info",
    stage: "run",
    message: `issue #${input.issue.number} · ${input.issue.title}`,
    issueNumber: input.issue.number,
    step: {
      type: "run-start",
      issueNumber: input.issue.number,
      title: input.issue.title,
    },
  });
  const planning = await runPlanningIssue({
    issue: input.issue,
    config: input.config,
    state: input.state,
    expectedStatePresence: input.expectedStatePresence,
    runStateDir: input.config.runStateDir,
    stateStore,
    readIssue: () => host.viewIssue(input.issue.number),
    readLegacy: () =>
      readRunState(input.config.runStateDir, input.issue.number),
    eligible: (issue, state) =>
      planningIssueEligible({
        issue,
        config: input.config,
        ...(state === undefined ? {} : { state }),
        activeOwnedWorkflow: state !== undefined,
      }) &&
      (state !== undefined || issue.labels.includes(input.config.readyLabel)),
    reconcileCleanupPendingPublication: ({ issue, state }) =>
      reconcilePlanningCleanupPendingPublication({
        host,
        config: input.config,
        issue,
        state,
        labels: {
          ready: labels.ready,
          inProgress: labels.inProgress,
          needsInfo: labels.needsInfo,
        },
      }),
    mutate: async (issue, fresh, state) => {
      const mustClaim = planningIssueNeedsClaim({
        issue,
        fresh,
        state,
        labels,
      });
      const claimedLabels = mustClaim
        ? [
            ...issue.labels.filter(
              (label) => label !== labels.ready && label !== labels.needsInfo,
            ),
            labels.inProgress,
          ]
        : [...issue.labels];
      if (mustClaim) {
        await ensureAutomationLabel(host, input.config, labels.inProgress);
        await host.applyLabels(
          planLabelChange(issue.number, issue.labels, claimedLabels),
        );
      }
      const body = startedComment(issue);
      if (!issue.comments?.some((comment) => comment.body === body))
        await host.commentIssue(issue.number, body);
      return claimedLabels;
    },
    coordinate: async (state, lock, issue, currentLabels) => {
      const runtime = createPlanningRuntime({
        runner: input.runner,
        config: input.config,
        issue,
        labels: currentLabels,
        readyLabel: labels.ready,
        inProgressLabel: labels.inProgress,
        doneLabel: labels.done,
        needsInfoLabel: labels.needsInfo,
        piAgentDir: localPiAgentDir(input.config.repoRoot),
        tokenUsageState: { total: 0 },
        progressReporter: input.options.progress,
        streamPiOutput: input.options.streamPiOutput,
        verbosePiOutput: input.options.verbosePiOutput,
        heartbeatMs: input.options.heartbeatMs,
        piSessionPath,
        host,
        ...(input.options.now === undefined
          ? {}
          : { now: () => input.options.now! }),
      });
      const outcome = await runtime.coordinate(state, lock);
      if (outcome.kind === "cleanup-pending") {
        const result = planningCleanupPendingResult(
          issue,
          outcome,
          labels.ready,
        );
        await publishPlanningCleanupPending({
          host,
          config: input.config,
          result,
          labels: {
            ready: labels.ready,
            inProgress: labels.inProgress,
            needsInfo: labels.needsInfo,
          },
        });
      }
      if (outcome.kind === "blocked") {
        const body = blockerComment(outcome.result);
        if (!issue.comments?.some((comment) => comment.body === body))
          await host.commentIssue(issue.number, body);
        await ensureAutomationLabel(host, input.config, labels.needsInfo);
        await applyPlanningBlockedLabels({
          host,
          issueNumber: issue.number,
          labels: {
            ready: labels.ready,
            inProgress: labels.inProgress,
            needsInfo: labels.needsInfo,
          },
        });
      }
      return outcome;
    },
  });
  if (planning.status === "coordinated")
    return withLogPath(
      mapPlanningOutcome(planning.issue, planning.outcome, labels.ready),
      runOptions,
    );
  if (planning.status === "blocked")
    return withLogPath(
      {
        issue: planning.issue,
        ...planning.result,
        publicFailure: publicFailureForBlocked(planning.issue, planning.result),
      },
      runOptions,
    );
  return withLogPath(planning, runOptions);
}
