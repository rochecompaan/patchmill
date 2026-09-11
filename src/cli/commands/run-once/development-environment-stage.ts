import type { IssueHostProvider } from "../../../host/types.ts";
import { planLabelChange } from "../triage/labels.ts";
import { runDevelopmentEnvironmentAgent } from "./development-environment-agent.ts";
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
  specPath?: string | undefined;
  specCommit?: string | undefined;
  planPath: string;
  planCommit?: string | undefined;
  branch: string;
  worktreePath: string;
};

export type DevelopmentEnvironmentStageOptions =
  DevelopmentEnvironmentDetails & {
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
    progressReporter?: ProgressReporter | undefined;
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

export async function developmentEnvironmentNotReady(
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
      branch: options.branch,
      worktreePath: options.worktreePath,
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
  const result = await runDevelopmentEnvironmentAgent({
    runner: options.runner,
    config: options.config,
    issue: options.issue,
    labels: options.labels,
    planPath: options.planPath,
    branch: options.branch,
    worktreePath: options.worktreePath,
    completedAt: options.timestamp,
    piAgentDir: options.piAgentDir,
    tokenUsageState: options.tokenUsageState,
    progressReporter: options.progressReporter,
    streamPiOutput: options.streamPiOutput,
    verbosePiOutput: options.verbosePiOutput,
    heartbeatMs: options.heartbeatMs,
    piSessionPath: options.piSessionPath,
    progress: options.progress,
    runStep: options.runStep,
    observePi: options.observePi,
  });
  if (result.kind === "not-ready")
    return {
      kind: "not-ready",
      result: await developmentEnvironmentNotReady(options, result.result),
    };
  return result;
}
