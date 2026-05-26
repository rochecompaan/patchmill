import {
  canonicalBucketForLabels,
  type PatchmillTriageStateMap,
} from "../../../policy/triage-state.ts";
import type {
  IssueSummary,
  TriageLogIssueEntry,
  TriagePreview,
} from "./types.ts";

function issueByNumber(issues: IssueSummary[]): Map<number, IssueSummary> {
  return new Map(issues.map((issue) => [issue.number, issue]));
}

function commentBody(comment: unknown): string | undefined {
  if (typeof comment === "string") return comment;
  if (comment && typeof comment === "object" && "body" in comment) {
    const body = (comment as Record<string, unknown>).body;
    if (typeof body === "string") return body;
  }
  return undefined;
}

function commentBodies(issue: IssueSummary): string[] {
  return (issue.comments ?? [])
    .map(commentBody)
    .filter((body): body is string => Boolean(body));
}

function addedComments(before: IssueSummary, after: IssueSummary): string[] {
  const remaining = [...commentBodies(before)];
  const added: string[] = [];

  for (const body of commentBodies(after)) {
    const existingIndex = remaining.indexOf(body);
    if (existingIndex >= 0) {
      remaining.splice(existingIndex, 1);
    } else {
      added.push(body);
    }
  }

  return added;
}

export function extractNeedsInfoFollowUps(comment: string): string[] {
  const listMarkerPattern = /^(?:[-*]|\d+[.)])\s+/u;
  const lines = comment
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const questions = lines.flatMap((line) => {
    const stripped = line.replace(listMarkerPattern, "").trim();
    if (stripped.endsWith("?")) return [stripped];
    if (listMarkerPattern.test(line)) return [stripped];
    return [];
  });

  return questions.length > 0 ? questions : [comment.trim()].filter(Boolean);
}

export function createPreviewEntries(
  issues: IssueSummary[],
  previews: TriagePreview[],
): TriageLogIssueEntry[] {
  const issuesByNumber = issueByNumber(issues);
  return previews.map((preview) => {
    const issue = issuesByNumber.get(preview.issueNumber);
    if (!issue)
      throw new Error(`No issue found for preview #${preview.issueNumber}`);
    return {
      issueNumber: preview.issueNumber,
      title: issue.title,
      previousLabels: issue.labels,
      finalLabels: preview.proposedLabels,
      primaryBucket: preview.canonicalBucket,
      rationale: preview.rationale,
      questions: preview.questions,
      comment: preview.wouldComment,
      wouldClose: preview.wouldClose,
      mutationStatus: "preview",
    };
  });
}

export function createObservedChangeEntries(
  beforeIssues: IssueSummary[],
  afterIssues: IssueSummary[],
  stateMap: PatchmillTriageStateMap,
): TriageLogIssueEntry[] {
  const afterByNumber = issueByNumber(afterIssues);
  return beforeIssues.map((before) => {
    const after = afterByNumber.get(before.number);
    if (!after) {
      throw new Error(`Missing after snapshot for issue #${before.number}`);
    }
    const newComments = addedComments(before, after);
    const primaryBucket = canonicalBucketForLabels(after.labels, stateMap);
    const questions =
      primaryBucket === "needs-info"
        ? newComments.flatMap(extractNeedsInfoFollowUps)
        : [];

    return {
      issueNumber: before.number,
      title: after.title || before.title,
      previousLabels: before.labels,
      finalLabels: after.labels,
      ...(primaryBucket ? { primaryBucket } : {}),
      questions,
      comment: newComments[0] ?? null,
      ...(newComments.length > 0 ? { addedComments: newComments } : {}),
      previousState: before.state,
      finalState: after.state,
      mutationStatus: "observed",
    };
  });
}
