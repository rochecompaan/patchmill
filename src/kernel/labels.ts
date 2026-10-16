import type { LabelsConfig } from "../config/config.ts";
import type { Host, LabelDefinition } from "../host/types.ts";
import type { OutcomeLabel } from "./verify.ts";

export function labelCatalog(labels: LabelsConfig): LabelDefinition[] {
  return [
    {
      name: labels.ready,
      color: "#2ea043",
      description: "Ready for automated agent processing",
    },
    {
      name: labels.inProgress,
      color: "#fbca04",
      description: "Issue is currently being processed by automation",
    },
    {
      name: labels.specReview,
      color: "#5319e7",
      description: "Awaiting specification review",
    },
    {
      name: labels.specApproved,
      color: "#0e8a16",
      description: "Specification approved for automation",
    },
    {
      name: labels.needsInfo,
      color: "#8957e5",
      description:
        "Needs reporter information or human decision before planning",
    },
    {
      name: labels.done,
      color: "#0e8a16",
      description: "Issue was completed by automation",
    },
    {
      name: labels.unsuitable,
      color: "#8b949e",
      description: "Not suitable for automated implementation",
    },
    {
      name: labels.blocked,
      color: "#d876e3",
      description: "Blocked by another issue or dependency",
    },
  ];
}

export async function ensureLabels(
  host: Host,
  labels: LabelsConfig,
): Promise<string[]> {
  const existing = new Set(await host.listLabels());
  const created: string[] = [];
  for (const label of labelCatalog(labels)) {
    if (existing.has(label.name)) continue;
    await host.createLabel(label);
    existing.add(label.name);
    created.push(label.name);
  }
  return created;
}

export function claimSwap(labels: LabelsConfig): {
  add: string[];
  remove: string[];
} {
  return {
    add: [labels.inProgress],
    remove: [labels.ready, labels.specReview, labels.needsInfo],
  };
}

export function releaseSwap(
  labels: LabelsConfig,
  outcome: OutcomeLabel,
): { add: string[]; remove: string[] } {
  return { add: [labels[outcome]], remove: [labels.inProgress] };
}
