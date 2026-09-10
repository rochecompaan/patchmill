import { localPiAgentDir } from "../init/pi-agent-settings.ts";
import { runPiSessionPath } from "./progress.ts";
import { withLogPath } from "./pipeline-progress.ts";
import { createRunOnceHostProvider } from "../../../host/factory.ts";
import {
  PlanningIssueLockConflictError,
  acquirePlanningIssueLock,
  releasePlanningIssueLock,
  type PlanningIssueLock,
} from "../../../workflow/planning-issue-lock.ts";
import { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { blockerComment, startedComment } from "./pipeline-comments.ts";
import { lifecycleLabels } from "./pipeline-lifecycle.ts";
import { createPlanningRuntime } from "./planning-runtime.ts";
import {
  legacyActiveForIssue,
  planningIssueEligible,
} from "./planning-selection.ts";
import type { PlanningCoordinatorOutcome } from "./planning-phase-coordinator.ts";
import { readRunState } from "./run-state.ts";
import { planLabelChange } from "../triage/labels.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueStoppedResult,
  CommandRunner,
  IssueSummary,
} from "./types.ts";
import type { RunOneIssueOptions } from "./pipeline-legacy.ts";

export type PlanningPipelineResult =
  | AgentIssueStoppedResult
  | { status: "blocked"; issue: IssueSummary; result: AgentIssueBlockedResult }
  | {
      status: "coordinated";
      issue: IssueSummary;
      outcome: PlanningCoordinatorOutcome;
    };

type PlanningIssueInput = {
  issue: IssueSummary;
  config: AgentIssueConfig;
  state: PlanningStateV1;
  /** Whether selection observed durable planning state before acquiring the lock. */
  expectedStatePresence: "present" | "absent";
  runStateDir: string;
  stateStore: Pick<PlanningStateStore, "read" | "initialize">;
  readIssue: () => Promise<IssueSummary>;
  readLegacy: () => Promise<
    import("./types.ts").AgentIssueRunState | undefined
  >;
  eligible?: (
    issue: IssueSummary,
    state: PlanningStateV1 | undefined,
  ) => boolean;
  mutate: (issue: IssueSummary, fresh: boolean) => Promise<string[]>;
  coordinate: (
    state: PlanningStateV1,
    lock: PlanningIssueLock,
    issue: IssueSummary,
    labels: string[],
  ) => Promise<PlanningCoordinatorOutcome>;
  acquire?: typeof acquirePlanningIssueLock;
  release?: typeof releasePlanningIssueLock;
};

function blocked(issue: IssueSummary, reason: string): PlanningPipelineResult {
  return {
    status: "blocked",
    issue,
    result: {
      status: "blocked",
      reason,
      questions: [],
      commits: [],
      validation: [],
    },
  };
}

async function releaseOwnedPlanningLock(input: {
  lock: PlanningIssueLock;
  release: typeof releasePlanningIssueLock;
  workFailure: unknown;
}): Promise<void> {
  try {
    await input.release(input.lock);
  } catch (releaseFailure) {
    if (input.workFailure !== undefined)
      throw new AggregateError(
        [input.workFailure, releaseFailure],
        "Planning issue work and lock release failed",
        { cause: releaseFailure },
      );
    throw new Error("Planning lock release failed", { cause: releaseFailure });
  }
}

/**
 * Owns one planning issue attempt. Selection is advisory; every identity and
 * workflow check is repeated after the ownership-ID lock is acquired.
 */
export async function runPlanningIssue(
  input: PlanningIssueInput,
): Promise<PlanningPipelineResult> {
  const acquire = input.acquire ?? acquirePlanningIssueLock;
  const release = input.release ?? releasePlanningIssueLock;
  let lock: PlanningIssueLock | undefined;
  let workFailure: unknown;
  try {
    try {
      lock = await acquire(input.runStateDir, {
        issueNumber: input.issue.number,
        runId: input.state.runId,
      });
    } catch (error) {
      if (error instanceof PlanningIssueLockConflictError) {
        if (error.diagnostic.classification === "active")
          return {
            status: "stopped",
            issue: input.issue,
            reason: "issue-locked",
          };
        return blocked(
          input.issue,
          `issue-lock-${error.diagnostic.classification}`,
        );
      }
      throw error;
    }
    let retriedAuthoritativeRun = false;
    while (true) {
      const [issue, saved, legacy] = await Promise.all([
        input.readIssue(),
        input.stateStore.read(input.issue.number),
        input.readLegacy(),
      ]);
      // A planning selection owns a concrete durable state.  Never turn a
      // disappeared active selection into a fresh attempt after locking.
      if (
        (input.expectedStatePresence === "present" && saved === undefined) ||
        (retriedAuthoritativeRun && saved === undefined)
      )
        return blocked(input.issue, "planning-identity-changed");
      const current = saved ?? input.state;
      const planningActive = current.phases.some(
        (phase) => phase.status !== "complete",
      );
      const legacyActive = legacyActiveForIssue(issue, input.config, legacy);
      const eligible = planningIssueEligible({
        issue,
        config: input.config,
        state: current,
        activeOwnedWorkflow: saved !== undefined && planningActive,
      });
      if (
        issue.number !== input.issue.number ||
        issue.title !== input.issue.title ||
        issue.state !== "open" ||
        !planningActive ||
        legacyActive ||
        !eligible ||
        (input.eligible !== undefined && !input.eligible(issue, saved))
      )
        return blocked(input.issue, "planning-identity-changed");
      if (saved !== undefined && saved.runId !== lock.record.runId) {
        if (retriedAuthoritativeRun)
          return blocked(input.issue, "planning-identity-changed");
        const provisionalLock = lock;
        lock = undefined;
        await releaseOwnedPlanningLock({
          lock: provisionalLock,
          release,
          workFailure: undefined,
        });
        retriedAuthoritativeRun = true;
        try {
          lock = await acquire(input.runStateDir, {
            issueNumber: input.issue.number,
            runId: saved.runId,
          });
        } catch (error) {
          if (error instanceof PlanningIssueLockConflictError) {
            if (error.diagnostic.classification === "active")
              return {
                status: "stopped",
                issue: input.issue,
                reason: "issue-locked",
              };
            return blocked(
              input.issue,
              `issue-lock-${error.diagnostic.classification}`,
            );
          }
          throw error;
        }
        continue;
      }
      if (current.runId !== lock.record.runId)
        return blocked(input.issue, "planning-run-id-mismatch");
      const fresh = saved === undefined;
      if (fresh) await input.stateStore.initialize({ state: current, lock });
      const labels = await input.mutate(issue, fresh);
      return {
        status: "coordinated",
        issue,
        outcome: await input.coordinate(current, lock, issue, labels),
      };
    }
  } catch (error) {
    workFailure = error;
    throw error;
  } finally {
    if (lock) await releaseOwnedPlanningLock({ lock, release, workFailure });
  }
}

function statePaths(state: PlanningStateV1) {
  const implementation = state.phases.find(
    (phase) => phase.kind === "implementation",
  );
  const artifacts = state.phases.flatMap((phase) =>
    "artifacts" in phase ? phase.artifacts : [],
  );
  const workspace =
    implementation && "workspace" in implementation
      ? implementation.workspace
      : undefined;
  return {
    ...(artifacts.find((artifact) => artifact.kind === "spec")
      ? {
          specPath: artifacts.find((artifact) => artifact.kind === "spec")!
            .path,
        }
      : {}),
    ...(artifacts.find((artifact) => artifact.kind === "plan")
      ? {
          planPath: artifacts.find((artifact) => artifact.kind === "plan")!
            .path,
        }
      : {}),
    ...(workspace === undefined
      ? {}
      : {
          branch: workspace.identity.branch,
          worktreePath: workspace.identity.worktreePath,
        }),
  };
}

function mapOutcome(
  issue: IssueSummary,
  outcome: PlanningCoordinatorOutcome,
): AgentIssuePipelineResult {
  const paths = statePaths(outcome.state);
  switch (outcome.kind) {
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
        nextPhase: outcome.nextPhase,
        ...paths,
      };
    case "blocked":
      return { issue, ...paths, ...outcome.result };
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
    mutate: async (issue, fresh) => {
      const mustClaim =
        fresh ||
        issue.labels.includes(labels.ready) ||
        !issue.labels.includes(labels.inProgress);
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
      if (outcome.kind === "blocked") {
        const body = blockerComment(outcome.result);
        if (!issue.comments?.some((comment) => comment.body === body))
          await host.commentIssue(issue.number, body);
        await ensureAutomationLabel(host, input.config, labels.needsInfo);
        await host.applyLabels(
          planLabelChange(issue.number, currentLabels, [
            ...currentLabels.filter(
              (label) => label !== labels.ready && label !== labels.inProgress,
            ),
            labels.needsInfo,
          ]),
        );
      }
      return outcome;
    },
  });
  if (planning.status === "coordinated")
    return withLogPath(
      mapOutcome(planning.issue, planning.outcome),
      runOptions,
    );
  if (planning.status === "blocked")
    return withLogPath(
      { issue: planning.issue, ...planning.result },
      runOptions,
    );
  return withLogPath(planning, runOptions);
}
