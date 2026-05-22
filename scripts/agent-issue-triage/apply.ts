import { applyIssueLabels, commentIssue } from "./forgejo.ts";
import { planLabelChange } from "./labels.ts";
import type { CommandRunner, TriageQuestion, IssueSummary, TriageDecision, TriageLogIssueEntry } from "./types.ts";

export class ApplyDecisionError extends Error {
  readonly issueNumber: number;
  readonly operation: "labels" | "comment";

  constructor(issueNumber: number, operation: "labels" | "comment", cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to apply ${operation} for issue #${issueNumber}: ${causeMessage}`, { cause });
    this.name = "ApplyDecisionError";
    this.issueNumber = issueNumber;
    this.operation = operation;
  }
}

function issueMap(issues: IssueSummary[]): Map<number, IssueSummary> {
  return new Map(issues.map((issue) => [issue.number, issue]));
}

function formatQuestion(question: TriageQuestion, index: number): string {
  if (typeof question === "string") return `${index + 1}. ${question}`;
  return `${index + 1}. ${question.question}\n   Recommended answer: ${question.recommendedAnswer}`;
}

function hasRecommendedAnswers(questions: TriageQuestion[]): boolean {
  return questions.some((question) => typeof question !== "string");
}

export function buildNeedsInfoComment(decision: TriageDecision): string {
  const questions = decision.questions.map(formatQuestion).join("\n");
  const header = "Automated triage needs more information before this can be planned:";
  if (!hasRecommendedAnswers(decision.questions)) return `${header}\n\n${questions}`;

  return `${header}\n\nRationale:\n${decision.rationale}\n\nFollow-up questions and recommended answers:\n${questions}`;
}

function commentForDecision(decision: TriageDecision): string | null {
  if (decision.primaryBucket === "needs-info") return buildNeedsInfoComment(decision);
  return decision.comment;
}

export function createLogEntries(
  issues: IssueSummary[],
  decisions: TriageDecision[],
  status: "planned" | "applied" | "failed",
  errorByIssue = new Map<number, string>(),
): TriageLogIssueEntry[] {
  const issuesByNumber = issueMap(issues);

  return decisions.map((decision) => {
    const issue = issuesByNumber.get(decision.issueNumber);
    if (!issue) throw new Error(`No issue found for decision #${decision.issueNumber}`);

    const error = errorByIssue.get(decision.issueNumber);
    return {
      issueNumber: decision.issueNumber,
      title: issue.title,
      previousLabels: issue.labels,
      finalLabels: decision.labels,
      primaryBucket: decision.primaryBucket,
      confidence: decision.confidence,
      rationale: decision.rationale,
      questions: decision.questions,
      comment: commentForDecision(decision),
      mutationStatus: error ? "failed" : status,
      ...(error ? { error } : {}),
    };
  });
}

export async function applyDecisions(
  runner: CommandRunner,
  repoRoot: string,
  issues: IssueSummary[],
  decisions: TriageDecision[],
  teaLogin?: string,
): Promise<void> {
  const issuesByNumber = issueMap(issues);

  for (const decision of decisions) {
    const issue = issuesByNumber.get(decision.issueNumber);
    if (!issue) throw new Error(`No issue found for decision #${decision.issueNumber}`);

    try {
      await applyIssueLabels(runner, repoRoot, planLabelChange(issue.number, issue.labels, decision.labels), teaLogin);
    } catch (error) {
      throw new ApplyDecisionError(issue.number, "labels", error);
    }

    const comment = commentForDecision(decision);
    if (!comment) continue;

    try {
      await commentIssue(runner, repoRoot, issue.number, comment, teaLogin);
    } catch (error) {
      throw new ApplyDecisionError(issue.number, "comment", error);
    }
  }
}
