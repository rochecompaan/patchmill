import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import {
  createTriagePolicy,
  primaryBucketStatuses,
  type PatchmillTriagePolicy,
} from "../../src/policy/triage.ts";
import type {
  LabelChangePlan,
  LabelDefinition,
  PrimaryBucket,
} from "./types.ts";

export const DEFAULT_TRIAGE_POLICY = createTriagePolicy(
  DEFAULT_PATCHMILL_CONFIG.labels,
);

export const PRIMARY_BUCKETS: PrimaryBucket[] = primaryBucketStatuses(
  DEFAULT_TRIAGE_POLICY,
);

export const REQUIRED_LABELS: LabelDefinition[] =
  DEFAULT_TRIAGE_POLICY.allowedLabels;

export const ALLOWED_LABEL_NAMES = new Set(
  REQUIRED_LABELS.map((label) => label.name),
);
export const PRIMARY_BUCKET_SET = new Set<string>(PRIMARY_BUCKETS);
export const TRIAGE_ALLOWED_LABELS = DEFAULT_TRIAGE_POLICY.triageAllowedLabels;
export const TRIAGE_ALLOWED_LABEL_NAMES = new Set(
  TRIAGE_ALLOWED_LABELS.map((label) => label.name),
);
export const DEFAULT_TRIAGE_EXCLUDED_LABELS = new Set<string>(
  DEFAULT_TRIAGE_POLICY.excludedLabels,
);

export function primaryBucketSet(policy: PatchmillTriagePolicy): Set<string> {
  return new Set(policy.primaryBuckets.map((bucket) => bucket.status));
}

export function primaryBucketLabelMap(
  policy: PatchmillTriagePolicy,
): Map<PrimaryBucket, string> {
  return new Map(
    policy.primaryBuckets.map((bucket) => [bucket.status, bucket.label]),
  );
}

export function primaryBucketLabels(
  policy: PatchmillTriagePolicy,
): Set<string> {
  return new Set(policy.primaryBuckets.map((bucket) => bucket.label));
}

export function triageAllowedLabelNames(
  policy: PatchmillTriagePolicy,
): Set<string> {
  return new Set(policy.triageAllowedLabels.map((label) => label.name));
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniquePreserved(values: string[]): string[] {
  return [...new Set(values)];
}

export function missingLabelDefinitions(
  existingNames: string[],
  triagePolicy: PatchmillTriagePolicy = DEFAULT_TRIAGE_POLICY,
): LabelDefinition[] {
  const existing = new Set(existingNames);
  return triagePolicy.allowedLabels.filter(
    (label) => !existing.has(label.name),
  );
}

export function planLabelChange(
  issueNumber: number,
  oldLabels: string[],
  newLabels: string[],
): LabelChangePlan {
  const oldSet = new Set(oldLabels);
  const newSet = new Set(newLabels);
  return {
    issueNumber,
    oldLabels: uniqueSorted(oldLabels),
    newLabels: uniqueSorted(newLabels),
    addLabels: uniquePreserved(newLabels.filter((label) => !oldSet.has(label))),
    removeLabels: uniquePreserved(
      oldLabels.filter((label) => !newSet.has(label)),
    ),
  };
}
