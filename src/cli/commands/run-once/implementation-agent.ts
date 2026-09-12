import { resolve } from "node:path";
import type { PatchmillPiTaskContract } from "../../../policy/task-contract.ts";
import {
  profileExtensionArgs,
  runOnceImplementationPiProfile,
} from "../../../pi/resource-profiles.ts";
import { assertIssueTodosComplete } from "./issue-todos.ts";
import { createImplementationTaskProgress } from "./implementation-task-progress.ts";
import { runDevelopmentEnvironmentAgent } from "./development-environment-agent.ts";
import { runPiPrompt } from "./pi.ts";
import {
  buildImplementationPrompt,
  buildImplementationRepairPrompt,
} from "./prompts.ts";
import type { IssueWorktreeResult } from "./git.ts";
import type { CommandRunner } from "../../../command/types.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueDevelopmentEnvironmentNotReadyResult,
  AgentIssueMergedResult,
  AgentIssuePiResult,
  AgentIssuePrCreatedResult,
} from "../../../issue-run/types.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import type { AgentIssueRunState } from "./types.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type { AgentIssueConfig } from "./types.ts";

export type ImplementationAgentOutcome =
  | {
      kind: "implemented";
      result: AgentIssuePrCreatedResult | AgentIssueMergedResult;
    }
  | { kind: "blocked"; result: AgentIssueBlockedResult }
  | {
      kind: "environment-not-ready";
      result: AgentIssueDevelopmentEnvironmentNotReadyResult;
    };

export type ImplementationAgentInput = {
  runner: CommandRunner;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  planPath: string;
  branch: string;
  worktreePath: string;
  worktree: IssueWorktreeResult;
  git: Parameters<typeof buildImplementationPrompt>[0]["git"];
  resume: {
    resumed: boolean;
    existingState?: AgentIssueRunState | undefined;
  };
  piAgentDir: string;
  tokenUsageState: { total: number };
  completedAt: string;
  progressReporter?: ProgressReporter | undefined;
  streamPiOutput?: ((chunk: string) => void) | undefined;
  verbosePiOutput?: boolean | undefined;
  heartbeatMs?: number | undefined;
  piSessionPath?: string | undefined;
  requiredPullRequestMarker?: string | undefined;
  /** Planning runs pin operator todo state outside their owned worktree. */
  taskContract?: PatchmillPiTaskContract | undefined;
  progress: (
    level: AgentIssueProgressEvent["level"],
    stage: string,
    message: string,
    extras?: Partial<Pick<AgentIssueProgressEvent, "issueNumber">>,
  ) => Promise<void>;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  stepStart: (label: string) => Promise<void>;
  stepComplete: (label: string) => Promise<void>;
  observePi: (
    stage: "pi-development-environment" | "pi-implementation",
  ) => (observation: AgentIssueProgressEvent["observation"]) => Promise<void>;
};

/** Executes Pi implementation gates without legacy run-state or lifecycle effects. */
export async function runImplementationAgent(
  input: ImplementationAgentInput,
): Promise<ImplementationAgentOutcome> {
  const worktreeRoot = resolve(input.config.repoRoot, input.worktreePath);
  let developmentEnvironment;
  if (input.config.skills.developmentEnvironment) {
    const environment = await runDevelopmentEnvironmentAgent({
      runner: input.runner,
      config: input.config,
      issue: input.issue,
      labels: input.labels,
      planPath: input.planPath,
      branch: input.branch,
      worktreePath: input.worktreePath,
      completedAt: input.completedAt,
      piAgentDir: input.piAgentDir,
      tokenUsageState: input.tokenUsageState,
      progressReporter: input.progressReporter,
      streamPiOutput: input.streamPiOutput,
      verbosePiOutput: input.verbosePiOutput,
      heartbeatMs: input.heartbeatMs,
      piSessionPath: input.piSessionPath,
      progress: input.progress,
      runStep: input.runStep,
      observePi: input.observePi,
    });
    if (environment.kind === "not-ready")
      return { kind: "environment-not-ready", result: environment.result };
    developmentEnvironment = environment.handoff;
  }
  await input.progress(
    "info",
    "pi-implementation",
    "running implementation with pi",
    {
      issueNumber: input.issue.number,
    },
  );
  const taskContract =
    input.taskContract ?? input.config.projectPolicy.pi.taskContract;
  const taskProgress = await createImplementationTaskProgress({
    repoRoot: input.config.repoRoot,
    worktreeRoot,
    issueNumber: input.issue.number,
    planPath: input.planPath,
    taskContract,
    stepStart: input.stepStart,
    stepComplete: input.stepComplete,
  });
  let result: AgentIssuePiResult | undefined;
  try {
    await taskProgress.start();
    const projectPolicy = {
      ...input.config.projectPolicy,
      pi: { ...input.config.projectPolicy.pi, taskContract },
      directLand: {
        ...input.config.projectPolicy.directLand,
        targetBranch: input.git.baseBranch,
      },
    };
    const profile = runOnceImplementationPiProfile(
      input.config.skills,
      input.config.repoRoot,
    );
    result = await runPiPrompt(
      input.runner,
      worktreeRoot,
      buildImplementationPrompt({
        issue: { ...input.issue, labels: input.labels },
        planPath: input.planPath,
        branch: input.branch,
        worktreePath: input.worktreePath,
        git: input.git,
        projectPolicy,
        skills: input.config.skills,
        resume: {
          resumed: input.resume.resumed,
          worktreeCreated: input.worktree.created,
          existingCommits: input.worktree.existingCommits,
          priorBlockerReason: input.resume.existingState?.lastError,
          priorBlockerQuestions: input.resume.existingState?.blockerQuestions,
          priorValidation: input.resume.existingState?.validation,
        },
        ...(developmentEnvironment === undefined
          ? {}
          : { developmentEnvironment }),
        ...(input.requiredPullRequestMarker === undefined
          ? {}
          : { requiredPullRequestMarker: input.requiredPullRequestMarker }),
      }),
      {
        progress: input.progressReporter,
        stage: "pi-implementation",
        skillPaths: profile.additionalSkillPaths,
        extensionArgs: profileExtensionArgs(profile),
        streamOutput: input.streamPiOutput,
        issueNumber: input.issue.number,
        repoRoot: worktreeRoot,
        heartbeatMs: input.heartbeatMs,
        tokenUsageState: input.tokenUsageState,
        observeSession: true,
        sessionRoot: input.piSessionPath,
        verbosePiOutput: input.verbosePiOutput,
        onObservation: async (observation) => {
          await taskProgress.observe(observation);
          await input.observePi("pi-implementation")(observation);
        },
        taskContract: projectPolicy.pi.taskContract,
        piAgentDir: input.piAgentDir,
        repair: {
          maxAttempts: 2,
          buildPrompt: buildImplementationRepairPrompt,
        },
        onTaskProgress: taskProgress.update,
      },
    );
  } finally {
    await taskProgress.finish();
  }
  if (!result) throw new Error("Pi implementation completed without a result");
  if (result.status === "blocked") return { kind: "blocked", result };
  if (result.status !== "pr-created" && result.status !== "merged")
    throw new Error(
      `Expected pr-created or merged from Pi but received ${result.status}`,
    );
  await assertIssueTodosComplete(
    worktreeRoot,
    input.issue.number,
    taskContract,
  );
  return { kind: "implemented", result };
}
