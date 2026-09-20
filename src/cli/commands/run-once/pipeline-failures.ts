import type { AgentIssueBlockedResult } from "../../../issue-run/types.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import type { IssueHostProvider } from "../../../host/types.ts";
import { planLabelChange } from "../triage/labels.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { readRunState, writeRunState } from "./run-state.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueRunCheckpoints,
} from "./types.ts";
import {
  blockerComment,
  blockerCommentKey,
  errorMessage,
  unexpectedFailureComment,
  unexpectedFailureCommentKey,
} from "./pipeline-comments.ts";
import { lifecycleLabels, nextLabels } from "./pipeline-lifecycle.ts";
import { formatErrorWithCauses } from "./pi-errors.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import {
  emitSimpleStep,
  progress,
  withLogPath,
  type PipelineProgressOptions,
} from "./pipeline-progress.ts";

type FailureDetails = {
  specPath?: string | undefined;
  specCommit?: string | undefined;
  planPath?: string | undefined;
  planCommit?: string | undefined;
  branch?: string | undefined;
  worktreePath?: string | undefined;
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
  const formatted = formatErrorWithCauses(error);
  const status =
    checkpoints.worktreeReady || checkpoints.implementationCompleted
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
      publicFailure: runOnceFailure("unexpected-error", {
        issueNumber: issue.number,
        status: "blocked",
        error: formatted.message,
        ...(formatted.causes ? { causes: formatted.causes } : {}),
        ...(options.logPath ? { logPath: options.logPath } : {}),
      }),
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
  const commentKey = blockerCommentKey(result);
  const persisted = await readRunState(config.runStateDir, issue.number);
  if (!persisted?.blockerCommentKeys?.includes(commentKey)) {
    const commented = await host
      .commentIssue(issue.number, blockerComment(result))
      .then(() => true)
      .catch(() => false);
    if (commented)
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          title: issue.title,
          status: "blocked",
          blockerCommentKeys: [commentKey],
        },
        timestamp,
      );
  }
  await emitSimpleStep(options, issue.number, "final result blocked");
  return withLogPath(
    {
      ...result,
      publicFailure: runOnceFailure("agent-blocked", {
        issueNumber: issue.number,
        status: "blocked",
        ...(details.branch ? { branch: details.branch } : {}),
        ...(details.worktreePath ? { worktreePath: details.worktreePath } : {}),
        reportedReason: result.reason,
        questions: result.questions.map(blockerQuestionText),
        evidence: result.validation,
      }),
      ...details,
      issue,
    },
    options,
  );
}

export function blockerQuestionText(
  question: import("../../../issue-run/types.ts").AgentIssueBlockerQuestion,
): string {
  return typeof question === "string"
    ? question
    : question.recommendedAnswer
      ? `${question.question} (recommended: ${question.recommendedAnswer})`
      : question.question;
}
