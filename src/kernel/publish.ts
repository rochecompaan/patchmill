import { errorMessage } from "./errors.ts";
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
  question?: string;
};

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
  try {
    return await workflow.setStatus(issue, {
      status: stop.label,
      runId: current.runId,
      summary: stop.summary,
      cost,
      warnings: stop.warnings,
      ...(stop.question !== undefined ? { question: stop.question } : {}),
    });
  } catch (error) {
    return [errorMessage(error)];
  }
}
