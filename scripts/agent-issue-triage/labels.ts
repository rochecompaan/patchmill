import type { LabelChangePlan, LabelDefinition, PrimaryBucket } from "./types.ts";

export const PRIMARY_BUCKETS: PrimaryBucket[] = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
];

export const REQUIRED_LABELS: LabelDefinition[] = [
  { name: "agent-ready", color: "#2ea043", description: "Ready for automated agent processing" },
  { name: "needs-info", color: "#8957e5", description: "Needs reporter information or human decision before planning" },
  { name: "agent-unsuitable", color: "#8b949e", description: "Not suitable for automated implementation" },
  { name: "in-progress", color: "#fbca04", description: "Issue is currently being processed by automation" },
  { name: "agent-done", color: "#0e8a16", description: "Issue was completed by automation" },
  { name: "blocked", color: "#d876e3", description: "Blocked by another issue or dependency" },
  { name: "bug", color: "#d73a4a", description: "Something is broken" },
  { name: "enhancement", color: "#a2eeef", description: "Feature request or improvement" },
  { name: "docs", color: "#0075ca", description: "Documentation work" },
  { name: "chore", color: "#cfd3d7", description: "Maintenance work" },
  { name: "test", color: "#bfdadc", description: "Test-only or test-focused work" },
  { name: "priority:low", color: "#8b949e", description: "Low priority" },
  { name: "priority:medium", color: "#d29922", description: "Medium priority" },
  { name: "priority:high", color: "#db6d28", description: "High priority" },
  { name: "priority:critical", color: "#cf222e", description: "Critical priority" },
];

export const ALLOWED_LABEL_NAMES = new Set(REQUIRED_LABELS.map((label) => label.name));
export const TRIAGE_ALLOWED_LABELS = REQUIRED_LABELS.filter((label) => !["in-progress", "agent-done", "blocked"].includes(label.name));
export const TRIAGE_ALLOWED_LABEL_NAMES = new Set(TRIAGE_ALLOWED_LABELS.map((label) => label.name));
export const PRIMARY_BUCKET_SET = new Set<string>(PRIMARY_BUCKETS);
export const DEFAULT_TRIAGE_EXCLUDED_LABELS = new Set<string>([...PRIMARY_BUCKETS, "in-progress", "agent-done", "blocked"]);

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
