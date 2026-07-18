import { join } from "node:path";
import {
  profileExtensionArgs,
  runOnceDevelopmentEnvironmentPiProfile,
} from "../../../pi/resource-profiles.ts";
import type { IssueHostProvider } from "../../../host/types.ts";
import { planLabelChange } from "../triage/labels.ts";
import { parseDevelopmentEnvironmentResult, runPiPrompt } from "./pi.ts";
import { buildDevelopmentEnvironmentPrompt } from "./prompts.ts";
import { writeRunState } from "./run-state.ts";
import { retryableLabelsAfterDevelopmentEnvironmentFailure } from "./workflow-state.ts";
import type {
  AgentIssueConfig,
  AgentIssueDevelopmentEnvironmentHandoff,
  AgentIssueDevelopmentEnvironmentResult,
  AgentIssuePipelineResult,
  AgentIssueProgressEvent,
  CommandRunner,
  IssueSummary,
  ProgressReporter,
} from "./types.ts";

export type DevelopmentEnvironmentStageResult =
  | { kind: "ready"; handoff: AgentIssueDevelopmentEnvironmentHandoff }
  | { kind: "not-ready"; result: AgentIssuePipelineResult };

type DevelopmentEnvironmentDetails = {
  specPath?: string;
  specCommit?: string;
  planPath: string;
  planCommit?: string;
  branch: string;
  worktreePath: string;
};

type DevelopmentEnvironmentStageOptions = DevelopmentEnvironmentDetails & {
  runner: CommandRunner;
  host: IssueHostProvider;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  readyLabel: string;
  inProgressLabel: string;
  timestamp: string;
  logPath?: string;
  piSessionPath?: string;
  streamPiOutput?: (chunk: string) => void;
  verbosePiOutput?: boolean;
  heartbeatMs?: number;
  piAgentDir: string;
  tokenUsageState: { total: number };
  progressReporter?: ProgressReporter;
  progress: (
    level: AgentIssueProgressEvent["level"],
    stage: string,
    message: string,
    extras?: Partial<
      Pick<AgentIssueProgressEvent, "issueNumber" | "elapsedSeconds" | "data">
    >,
  ) => Promise<void>;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  observePi: (
    stage: "pi-development-environment",
  ) => (observation: AgentIssueProgressEvent["observation"]) => Promise<void>;
  emitSimpleStep: (issueNumber: number, label: string) => Promise<void>;
};

function withLogPath<T extends AgentIssuePipelineResult>(
  result: T,
  options: Pick<
    DevelopmentEnvironmentStageOptions,
    "logPath" | "piSessionPath"
  >,
): T {
  return {
    ...result,
    ...(options.logPath ? { logPath: options.logPath } : {}),
    ...(options.piSessionPath ? { piSessionPath: options.piSessionPath } : {}),
  };
}

async function developmentEnvironmentNotReady(
  options: DevelopmentEnvironmentStageOptions,
  result: Extract<
    AgentIssueDevelopmentEnvironmentResult,
    { status: "not-ready" }
  >,
): Promise<AgentIssuePipelineResult> {
  const { host, config, issue, labels, timestamp } = options;
  await options.progress(
    "error",
    "development-environment",
    `development environment not ready: ${result.reason}`,
    { issueNumber: issue.number, data: result },
  );
  const retryableLabels = retryableLabelsAfterDevelopmentEnvironmentFailure(
    labels,
    {
      readyLabel: options.readyLabel,
      policy: config.approvalPolicy,
      originalLabels: issue.labels,
      inProgressLabel: options.inProgressLabel,
    },
  );

  if (retryableLabels.join("\0") !== labels.join("\0")) {
    await host.applyLabels(
      planLabelChange(issue.number, labels, retryableLabels),
    );
  }
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status: "finished",
      resetCheckpoints: true,
      specPath: options.specPath,
      specCommit: options.specCommit,
      planPath: options.planPath,
      planCommit: options.planCommit,
      lastError: result.reason,
    },
    timestamp,
  );
  await options.emitSimpleStep(
    issue.number,
    "final result development-environment-not-ready",
  );

  return withLogPath(
    {
      status: "development-environment-not-ready",
      issue,
      specPath: options.specPath,
      planPath: options.planPath,
      branch: options.branch,
      worktreePath: options.worktreePath,
      reason: result.reason,
      evidence: result.evidence,
      remediation: result.remediation,
    },
    options,
  );
}

export async function runDevelopmentEnvironmentStage(
  options: DevelopmentEnvironmentStageOptions,
): Promise<DevelopmentEnvironmentStageResult> {
  const developmentEnvironmentSkill =
    options.config.skills.developmentEnvironment;
  if (!developmentEnvironmentSkill) {
    throw new Error(
      "Development environment stage requires skills.developmentEnvironment",
    );
  }

  const worktreeRoot = join(options.config.repoRoot, options.worktreePath);
  const profile = runOnceDevelopmentEnvironmentPiProfile(
    options.config.skills,
    options.config.repoRoot,
  );
  const result = await options.runStep(
    "development environment",
    async (): Promise<AgentIssueDevelopmentEnvironmentResult> => {
      await options.progress(
        "info",
        "development-environment",
        "running development environment with pi",
        { issueNumber: options.issue.number },
      );
      return await runPiPrompt(
        options.runner,
        worktreeRoot,
        buildDevelopmentEnvironmentPrompt({
          issue: { ...options.issue, labels: options.labels },
          planPath: options.planPath,
          branch: options.branch,
          worktreePath: options.worktreePath,
          projectPolicy: options.config.projectPolicy,
          skills: options.config.skills,
        }),
        {
          progress: options.progressReporter,
          stage: "pi-development-environment",
          parseResult: parseDevelopmentEnvironmentResult,
          skillPaths: profile.additionalSkillPaths,
          extensionArgs: profileExtensionArgs(profile),
          streamOutput: options.streamPiOutput,
          issueNumber: options.issue.number,
          repoRoot: worktreeRoot,
          heartbeatMs: options.heartbeatMs,
          tokenUsageState: options.tokenUsageState,
          observeSession: true,
          sessionRoot: options.piSessionPath,
          verbosePiOutput: options.verbosePiOutput,
          onObservation: options.observePi("pi-development-environment"),
          taskContract: options.config.projectPolicy.pi.taskContract,
          piAgentDir: options.piAgentDir,
        },
      );
    },
  );

  if (result.status === "not-ready") {
    return {
      kind: "not-ready",
      result: await developmentEnvironmentNotReady(options, result),
    };
  }

  return {
    kind: "ready",
    handoff: {
      ...result,
      completedAt: options.timestamp,
    },
  };
}
