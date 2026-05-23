import { labelForPrimaryBucket, type PatchmillTriagePolicy } from "../../src/policy/triage.ts";
import {
  DEFAULT_TRIAGE_POLICY,
  primaryBucketLabelMap,
  primaryBucketLabels,
  primaryBucketSet,
  triageAllowedLabelNames,
} from "./labels.ts";
import type { Confidence, IssueSummary, PrimaryBucket, RawTriageDecision, RawTriageDocument, TriageQuestion, TriageDecision } from "./types.ts";

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value.trim();
}

function asStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value.map((entry, index) => asString(entry, `${context}[${index}]`));
}

function asQuestion(value: unknown, context: string): TriageQuestion {
  if (typeof value === "string") return asString(value, context);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a non-empty string or include question and recommendedAnswer`);
  }
  const record = value as Record<string, unknown>;
  return {
    question: asString(record.question, `${context}.question`),
    recommendedAnswer: asString(record.recommendedAnswer, `${context}.recommendedAnswer`),
  };
}

function asQuestions(value: unknown, context: string): TriageQuestion[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value.map((entry, index) => asQuestion(entry, `${context}[${index}]`));
}

function asComment(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, "comment");
}

function validateOne(
  raw: RawTriageDecision,
  issueNumbers: Set<number>,
  triagePolicy: PatchmillTriagePolicy,
): TriageDecision {
  const issueNumber = raw.issueNumber;
  if (!Number.isInteger(issueNumber) || Number(issueNumber) <= 0) {
    throw new Error("issueNumber must be a positive integer");
  }
  if (!issueNumbers.has(Number(issueNumber))) {
    throw new Error(`Unknown issue number ${issueNumber}`);
  }

  const primaryBuckets = primaryBucketSet(triagePolicy);
  const bucketLabelsByStatus = primaryBucketLabelMap(triagePolicy);
  const bucketLabelNames = primaryBucketLabels(triagePolicy);
  const allowedLabelNames = triageAllowedLabelNames(triagePolicy);
  const readyLabel = labelForPrimaryBucket(triagePolicy, "agent-ready");
  const primaryBucket = asString(raw.primaryBucket, "primaryBucket");
  if (!primaryBuckets.has(primaryBucket)) {
    throw new Error(`Invalid primaryBucket ${primaryBucket}`);
  }

  const labels = asStringArray(raw.labels, `labels for issue ${issueNumber}`);
  for (const label of labels) {
    if (!allowedLabelNames.has(label)) {
      if (label === triagePolicy.labels.inProgress) {
        throw new Error(`${triagePolicy.labels.inProgress} is not allowed in triage decisions`);
      }
      throw new Error(`Unknown label ${label}`);
    }
  }

  const hasAgentReady = labels.includes(readyLabel);
  if (primaryBucket === "agent-ready" && !hasAgentReady) {
    throw new Error(`${primaryBucket} requires ${readyLabel}`);
  }
  if (primaryBucket !== "agent-ready" && hasAgentReady) {
    throw new Error(`${readyLabel} is only allowed for the agent-ready bucket`);
  }

  const requiredBucketLabel = bucketLabelsByStatus.get(primaryBucket as PrimaryBucket);
  if (!requiredBucketLabel) throw new Error(`Missing primary bucket label for ${primaryBucket}`);
  const bucketLabels = labels.filter((label) => bucketLabelNames.has(label));
  if (bucketLabels.length !== 1 || bucketLabels[0] !== requiredBucketLabel) {
    throw new Error(`Issue ${issueNumber} must include exactly its primary bucket label ${requiredBucketLabel}`);
  }

  const confidence = asString(raw.confidence, "confidence");
  if (!triagePolicy.confidenceValues.includes(confidence as Confidence)) {
    throw new Error(`Invalid confidence ${confidence}`);
  }

  const rationale = asString(raw.rationale, `rationale for issue ${issueNumber}`);
  const questions = asQuestions(raw.questions, `questions for issue ${issueNumber}`);
  if (primaryBucket === "needs-info" && questions.length === 0) {
    throw new Error(`${primaryBucket} requires at least one question`);
  }

  return {
    issueNumber: Number(issueNumber),
    primaryBucket: primaryBucket as PrimaryBucket,
    labels: [...new Set(labels)],
    confidence: confidence as Confidence,
    rationale,
    questions,
    comment: asComment(raw.comment),
  };
}

export function validateTriageDocument(
  document: RawTriageDocument,
  issues: IssueSummary[],
  triagePolicy: PatchmillTriagePolicy = DEFAULT_TRIAGE_POLICY,
): TriageDecision[] {
  const record = asRecord(document, "triage document");
  if (!Array.isArray(record.decisions)) throw new Error("decisions must be an array");
  if (record.decisions.length !== issues.length) {
    throw new Error(`Expected ${issues.length} decisions but received ${record.decisions.length}`);
  }

  const issueNumbers = new Set(issues.map((issue) => issue.number));
  const seen = new Set<number>();
  const decisions = record.decisions.map((entry, index) => {
    const decision = validateOne(
      asRecord(entry, `decisions[${index}]`) as RawTriageDecision,
      issueNumbers,
      triagePolicy,
    );
    if (seen.has(decision.issueNumber)) throw new Error(`Duplicate decision for issue ${decision.issueNumber}`);
    seen.add(decision.issueNumber);
    return decision;
  });

  return decisions.sort((a, b) => a.issueNumber - b.issueNumber);
}
