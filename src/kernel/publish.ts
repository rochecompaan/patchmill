import { join } from "node:path";
import type { Facts } from "./facts.ts";
import type { CostRun } from "./issue-cost.ts";
import { costLine, sumSessionUsage } from "./pi-cost.ts";
import { publishIssueCost } from "./pr-cost.ts";
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

/** Publish the current attempt's cost before its stop, including before review. */
export async function publishAttemptStop(input: {
  host: Host;
  labels: LabelsConfig;
  issue: number;
  issueDir: string;
  current: CostRun;
  facts?: Facts;
  stop: Omit<StopPublication, "cost">;
}): Promise<string[]> {
  const { host, labels, issue, issueDir, current, facts, stop } = input;
  const cost = costLine(
    await sumSessionUsage(join(issueDir, current.runId, "sessions")),
  );
  if (facts?.pullRequest) {
    try {
      await publishIssueCost({
        host,
        branch: facts.branch,
        baseBranch: facts.baseBranch,
        issueDir,
        current,
      });
    } catch (error) {
      stop.warnings.push(`PR cost report unavailable: ${errorMessage(error)}`);
    }
  }
  return publishStop(host, labels, issue, { ...stop, cost });
}
