import type { IssueHostProvider } from "../../../host/types.ts";
import { planLabelChange } from "../triage/labels.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { readRunState, writeRunState } from "./run-state.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueRunCheckpoints,
  IssueSummary,
} from "./types.ts";
import {
  blockerComment,
  errorMessage,
  unexpectedFailureComment,
  unexpectedFailureCommentKey,
} from "./pipeline-comments.ts";
import { lifecycleLabels, nextLabels } from "./pipeline-lifecycle.ts";
import {
  emitSimpleStep,
  progress,
  withLogPath,
  type PipelineProgressOptions,
} from "./pipeline-progress.ts";

type FailureDetails = {
  specPath?: string;
  specCommit?: string;
  planPath?: string;
  planCommit?: string;
  branch?: string;
  worktreePath?: string;
};

export async function unexpectedFailure(
  host: IssueHostProvider,
  config: AgentIssueConfig,
  issue: IssueSummary,
  checkpoints: AgentIssueRunCheckpoints,
  details: FailureDetails,
  timestamp: string,
  error: unknown,
  options: PipelineProgressOptions,
): Promise<AgentIssuePipelineResult> {
  const reason = errorMessage(error);
  const status =
    details.branch ||
    details.worktreePath ||
    checkpoints.worktreeReady ||
    checkpoints.implementationCompleted
      ? "implementing"
      : details.specPath ||
          details.specCommit ||
          checkpoints.specPathResolved ||
          checkpoints.specCreated ||
          checkpoints.specReadyCommentPosted ||
          details.planPath ||
          details.planCommit ||
          checkpoints.planPathResolved ||
          checkpoints.planCreated ||
          checkpoints.planReadyCommentPosted ||
          checkpoints.readyLabelRestored
        ? "planning"
        : "claimed";
  await progress(options, "error", "blocked", `blocked: ${reason}`, {
    issueNumber: issue.number,
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status,
      specPath: details.specPath,
      specCommit: details.specCommit,
      planPath: details.planPath,
      planCommit: details.planCommit,
      branch: details.branch,
      worktreePath: details.worktreePath,
      lastError: reason,
    },
    timestamp,
  );
  const state = await readRunState(config.runStateDir, issue.number);
  const failureCommentKey = unexpectedFailureCommentKey(status);
  if (!state?.failureCommentKeys?.includes(failureCommentKey)) {
    const { inProgress } = lifecycleLabels(config);
    const commented = await host
      .commentIssue(issue.number, unexpectedFailureComment(reason, inProgress))
      .then(() => true)
      .catch(() => false);
    if (commented) {
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status,
          specPath: details.specPath,
          specCommit: details.specCommit,
          planPath: details.planPath,
          planCommit: details.planCommit,
          branch: details.branch,
          worktreePath: details.worktreePath,
          failureCommentKeys: [failureCommentKey],
        },
        timestamp,
      );
    }
  }
  await emitSimpleStep(options, issue.number, "final result blocked");
  return withLogPath(
    {
      status: "blocked",
      reason,
      questions: [],
      commits: [],
      validation: [],
      ...details,
      issue,
    },
    options,
  );
}

export async function blockIssue(
  host: IssueHostProvider,
  config: AgentIssueConfig,
  issue: IssueSummary,
  labels: string[],
  result: AgentIssueBlockedResult,
  details: FailureDetails,
  timestamp: string,
  options: PipelineProgressOptions,
): Promise<AgentIssuePipelineResult> {
  const { inProgress, needsInfo } = lifecycleLabels(config);
  await progress(options, "error", "blocked", `blocked: ${result.reason}`, {
    issueNumber: issue.number,
  });
  const blockedLabels = nextLabels(labels, [inProgress], [needsInfo]);
  await ensureAutomationLabel(host, config, needsInfo);
  await host.applyLabels(planLabelChange(issue.number, labels, blockedLabels));
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status: "blocked",
      specPath: details.specPath,
      specCommit: details.specCommit,
      planPath: details.planPath,
      planCommit: details.planCommit,
      branch: details.branch,
      worktreePath: details.worktreePath,
      lastError: result.reason,
      commits: result.commits,
      validation: result.validation,
      blockerQuestions: result.questions,
    },
    timestamp,
  );
  await host
    .commentIssue(issue.number, blockerComment(result))
    .catch(() => undefined);
  await emitSimpleStep(options, issue.number, "final result blocked");
  return withLogPath({ ...result, ...details, issue }, options);
}
