import type { LabelsConfig } from "../config/config.ts";
import type { Host, LabelDefinition } from "../host/types.ts";

export function labelCatalog(labels: LabelsConfig): LabelDefinition[] {
  return [
    {
      name: labels.ready,
      color: "#2ea043",
      description: "Suitable for automated agent processing",
    },
    {
      name: labels.inProgress,
      color: "#fbca04",
      description: "Issue is currently being processed by automation",
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
