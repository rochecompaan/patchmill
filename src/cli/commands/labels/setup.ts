import type {
  IssueHostProvider,
  LabelDefinition,
} from "../../../host/types.ts";
import type { PatchmillTriagePolicy } from "../../../policy/triage.ts";
import { missingLabelDefinitions } from "../triage/labels.ts";

export type LabelSetupResult = {
  status: "satisfied" | "created" | "skipped" | "failed";
  message: string;
  missingCount: number;
  createdCount: number;
};

export type LabelSetupOptions = {
  host: IssueHostProvider;
  policy: PatchmillTriagePolicy;
  extraLabels?: readonly LabelDefinition[];
  prompt?: (question: string) => Promise<string>;
  isInteractive: boolean;
  assumeYes: boolean;
  command: "init" | "doctor";
};

function isYes(value: string): boolean {
  return /^(y|yes)$/iu.test(value.trim());
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return count === 1 ? singular : pluralValue;
}

function labelLine(label: LabelDefinition): string {
  return `  ${label.name} — ${label.description}`;
}

function reviewMessage(host: IssueHostProvider, missing: LabelDefinition[]) {
  return [
    `Patchmill needs these labels on ${host.displayName}:`,
    ...missing.map(labelLine),
  ].join("\n");
}

function editAndFixGuidance(command: LabelSetupOptions["command"]): string {
  const timing = command === "init" ? " after init" : "";
  return [
    `You can edit label names in patchmill.config.json${timing}, then run:`,
    "  patchmill doctor --fix",
  ].join("\n");
}

function skippedMessage(
  host: IssueHostProvider,
  missing: LabelDefinition[],
  command: LabelSetupOptions["command"],
): string {
  return [
    reviewMessage(host, missing),
    "",
    "Skipped label creation.",
    editAndFixGuidance(command),
  ].join("\n");
}

async function createMissingLabels(
  host: IssueHostProvider,
  missing: LabelDefinition[],
): Promise<
  | { status: "created"; createdCount: number }
  | {
      status: "failed";
      createdCount: number;
      failedLabel: string;
      error: string;
    }
> {
  let createdCount = 0;
  for (const label of missing) {
    try {
      await host.createLabel(label);
      createdCount += 1;
    } catch (error) {
      return {
        status: "failed",
        createdCount,
        failedLabel: label.name,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { status: "created", createdCount };
}

export async function ensureRequiredLabels(
  options: LabelSetupOptions,
): Promise<LabelSetupResult> {
  const missing = missingLabelDefinitions(
    await options.host.listLabels(),
    options.policy,
    options.extraLabels,
  );

  if (missing.length === 0) {
    return {
      status: "satisfied",
      missingCount: 0,
      createdCount: 0,
      message: "Required labels already exist.",
    };
  }

  const review = reviewMessage(options.host, missing);
  const approved = options.assumeYes
    ? true
    : options.isInteractive && options.prompt
      ? isYes(
          await options.prompt(`${review}\n\nCreate these labels now? [y/N] `),
        )
      : false;

  if (!approved) {
    return {
      status: "skipped",
      missingCount: missing.length,
      createdCount: 0,
      message: skippedMessage(options.host, missing, options.command),
    };
  }

  const creation = await createMissingLabels(options.host, missing);
  if (creation.status === "failed") {
    return {
      status: "failed",
      missingCount: missing.length,
      createdCount: creation.createdCount,
      message: [
        review,
        "",
        `Failed to create label ${creation.failedLabel}: ${creation.error}`,
        `${creation.createdCount} ${plural(creation.createdCount, "label")} created before failure.`,
        "Run `patchmill doctor` to verify label setup after fixing the error.",
      ].join("\n"),
    };
  }

  return {
    status: "created",
    missingCount: missing.length,
    createdCount: creation.createdCount,
    message: [
      review,
      "",
      `Created ${creation.createdCount} ${plural(creation.createdCount, "label")}.`,
    ].join("\n"),
  };
}
