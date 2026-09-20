import type { AgentIssueVisualEvidence } from "../../../issue-run/types.ts";
import { formatErrorWithCauses } from "./pi-errors.ts";
import type { AgentIssuePipelineResult } from "./types.ts";
import type {
  RunOnceDiagnostic,
  RunOnceReasonCode,
} from "./result-diagnostics.ts";
import {
  summarizeFailure,
  workspaceContext,
} from "./result-summary-diagnostics.ts";
import { failureForPipelineError } from "./pipeline-error-diagnostics.ts";

export type RunOnceResultLog = { logPath?: string; piSessionPath?: string };

export type RunOncePipelineResultSummary = RunOnceResultLog &
  (
    | { status: "no-issue" }
    | {
        status: "dry-run";
        issueNumber: number;
        title: string;
        transition: string;
      }
    | {
        status: "spec-created" | "spec-found";
        issueNumber: number;
        specPath: string;
      }
    | {
        status: "plan-created" | "plan-found";
        issueNumber: number;
        specPath?: string;
        planPath: string;
      }
    | {
        status: "pr-created";
        issueNumber: number;
        specPath?: string;
        planPath: string;
        branch: string;
        prUrl: string;
        worktreePath: string;
        commits: string[];
        validation: string[];
        reviewSummary?: string | undefined;
        landingDecision?: string | undefined;
        visualEvidence?: AgentIssueVisualEvidence[] | undefined;
      }
    | {
        status: "merged";
        issueNumber: number;
        specPath?: string;
        planPath: string;
        branch: string;
        mergeCommit: string;
        worktreePath: string;
        commits: string[];
        validation: string[];
        reviewSummary?: string | undefined;
        landingDecision?: string | undefined;
      }
    | {
        status: "cleanup-pending";
        issueNumber: number;
        phase: "spec" | "plan" | "implementation";
        prUrl: string;
        branch: string;
        worktreePath: string;
        reason: "ignored-worktree-content";
        ignoredPaths: string[];
        remediation: string[];
        specPath?: string;
        planPath?: string;
        commits?: string[];
        validation?: string[];
        diagnostic: RunOnceDiagnostic;
      }
    | {
        status: "review-pending";
        issueNumber: number;
        phase: "spec" | "plan";
        prUrl: string;
      }
    | {
        status: "stopped";
        issueNumber: number;
        reason: RunOnceReasonCode;
        nextPhase?: "implementation";
        specPath?: string;
        planPath?: string;
        branch?: string;
        worktreePath?: string;
        diagnostic: RunOnceDiagnostic;
      }
    | {
        status: "approval-required";
        issueNumber: number;
        approvalKind: "spec" | "plan";
        missingLabel: string;
      }
    | {
        status: "development-environment-not-ready";
        issueNumber: number;
        specPath?: string;
        planPath: string;
        branch?: string;
        worktreePath?: string;
        reason: "development-environment-not-ready";
        evidence: string[];
        remediation: string[];
        diagnostic: RunOnceDiagnostic;
      }
    | {
        status: "blocked";
        issueNumber: number;
        reason: RunOnceReasonCode;
        questions: string[];
        diagnostic: RunOnceDiagnostic;
      }
  );

export type RunOnceResultSummary =
  | RunOncePipelineResultSummary
  | {
      status: "error";
      error: string;
      causes?: string[];
      logPath?: string;
      reason: RunOnceReasonCode;
      diagnostic: RunOnceDiagnostic;
    };
export type RunOnceResultStatus = RunOnceResultSummary["status"];

function questionText(
  question: string | { question: string; recommendedAnswer?: string },
): string {
  return typeof question === "string"
    ? question
    : question.recommendedAnswer
      ? `${question.question} (recommended: ${question.recommendedAnswer})`
      : question.question;
}

export function summarizeResult(
  result: AgentIssuePipelineResult,
): RunOncePipelineResultSummary {
  const withLogPath = {
    ...(result.logPath ? { logPath: result.logPath } : {}),
    ...(result.piSessionPath ? { piSessionPath: result.piSessionPath } : {}),
  };
  switch (result.status) {
    case "no-issue":
      return { status: result.status, ...withLogPath };
    case "dry-run":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        title: result.issue.title,
        transition: result.transition,
        ...withLogPath,
      };
    case "spec-created":
    case "spec-found":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        specPath: result.specPath,
        ...withLogPath,
      };
    case "plan-created":
    case "plan-found":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        ...(result.specPath !== undefined ? { specPath: result.specPath } : {}),
        planPath: result.planPath,
        ...withLogPath,
      };
    case "pr-created":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        ...(result.specPath !== undefined ? { specPath: result.specPath } : {}),
        planPath: result.planPath,
        branch: result.branch,
        prUrl: result.prUrl,
        worktreePath: result.worktreePath,
        commits: result.commits,
        validation: result.validation,
        reviewSummary: result.reviewSummary,
        landingDecision: result.landingDecision,
        visualEvidence: result.visualEvidence,
        ...withLogPath,
      };
    case "merged":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        ...(result.specPath !== undefined ? { specPath: result.specPath } : {}),
        planPath: result.planPath,
        branch: result.branch,
        mergeCommit: result.mergeCommit,
        worktreePath: result.worktreePath,
        commits: result.commits,
        validation: result.validation,
        reviewSummary: result.reviewSummary,
        landingDecision: result.landingDecision,
        ...withLogPath,
      };
    case "cleanup-pending":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        phase: result.phase,
        prUrl: result.prUrl,
        branch: result.branch,
        worktreePath: result.worktreePath,
        ignoredPaths: [...result.ignoredPaths],
        remediation: [...result.remediation],
        ...(result.specPath === undefined ? {} : { specPath: result.specPath }),
        ...(result.planPath === undefined ? {} : { planPath: result.planPath }),
        ...(result.commits === undefined
          ? {}
          : { commits: [...result.commits] }),
        ...(result.validation === undefined
          ? {}
          : { validation: [...result.validation] }),
        ...summarizeFailure(
          result.publicFailure.reason,
          result.publicFailure.diagnosticContext,
        ),
        ...withLogPath,
      };
    case "review-pending":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        phase: result.phase,
        prUrl: result.prUrl,
        ...withLogPath,
      };
    case "stopped":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        ...(result.nextPhase !== undefined
          ? { nextPhase: result.nextPhase }
          : {}),
        ...(result.specPath !== undefined ? { specPath: result.specPath } : {}),
        ...(result.planPath !== undefined ? { planPath: result.planPath } : {}),
        ...(result.branch !== undefined ? { branch: result.branch } : {}),
        ...(result.worktreePath !== undefined
          ? { worktreePath: result.worktreePath }
          : {}),
        ...summarizeFailure(
          result.publicFailure.reason,
          result.publicFailure.diagnosticContext,
        ),
        ...withLogPath,
      };
    case "approval-required":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        approvalKind: result.approvalKind,
        missingLabel: result.missingLabel,
        ...withLogPath,
      };
    case "development-environment-not-ready":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        ...(result.specPath !== undefined ? { specPath: result.specPath } : {}),
        planPath: result.planPath,
        ...(result.branch !== undefined ? { branch: result.branch } : {}),
        ...(result.worktreePath !== undefined
          ? { worktreePath: result.worktreePath }
          : {}),
        evidence: result.evidence,
        remediation: result.remediation,
        ...summarizeFailure("development-environment-not-ready", {
          ...workspaceContext({
            issueNumber: result.issue.number,
            ...(result.branch ? { branch: result.branch } : {}),
            ...(result.worktreePath
              ? { worktreePath: result.worktreePath }
              : {}),
            status: result.status,
          }),
          reportedReason: result.reason,
          evidence: result.evidence,
          reportedRemediation: result.remediation,
        }),
        ...withLogPath,
      };
    case "blocked":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        questions: result.questions.map(questionText),
        ...summarizeFailure(
          result.publicFailure.reason,
          result.publicFailure.diagnosticContext,
        ),
        ...withLogPath,
      };
  }
}

export function summarizeErrorResult(
  error: unknown,
  logPath?: string,
): Extract<RunOnceResultSummary, { status: "error" }> {
  const formatted = formatErrorWithCauses(error);
  const failure = failureForPipelineError(error, logPath);
  return {
    status: "error",
    error: formatted.message,
    ...(formatted.causes ? { causes: formatted.causes } : {}),
    ...(logPath ? { logPath } : {}),
    ...summarizeFailure(failure.reason, failure.diagnosticContext as never),
  };
}
