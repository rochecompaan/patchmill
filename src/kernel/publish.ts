import { join } from "node:path";
import type { Facts } from "./facts.ts";
import type { CostRun } from "./issue-cost.ts";
import { costLine, sumSessionUsage } from "./pi-cost.ts";
import { publishIssueCost } from "./pr-cost.ts";
import type { Host } from "../host/types.ts";
import type { WorkflowState } from "./workflow-state.ts";
import type { OutcomeLabel } from "./verify.ts";

export type StopPublication = {
  label: OutcomeLabel;
  summary: string;
  cost: string;
  warnings: string[];
  ask?: boolean;
};

/** Record the stop, returning required-write errors and optional-comment warnings. */
export async function publishStop(
  workflow: WorkflowState,
  issue: number,
  runId: string,
  stop: StopPublication,
): Promise<string[]> {
  try {
    return await workflow.setStatus(issue, {
      status: stop.label,
      runId,
      summary: stop.summary,
      cost: stop.cost,
      warnings: stop.warnings,
      ...(stop.ask !== undefined ? { ask: stop.ask } : {}),
    });
  } catch (error) {
    return [errorMessage(error)];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Publish the current attempt's cost before its stop, including before review. */
export async function publishAttemptStop(input: {
  host: Host;
  workflow: WorkflowState;
  issue: number;
  issueDir: string;
  current: CostRun;
  facts?: Facts;
  stop: Omit<StopPublication, "cost">;
}): Promise<string[]> {
  const { host, workflow, issue, issueDir, current, facts, stop } = input;
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
  return publishStop(workflow, issue, current.runId, { ...stop, cost });
}
