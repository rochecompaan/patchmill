import type { LabelsConfig } from "../config/config.ts";
import type { Host } from "../host/types.ts";
import { KERNEL_COMMENT } from "./comments.ts";
import { releaseSwap } from "./labels.ts";
import type { OutcomeLabel } from "./verify.ts";

export type StopPublication = {
  label: OutcomeLabel;
  summary: string;
  cost: string;
  warnings: string[];
  /** Extra labels to remove, such as `done` when a review wait fails. */
  remove?: string[];
};

/** Swaps labels and posts the one kernel comment. Returns publication errors. */
export async function publishStop(
  host: Host,
  labels: LabelsConfig,
  issue: number,
  stop: StopPublication,
): Promise<string[]> {
  const publicationErrors: string[] = [];
  const publish = async (failure: string, effect: () => Promise<void>) => {
    try {
      await effect();
    } catch (error) {
      publicationErrors.push(`${failure}: ${errorMessage(error)}`);
    }
  };
  const release = releaseSwap(labels, stop.label);
  release.remove.push(...(stop.remove ?? []));
  await publish("Label update failed", () =>
    host.setLabels(issue, release.add, release.remove),
  );
  await publish("Comment failed", () =>
    host.commentIssue(
      issue,
      [
        KERNEL_COMMENT,
        `Issue #${issue}: ${labels[stop.label]}`,
        stop.summary,
        stop.cost,
        ...stop.warnings,
        ...publicationErrors,
      ].join("\n\n"),
    ),
  );
  return publicationErrors;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
