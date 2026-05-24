import type { PatchmillLabelsConfig } from "../config/types.ts";
import type { LabelDefinition } from "../host/types.ts";

const DEFAULT_TYPE_LABELS: LabelDefinition[] = [
  { name: "bug", color: "#d73a4a", description: "Something is broken" },
  {
    name: "enhancement",
    color: "#a2eeef",
    description: "Feature request or improvement",
  },
  { name: "docs", color: "#0075ca", description: "Documentation work" },
  { name: "chore", color: "#cfd3d7", description: "Maintenance work" },
  {
    name: "test",
    color: "#bfdadc",
    description: "Test-only or test-focused work",
  },
];

const DEFAULT_PRIORITY_LABELS: LabelDefinition[] = [
  {
    name: "priority:critical",
    color: "#cf222e",
    description: "Critical priority",
  },
  { name: "priority:high", color: "#db6d28", description: "High priority" },
  { name: "priority:medium", color: "#d29922", description: "Medium priority" },
  { name: "priority:low", color: "#8b949e", description: "Low priority" },
];

const DEFAULT_TYPE_LABELS_BY_NAME = new Map(
  DEFAULT_TYPE_LABELS.map((label) => [label.name, label]),
);

const DEFAULT_PRIORITY_LABELS_BY_NAME = new Map(
  DEFAULT_PRIORITY_LABELS.map((label) => [label.name, label]),
);

function cloneLabelDefinition(label: LabelDefinition): LabelDefinition {
  return { ...label };
}

function humanizeConfiguredName(name: string): string {
  const rawName = name.split(":").at(-1)?.trim() ?? "";
  const words = rawName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`);

  return words.join(" ");
}

function configuredLabelDefinition(
  name: string,
  index: number,
  defaults: LabelDefinition[],
  defaultsByName: Map<string, LabelDefinition>,
  fallbackDescription: (humanizedName: string) => string,
): LabelDefinition {
  const defaultLabel = defaultsByName.get(name);
  if (defaultLabel) return cloneLabelDefinition(defaultLabel);

  const fallbackColor =
    defaults[Math.min(index, defaults.length - 1)]?.color ?? "#8b949e";
  const humanizedName = humanizeConfiguredName(name);

  return {
    name,
    color: fallbackColor,
    description: fallbackDescription(humanizedName),
  };
}

function typeLabelDefinition(name: string, index: number): LabelDefinition {
  return configuredLabelDefinition(
    name,
    index,
    DEFAULT_TYPE_LABELS,
    DEFAULT_TYPE_LABELS_BY_NAME,
    (humanizedName) => humanizedName || "Configured type label",
  );
}

function priorityLabelDefinition(name: string, index: number): LabelDefinition {
  return configuredLabelDefinition(
    name,
    index,
    DEFAULT_PRIORITY_LABELS,
    DEFAULT_PRIORITY_LABELS_BY_NAME,
    (humanizedName) =>
      humanizedName ? `${humanizedName} priority` : "Configured priority label",
  );
}

function typeLabels(config: PatchmillLabelsConfig): LabelDefinition[] {
  return config.types.map((name, index) => typeLabelDefinition(name, index));
}

function priorityLabels(config: PatchmillLabelsConfig): LabelDefinition[] {
  return config.priorities.map((name, index) =>
    priorityLabelDefinition(name, index),
  );
}

export function requiredLabels(
  config: PatchmillLabelsConfig,
): LabelDefinition[] {
  return [
    {
      name: config.ready,
      color: "#2ea043",
      description: "Ready for automated agent processing",
    },
    {
      name: config.needsInfo,
      color: "#8957e5",
      description:
        "Needs reporter information or human decision before planning",
    },
    {
      name: config.unsuitable,
      color: "#8b949e",
      description: "Not suitable for automated implementation",
    },
    {
      name: config.inProgress,
      color: "#fbca04",
      description: "Issue is currently being processed by automation",
    },
    {
      name: config.done,
      color: "#0e8a16",
      description: "Issue was completed by automation",
    },
    {
      name: config.blocked,
      color: "#d876e3",
      description: "Blocked by another issue or dependency",
    },
    ...typeLabels(config),
    ...priorityLabels(config),
  ];
}

export function automationProtectionLabels(
  config: PatchmillLabelsConfig,
): Set<string> {
  return new Set([
    config.ready,
    config.needsInfo,
    config.unsuitable,
    config.inProgress,
    config.done,
    config.blocked,
  ]);
}
