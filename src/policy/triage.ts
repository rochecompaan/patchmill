import type { PatchmillLabelsConfig } from "../config/types.ts";
import type { LabelDefinition } from "../host/types.ts";
import { automationProtectionLabels, requiredLabels } from "./labels.ts";

export type PatchmillTriagePrimaryBucketStatus =
  | "agent-ready"
  | "needs-info"
  | "agent-unsuitable";

export type PatchmillTriageConfidence = "low" | "medium" | "high";

export type PatchmillTriageNeedsInfoCommentBehavior = "generated-from-rationale-and-questions";

export type PatchmillTriagePrimaryBucket = {
  status: PatchmillTriagePrimaryBucketStatus;
  label: string;
};

export type PatchmillTriagePolicy = {
  labels: {
    ready: string;
    needsInfo: string;
    unsuitable: string;
    inProgress: string;
    done: string;
    blocked: string;
    types: string[];
    priorities: string[];
  };
  primaryBuckets: PatchmillTriagePrimaryBucket[];
  allowedLabels: LabelDefinition[];
  triageAllowedLabels: LabelDefinition[];
  excludedLabels: string[];
  confidenceValues: PatchmillTriageConfidence[];
  ambiguityRuleText: string;
  needsInfo: {
    commentBehavior: PatchmillTriageNeedsInfoCommentBehavior;
  };
  runOnceSelection: {
    readyLabel: string;
    excludedLabels: string[];
    priorityOrder: string[];
  };
};

const PRIMARY_BUCKET_STATUS_ORDER: PatchmillTriagePrimaryBucketStatus[] = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
];

const CONFIDENCE_VALUES: PatchmillTriageConfidence[] = ["low", "medium", "high"];

const AMBIGUITY_RULE_TEXT = [
  "Any ambiguity in issue intent, feature behavior, expected user experience, architecture, scope, or acceptance criteria must be classified as needs-info.",
  "Missing factual reporter information should also be needs-info with actionable questions.",
  "Clear work that is suitable for agent automation should be classified as agent-ready because the downstream agent workflow always creates a plan before implementation.",
].join(" ");

export function createTriagePolicy(config: PatchmillLabelsConfig): PatchmillTriagePolicy {
  const labels = {
    ready: config.ready,
    needsInfo: config.needsInfo,
    unsuitable: config.unsuitable,
    inProgress: config.inProgress,
    done: config.done,
    blocked: config.blocked,
    types: [...config.types],
    priorities: [...config.priorities],
  };
  const primaryBuckets: PatchmillTriagePrimaryBucket[] = [
    { status: "agent-ready", label: config.ready },
    { status: "needs-info", label: config.needsInfo },
    { status: "agent-unsuitable", label: config.unsuitable },
  ];
  const allowedLabels = requiredLabels(config);
  const excludedLabels = [...automationProtectionLabels(config)];
  const primaryBucketLabels = new Set(primaryBuckets.map((bucket) => bucket.label));
  const excludedLabelSet = new Set(excludedLabels);
  const triageAllowedLabels = allowedLabels.filter(
    (label) => !excludedLabelSet.has(label.name) || primaryBucketLabels.has(label.name),
  );

  return {
    labels,
    primaryBuckets,
    allowedLabels,
    triageAllowedLabels,
    excludedLabels,
    confidenceValues: [...CONFIDENCE_VALUES],
    ambiguityRuleText: AMBIGUITY_RULE_TEXT,
    needsInfo: {
      commentBehavior: "generated-from-rationale-and-questions",
    },
    runOnceSelection: {
      readyLabel: config.ready,
      excludedLabels: excludedLabels.filter((label) => label !== config.ready),
      priorityOrder: [...config.priorities],
    },
  };
}

export function labelForPrimaryBucket(
  policy: PatchmillTriagePolicy,
  status: PatchmillTriagePrimaryBucketStatus,
): string {
  const bucket = policy.primaryBuckets.find((candidate) => candidate.status === status);
  if (!bucket) throw new Error(`Missing primary bucket policy for ${status}`);
  return bucket.label;
}

export function primaryBucketStatuses(policy: PatchmillTriagePolicy): PatchmillTriagePrimaryBucketStatus[] {
  return PRIMARY_BUCKET_STATUS_ORDER.filter((status) =>
    policy.primaryBuckets.some((bucket) => bucket.status === status)
  );
}
