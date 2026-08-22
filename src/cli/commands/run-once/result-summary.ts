import { formatErrorWithCauses } from "./pi-errors.ts";
import type {
  AgentIssuePipelineResult,
  AgentIssueVisualEvidence,
} from "./types.ts";

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
        reviewSummary?: string;
        landingDecision?: string;
        visualEvidence?: AgentIssueVisualEvidence[];
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
        reviewSummary?: string;
        landingDecision?: string;
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
        reason: string;
        evidence: string[];
        remediation: string[];
      }
    | {
        status: "blocked";
        issueNumber: number;
        reason: string;
        questions: string[];
      }
  );

export type RunOnceResultSummary =
  | RunOncePipelineResultSummary
  | { status: "error"; error: string; causes?: string[]; logPath?: string };
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
        reason: result.reason,
        evidence: result.evidence,
        remediation: result.remediation,
        ...withLogPath,
      };
    case "blocked":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        reason: result.reason,
        questions: result.questions.map(questionText),
        ...withLogPath,
      };
  }
}

export function summarizeErrorResult(
  error: unknown,
  logPath?: string,
): Extract<RunOnceResultSummary, { status: "error" }> {
  const formatted = formatErrorWithCauses(error);
  return {
    status: "error",
    error: formatted.message,
    ...(formatted.causes ? { causes: formatted.causes } : {}),
    ...(logPath ? { logPath } : {}),
  };
}
