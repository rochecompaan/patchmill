import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import type { LabelChangePlan, LabelDefinition } from "./types.ts";

export const DEFAULT_TRIAGE_POLICY = createTriagePolicy(
  DEFAULT_PATCHMILL_CONFIG.labels,
  DEFAULT_PATCHMILL_CONFIG.triage,
);

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniquePreserved(values: string[]): string[] {
  return [...new Set(values)];
}

export function missingLabelDefinitions(
  existingNames: string[],
  triagePolicy = DEFAULT_TRIAGE_POLICY,
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
