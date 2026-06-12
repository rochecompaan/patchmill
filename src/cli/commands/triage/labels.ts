import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import {
  createPatchmillLabelCatalog,
  type PatchmillLabelCatalog,
} from "../../../policy/label-catalog.ts";
import type { LabelChangePlan } from "./types.ts";

export const DEFAULT_LABEL_CATALOG = createPatchmillLabelCatalog(
  DEFAULT_PATCHMILL_CONFIG,
);

export const DEFAULT_TRIAGE_POLICY = DEFAULT_LABEL_CATALOG.triagePolicy;

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniquePreserved(values: string[]): string[] {
  return [...new Set(values)];
}

export function missingLabelDefinitions(
  existingNames: string[],
  labelCatalog: PatchmillLabelCatalog = DEFAULT_LABEL_CATALOG,
): PatchmillLabelCatalog["labelDefinitions"] {
  const existing = new Set(existingNames);
  return labelCatalog.labelDefinitions.filter(
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
