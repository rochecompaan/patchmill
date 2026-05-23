import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import {
  automationProtectionLabels,
  requiredLabels,
} from "../../src/policy/labels.ts";
import type { LabelChangePlan, LabelDefinition, PrimaryBucket } from "./types.ts";

const DEFAULT_LABELS = DEFAULT_PATCHMILL_CONFIG.labels;

function asPrimaryBucket(label: string): PrimaryBucket {
  if (label !== "agent-ready" && label !== "needs-info" && label !== "agent-unsuitable") {
    throw new Error(`Default primary bucket drifted from PrimaryBucket type: ${label}`);
  }

  return label;
}

export const PRIMARY_BUCKETS: PrimaryBucket[] = [
  asPrimaryBucket(DEFAULT_LABELS.ready),
  asPrimaryBucket(DEFAULT_LABELS.needsInfo),
  asPrimaryBucket(DEFAULT_LABELS.unsuitable),
];

export const REQUIRED_LABELS: LabelDefinition[] = requiredLabels(DEFAULT_LABELS);

export const ALLOWED_LABEL_NAMES = new Set(REQUIRED_LABELS.map((label) => label.name));
export const PRIMARY_BUCKET_SET = new Set<string>(PRIMARY_BUCKETS);
const AUTOMATION_PROTECTION_LABELS = automationProtectionLabels(DEFAULT_LABELS);
export const TRIAGE_ALLOWED_LABELS = REQUIRED_LABELS.filter(
  (label) => !AUTOMATION_PROTECTION_LABELS.has(label.name) || PRIMARY_BUCKET_SET.has(label.name),
);
export const TRIAGE_ALLOWED_LABEL_NAMES = new Set(TRIAGE_ALLOWED_LABELS.map((label) => label.name));
export const DEFAULT_TRIAGE_EXCLUDED_LABELS = new Set<string>(AUTOMATION_PROTECTION_LABELS);

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniquePreserved(values: string[]): string[] {
  return [...new Set(values)];
}

export function missingLabelDefinitions(existingNames: string[]): LabelDefinition[] {
  const existing = new Set(existingNames);
  return REQUIRED_LABELS.filter((label) => !existing.has(label.name));
}

export function planLabelChange(issueNumber: number, oldLabels: string[], newLabels: string[]): LabelChangePlan {
  const oldSet = new Set(oldLabels);
  const newSet = new Set(newLabels);
  return {
    issueNumber,
    oldLabels: uniqueSorted(oldLabels),
    newLabels: uniqueSorted(newLabels),
    addLabels: uniquePreserved(newLabels.filter((label) => !oldSet.has(label))),
    removeLabels: uniquePreserved(oldLabels.filter((label) => !newSet.has(label))),
  };
}
