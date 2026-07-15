import type {
  AgentIssueBlockedResult,
  AgentIssueBlockerQuestion,
  AgentIssuePiResult,
  IssueSelectionRejection,
  IssueSummary,
} from "./types.ts";

export function startedComment(issue: IssueSummary): string {
  return `Automation started for issue #${issue.number}.\n\nThe issue has been claimed for plan and implementation orchestration.`;
}

export function handoffComment(
  planPath: string,
  result: Extract<AgentIssuePiResult, { status: "pr-created" | "merged" }>,
  baseBranch: string,
): string {
  const lines = [
    `Automation handoff ready.`,
    ``,
    `- Plan: \`${planPath}\``,
    `- Branch: \`${result.branch}\``,
  ];
  if (result.status === "pr-created") lines.push(`- PR: ${result.prUrl}`);
  else lines.push(`- Merged to \`${baseBranch}\`: ${result.mergeCommit}`);
  if (result.landingDecision)
    lines.push(`- Landing decision: ${result.landingDecision}`);
  if (result.reviewSummary) lines.push(`- Review: ${result.reviewSummary}`);
  if (result.validation.length > 0) {
    lines.push(`- Validation:`);
    lines.push(...result.validation.map((entry) => `  - ${entry}`));
  }
  return lines.join("\n");
}

export function questionText(question: AgentIssueBlockerQuestion): string {
  return typeof question === "string"
    ? `- ${question}`
    : `- ${question.question}${question.recommendedAnswer ? `\n  Recommended: ${question.recommendedAnswer}` : ""}`;
}

export function blockerComment(result: AgentIssueBlockedResult): string {
  return [
    `Automation blocked and needs more information.`,
    ``,
    result.reason,
    ...(result.questions.length > 0
      ? ["", "Questions:", ...result.questions.map(questionText)]
      : []),
  ].join("\n");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function rejectionMessage(
  reason: IssueSelectionRejection["reason"],
): string {
  if (reason === "blocking-labels") return "blocking labels";
  if (reason === "non-open-state") return "non-open state";
  if (reason === "waiting-spec-approval") return "waiting for spec approval";
  if (reason === "waiting-plan-approval") return "waiting for plan approval";
  return "no actionable workflow state";
}

export function unexpectedFailureComment(
  reason: string,
  inProgressLabel: string,
): string {
  return [
    `Automation failed unexpectedly and remains ${inProgressLabel}.`,
    ``,
    reason,
    ``,
    `A human should inspect the run logs before re-running or relabeling this issue.`,
  ].join("\n");
}

export function unexpectedFailureCommentKey(
  status: "claimed" | "planning" | "implementing",
): string {
  return `unexpected-failure:${status}`;
}
