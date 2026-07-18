import { join } from "node:path";
import {
  profileExtensionArgs,
  runOnceImplementationPiProfile,
} from "../../../pi/resource-profiles.ts";
import { runDevelopmentEnvironmentStage } from "./development-environment-stage.ts";
import {
  assertIssueTodosComplete,
  issueTodoProgress,
  readIssueTodoTasks,
} from "./issue-todos.ts";
import { runPiPrompt } from "./pi.ts";
import { readPlanTaskLabels } from "./plan-tasks.ts";
import { buildImplementationPrompt } from "./prompts.ts";
import { writeRunState } from "./run-state.ts";
import {
  assertDirectLandAllowed,
  successfulImplementationFromState,
} from "./pipeline-lifecycle.ts";
import {
  progress as emitProgress,
  type PipelineProgressOptions,
} from "./pipeline-progress.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type { IssueWorktreeResult } from "./git.ts";
import type {
  AgentIssueConfig,
  AgentIssueDevelopmentEnvironmentHandoff,
  AgentIssueMergedResult,
  AgentIssuePiResult,
  AgentIssuePipelineResult,
  AgentIssuePrCreatedResult,
  AgentIssueRunState,
  CommandRunner,
  IssueSummary,
} from "./types.ts";

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
  host: Parameters<typeof runDevelopmentEnvironmentStage>[0]["host"];
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
  worktreeStrategy: Parameters<typeof buildImplementationPrompt>[0]["git"];
  existingState: AgentIssueRunState | undefined;
  resumableState: boolean;
  implementationCompleted: boolean | undefined;
  checkpoints: Record<string, boolean | undefined>;
  timestamp: string;
  runOptions: PipelineProgressOptions & {
    streamPiOutput?: (chunk: string) => void;
    verbosePiOutput?: boolean;
    heartbeatMs?: number;
  };
  piAgentDir: string;
  tokenUsageState: { total: number };
  progressReporter?: ProgressReporter;
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

export async function runPipelineImplementationStage(
  options: PipelineImplementationStageOptions,
): Promise<PipelineImplementationStageResult> {
  try {
    const {
      runner,
      host,
      config,
      issue,
      readyLabel,
      inProgressLabel,
      specPath,
      specCommit,
      planPath,
      planCommit,
      branch,
      worktreePath,
      worktree,
      worktreeStrategy,
      existingState,
      resumableState,
      timestamp,
      runOptions,
      piAgentDir,
      tokenUsageState,
      progressReporter,
      runStep,
      stepStart,
      stepComplete,
      observePi,
      emitSimpleStep,
    } = options;
    const details = {
      specPath,
      specCommit,
      planPath,
      planCommit,
      branch,
      worktreePath,
    };
    const alreadyImplemented =
      resumableState && options.implementationCompleted;
    let implemented = alreadyImplemented
      ? successfulImplementationFromState(existingState)
      : undefined;
    if (implemented) {
      assertDirectLandAllowed(
        implemented,
        config,
        "Saved implementation state",
      );
    }

    const worktreeRoot = join(config.repoRoot, worktreePath);
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "implementing",
        specPath,
        specCommit,
        planPath,
        planCommit,
        branch,
        worktreePath,
        checkpoints: { worktreeReady: true },
      },
      timestamp,
    );
    options.checkpoints.worktreeReady = true;

    let developmentEnvironment:
      | AgentIssueDevelopmentEnvironmentHandoff
      | undefined;
    if (!implemented && config.skills.developmentEnvironment) {
      const developmentEnvironmentStage = await runDevelopmentEnvironmentStage({
        runner,
        host,
        config,
        issue,
        labels: options.labels,
        readyLabel,
        inProgressLabel,
        specPath,
        specCommit,
        planPath,
        planCommit,
        branch,
        worktreePath,
        timestamp,
        logPath: runOptions.logPath,
        piSessionPath: runOptions.piSessionPath,
        streamPiOutput: runOptions.streamPiOutput,
        verbosePiOutput: runOptions.verbosePiOutput,
        heartbeatMs: runOptions.heartbeatMs,
        piAgentDir,
        tokenUsageState,
        progressReporter,
        progress: (level, stage, message, extras) =>
          emitProgress(runOptions, level, stage, message, extras),
        runStep,
        observePi,
        emitSimpleStep,
      });

      if (developmentEnvironmentStage.kind === "not-ready") {
        return { kind: "blocked", result: developmentEnvironmentStage.result };
      }

      developmentEnvironment = developmentEnvironmentStage.handoff;
    }

    if (!implemented) {
      await emitProgress(
        runOptions,
        "info",
        "pi-implementation",
        "running implementation with pi",
        { issueNumber: issue.number },
      );
      const taskContract = config.projectPolicy.pi.taskContract;
      const planTaskLabels = await readPlanTaskLabels(
        config.repoRoot,
        planPath,
        taskContract,
      );
      let activeImplementationTask:
        | { current: number; total: number; label: string }
        | undefined;
      let finalImplementationStepActive = false;
      const finalImplementationStepLabel = "final review and landing";

      const labelForTask = (current: number, runtimeLabel?: string): string => {
        const planLabel = planTaskLabels.find(
          (task) => task.number === current,
        )?.label;
        return planLabel ?? runtimeLabel ?? `task ${current}`;
      };

      const normalizeImplementationTaskProgress = (
        current: number,
        total: number,
      ): { current: number; total: number } => {
        if (planTaskLabels.length === 0) return { current, total };
        return {
          current: Math.min(Math.max(current, 1), planTaskLabels.length),
          total: planTaskLabels.length,
        };
      };

      const switchImplementationTask = async (
        rawCurrent: number,
        rawTotal: number,
        runtimeLabel?: string,
      ): Promise<void> => {
        const { current, total } = normalizeImplementationTaskProgress(
          rawCurrent,
          rawTotal,
        );
        const label = labelForTask(current, runtimeLabel);
        if (
          activeImplementationTask?.current === current &&
          activeImplementationTask.total === total &&
          activeImplementationTask.label === label
        ) {
          return;
        }
        if (finalImplementationStepActive) return;
        if (activeImplementationTask) {
          await stepComplete(
            `implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`,
          );
        }
        activeImplementationTask = { current, total, label };
        await stepStart(`implement task ${current}/${total} ${label}`);
      };

      const startFinalImplementationStep = async (): Promise<void> => {
        if (finalImplementationStepActive) return;
        if (activeImplementationTask) {
          await stepComplete(
            `implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`,
          );
          activeImplementationTask = undefined;
        }
        finalImplementationStepActive = true;
        await stepStart(finalImplementationStepLabel);
      };

      const issueTasksComplete = async (): Promise<boolean> => {
        const tasks = await readIssueTodoTasks(
          worktreeRoot,
          issue.number,
          taskContract,
        );
        return tasks.length > 0 && tasks.every((task) => task.done);
      };

      const refreshImplementationTask = async (
        refreshOptions: { startFinalWhenComplete?: boolean } = {},
      ): Promise<void> => {
        if (
          refreshOptions.startFinalWhenComplete &&
          (await issueTasksComplete())
        ) {
          await startFinalImplementationStep();
          return;
        }
        const runtimeProgress = await issueTodoProgress(
          worktreeRoot,
          issue.number,
          taskContract,
        );
        if (runtimeProgress) {
          await switchImplementationTask(
            runtimeProgress.current,
            runtimeProgress.total,
            runtimeProgress.label,
          );
        }
      };

      const observeImplementation = async (
        observation: AgentIssueProgressEvent["observation"],
      ): Promise<void> => {
        if (observation?.type === "tool-call") {
          await refreshImplementationTask({ startFinalWhenComplete: true });
        }
        await observePi("pi-implementation")(observation);
      };

      let piResult: AgentIssuePiResult | undefined;
      try {
        if (planTaskLabels.length > 0) {
          await switchImplementationTask(
            1,
            planTaskLabels.length,
            planTaskLabels[0]?.label,
          );
        }

        const projectPolicy = {
          ...config.projectPolicy,
          directLand: {
            ...config.projectPolicy.directLand,
            targetBranch: worktreeStrategy.baseBranch,
          },
        };
        const profile = runOnceImplementationPiProfile(
          config.skills,
          config.repoRoot,
        );

        piResult = await runPiPrompt(
          runner,
          worktreeRoot,
          buildImplementationPrompt({
            issue: { ...issue, labels: options.labels },
            planPath,
            branch,
            worktreePath,
            git: worktreeStrategy,
            projectPolicy,
            skills: config.skills,
            resume: {
              resumed: resumableState,
              worktreeCreated: worktree.created,
              existingCommits: worktree.existingCommits,
              priorBlockerReason: existingState?.lastError,
              priorBlockerQuestions: existingState?.blockerQuestions,
              priorValidation: existingState?.validation,
            },
            developmentEnvironment,
          }),
          {
            progress: progressReporter,
            stage: "pi-implementation",
            skillPaths: profile.additionalSkillPaths,
            extensionArgs: profileExtensionArgs(profile),
            streamOutput: runOptions.streamPiOutput,
            issueNumber: issue.number,
            repoRoot: worktreeRoot,
            heartbeatMs: runOptions.heartbeatMs,
            tokenUsageState,
            observeSession: true,
            sessionRoot: runOptions.piSessionPath,
            verbosePiOutput: runOptions.verbosePiOutput,
            onObservation: observeImplementation,
            taskContract: projectPolicy.pi.taskContract,
            piAgentDir,
            onTaskProgress: async (taskProgress) => {
              await switchImplementationTask(
                taskProgress.current,
                taskProgress.total,
                taskProgress.label,
              );
            },
          },
        );

        await refreshImplementationTask();
      } finally {
        if (activeImplementationTask) {
          await stepComplete(
            `implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`,
          );
          activeImplementationTask = undefined;
        }
        if (finalImplementationStepActive) {
          await stepComplete(finalImplementationStepLabel);
          finalImplementationStepActive = false;
        }
      }

      if (!piResult)
        throw new Error("Pi implementation completed without a result");
      if (piResult.status === "blocked") {
        return {
          kind: "blocked",
          result: await options.blockIssue(piResult, details),
        };
      }
      if (piResult.status !== "pr-created" && piResult.status !== "merged") {
        throw new Error(
          `Expected pr-created or merged from Pi but received ${piResult.status}`,
        );
      }

      assertDirectLandAllowed(piResult, config, "Pi");
      implemented = piResult;
    }

    await assertIssueTodosComplete(
      join(config.repoRoot, worktreePath),
      issue.number,
      config.projectPolicy.pi.taskContract,
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
