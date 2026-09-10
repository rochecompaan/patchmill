import type { GitWorktreeStrategyConfig } from "../../../git/types.ts";
import { runImplementationAgent } from "./implementation-agent.ts";
import { resolvePipelineRunCost } from "./pipeline-run-cost.ts";
import { createStepAccounting, progress } from "./pipeline-progress.ts";
import type { PlanningImplementationInput } from "./planning-implementation.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import type { AgentIssueConfig, CommandRunner, IssueSummary } from "./types.ts";

function planPath(state: PlanningStateV1): string {
  for (const phase of state.phases)
    if ("artifacts" in phase) {
      const path = phase.artifacts.find(
        (artifact) => artifact.kind === "plan",
      )?.path;
      if (path) return path;
    }
  throw new Error("Planning implementation requires a durable plan path");
}

export type PlanningImplementationAdapterInput = {
  runner: CommandRunner;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  git: GitWorktreeStrategyConfig;
  piAgentDir: string;
  tokenUsageState: { total: number };
  progressReporter?: Parameters<
    typeof runImplementationAgent
  >[0]["progressReporter"];
  streamPiOutput?: ((chunk: string) => void) | undefined;
  verbosePiOutput?: boolean | undefined;
  heartbeatMs?: number | undefined;
  piSessionPath?: string | undefined;
  now?: (() => Date) | undefined;
};

/** Builds the exact implementation agent callback for planning-pr-v1. */
export function createPlanningImplementationAdapter(
  input: PlanningImplementationAdapterInput,
): Omit<
  PlanningImplementationInput,
  "state" | "phaseIndex" | "lock" | "stateStore" | "host" | "workspaces" | "git"
> {
  const steps = createStepAccounting({
    progress: input.progressReporter,
    issueNumber: input.issue.number,
  });
  return {
    configuredGit: input.git,
    runAgent: async ({
      state,
      phase,
      git,
      requiredPullRequestMarker,
      workspaceCreated,
    }) => {
      const result = await runImplementationAgent({
        runner: input.runner,
        config: input.config,
        issue: input.issue,
        labels: input.labels,
        planPath: planPath(state),
        branch: phase.workspace.identity.branch,
        worktreePath: phase.workspace.identity.worktreePath,
        worktree: {
          branch: phase.workspace.identity.branch,
          worktreePath: phase.workspace.identity.worktreePath,
          created: workspaceCreated,
          hasExistingCommits:
            phase.workspace.headOid !== phase.workspace.baseOid,
          existingCommits:
            phase.workspace.headOid !== phase.workspace.baseOid
              ? [phase.workspace.headOid]
              : [],
        },
        git,
        resume: { resumed: !workspaceCreated },
        piAgentDir: input.piAgentDir,
        tokenUsageState: input.tokenUsageState,
        completedAt: (input.now ?? (() => new Date()))().toISOString(),
        progressReporter: input.progressReporter,
        streamPiOutput: input.streamPiOutput,
        verbosePiOutput: input.verbosePiOutput,
        heartbeatMs: input.heartbeatMs,
        piSessionPath: input.piSessionPath,
        requiredPullRequestMarker,
        progress: (level, stage, message, extras) =>
          progress(
            { progress: input.progressReporter },
            level,
            stage,
            message,
            {
              issueNumber: input.issue.number,
              ...extras,
            },
          ),
        runStep: steps.run,
        stepStart: steps.start,
        stepComplete: steps.complete,
        observePi: (stage) => async (observation) =>
          steps.observe(stage, observation),
      });
      if (result.kind === "implemented" || result.kind === "blocked")
        return result.result;
      return {
        status: "blocked",
        reason: result.result.reason,
        questions: [],
        commits: [],
        validation: [],
      };
    },
    resolveRunCost: () =>
      resolvePipelineRunCost({
        implementationKind: "implemented",
        implementationStatus: "pr-created",
        ...(input.piSessionPath === undefined
          ? {}
          : { piSessionPath: input.piSessionPath }),
        warn: (message, error) =>
          progress(
            { progress: input.progressReporter },
            "warning",
            "run-cost",
            message,
            {
              issueNumber: input.issue.number,
              data:
                error instanceof Error ? error.message : String(error ?? ""),
            },
          ),
      }),
    ...(input.now === undefined ? {} : { now: input.now }),
  };
}
