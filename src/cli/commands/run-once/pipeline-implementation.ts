import type { CommandRunner } from "../../../command/types.ts";
import { join } from "node:path";
import { developmentEnvironmentNotReady } from "./development-environment-stage.ts";
import { runImplementationAgent } from "./implementation-agent.ts";
import { assertIssueTodosComplete } from "./issue-todos.ts";
import {
  assertDirectLandAllowed,
  successfulImplementationFromState,
} from "./pipeline-lifecycle.ts";
import { writeRunState } from "./run-state.ts";
import type { IssueWorktreeResult } from "./git.ts";
import type {
  AgentIssueConfig,
  AgentIssueMergedResult,
  AgentIssuePiResult,
  AgentIssuePipelineResult,
  AgentIssuePrCreatedResult,
  AgentIssueRunState,
  IssueSummary,
} from "./types.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import {
  progress as emitProgress,
  type PipelineProgressOptions,
} from "./pipeline-progress.ts";

export type PipelineSuccessfulImplementationResult =
  | AgentIssuePrCreatedResult
  | AgentIssueMergedResult;
export type PipelineImplementationStageResult =
  | {
      kind: "implemented";
      result: PipelineSuccessfulImplementationResult;
      labels: string[];
    }
  | {
      kind: "already-implemented";
      result: PipelineSuccessfulImplementationResult;
      labels: string[];
    }
  | { kind: "blocked"; result: AgentIssuePipelineResult }
  | { kind: "unexpected"; error: Error };
export type PipelineImplementationStageOptions = {
  runner: CommandRunner;
  host: Parameters<typeof developmentEnvironmentNotReady>[0]["host"];
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  readyLabel: string;
  inProgressLabel: string;
  specPath: string | undefined;
  specCommit: string | undefined;
  planPath: string | undefined;
  planCommit: string | undefined;
  branch: string | undefined;
  worktreePath: string;
  worktree: IssueWorktreeResult;
  worktreeStrategy: Parameters<typeof runImplementationAgent>[0]["git"];
  existingState: AgentIssueRunState | undefined;
  resumableState: boolean;
  implementationCompleted: boolean | undefined;
  checkpoints: Record<string, boolean | undefined>;
  timestamp: string;
  runOptions: PipelineProgressOptions & {
    streamPiOutput?: ((chunk: string) => void) | undefined;
    verbosePiOutput?: boolean | undefined;
    heartbeatMs?: number | undefined;
  };
  piAgentDir: string;
  tokenUsageState: { total: number };
  progressReporter?: ProgressReporter | undefined;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  stepStart: (label: string) => Promise<void>;
  stepComplete: (label: string) => Promise<void>;
  observePi: (
    stage:
      | "pi-artifact-extraction"
      | "pi-plan"
      | "pi-development-environment"
      | "pi-implementation",
  ) => (observation: AgentIssueProgressEvent["observation"]) => Promise<void>;
  emitSimpleStep: (issueNumber: number, label: string) => Promise<void>;
  blockIssue: (
    result: AgentIssuePiResult & { status: "blocked" },
    details: {
      specPath: string | undefined;
      specCommit: string | undefined;
      planPath: string | undefined;
      planCommit: string | undefined;
      branch: string | undefined;
      worktreePath: string | undefined;
    },
  ) => Promise<AgentIssuePipelineResult>;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Legacy adapter: owns run state, issue lifecycle, and direct-land policy only. */
export async function runPipelineImplementationStage(
  options: PipelineImplementationStageOptions,
): Promise<PipelineImplementationStageResult> {
  try {
    const details = {
      specPath: options.specPath,
      specCommit: options.specCommit,
      planPath: options.planPath,
      planCommit: options.planCommit,
      branch: options.branch,
      worktreePath: options.worktreePath,
    };
    const alreadyImplemented =
      options.resumableState && options.implementationCompleted;
    let implemented = alreadyImplemented
      ? successfulImplementationFromState(options.existingState)
      : undefined;
    if (implemented)
      assertDirectLandAllowed(
        implemented,
        options.config,
        "Saved implementation state",
      );

    await writeRunState(
      options.config.runStateDir,
      {
        issueNumber: options.issue.number,
        status: "implementing",
        ...details,
        checkpoints: { worktreeReady: true },
      },
      options.timestamp,
    );
    options.checkpoints.worktreeReady = true;

    if (!implemented) {
      if (!options.planPath || !options.branch)
        throw new Error(
          `Implementation requires a plan and branch for issue #${options.issue.number}`,
        );
      const outcome = await runImplementationAgent({
        runner: options.runner,
        config: options.config,
        issue: options.issue,
        labels: options.labels,
        planPath: options.planPath,
        branch: options.branch,
        worktreePath: options.worktreePath,
        worktree: options.worktree,
        git: options.worktreeStrategy,
        resume: {
          resumed: options.resumableState,
          existingState: options.existingState,
        },
        piAgentDir: options.piAgentDir,
        tokenUsageState: options.tokenUsageState,
        completedAt: options.timestamp,
        progressReporter: options.progressReporter,
        streamPiOutput: options.runOptions.streamPiOutput,
        verbosePiOutput: options.runOptions.verbosePiOutput,
        heartbeatMs: options.runOptions.heartbeatMs,
        piSessionPath: options.runOptions.piSessionPath,
        progress: async (level, stage, message, extras) =>
          emitProgress(options.runOptions, level, stage, message, extras),
        runStep: options.runStep,
        stepStart: options.stepStart,
        stepComplete: options.stepComplete,
        observePi: options.observePi,
      });
      if (outcome.kind === "environment-not-ready")
        return {
          kind: "blocked",
          result: await developmentEnvironmentNotReady(
            {
              ...options,
              planPath: options.planPath!,
              branch: options.branch!,
              progress: async (level, stage, message, extras) =>
                emitProgress(options.runOptions, level, stage, message, extras),
              ...(options.runOptions.logPath === undefined
                ? {}
                : { logPath: options.runOptions.logPath }),
              ...(options.runOptions.piSessionPath === undefined
                ? {}
                : { piSessionPath: options.runOptions.piSessionPath }),
              ...(options.runOptions.streamPiOutput === undefined
                ? {}
                : { streamPiOutput: options.runOptions.streamPiOutput }),
              ...(options.runOptions.verbosePiOutput === undefined
                ? {}
                : { verbosePiOutput: options.runOptions.verbosePiOutput }),
              ...(options.runOptions.heartbeatMs === undefined
                ? {}
                : { heartbeatMs: options.runOptions.heartbeatMs }),
            } satisfies Parameters<typeof developmentEnvironmentNotReady>[0],
            outcome.result,
          ),
        };
      if (outcome.kind === "blocked")
        return {
          kind: "blocked",
          result: await options.blockIssue(outcome.result, details),
        };
      implemented = outcome.result;
      assertDirectLandAllowed(implemented, options.config, "Pi");
    }
    await assertIssueTodosComplete(
      join(options.config.repoRoot, options.worktreePath),
      options.issue.number,
      options.config.projectPolicy.pi.taskContract,
    );
    return {
      kind: alreadyImplemented ? "already-implemented" : "implemented",
      result: implemented,
      labels: options.labels,
    };
  } catch (error) {
    return { kind: "unexpected", error: asError(error) };
  }
}
