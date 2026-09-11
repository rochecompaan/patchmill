import type { PullRequestBodyHostProvider } from "../../../host/types.ts";
import {
  upsertPlanningRunCostSection,
  upsertRunCostSection,
} from "./pr-cost-summary.ts";
import { assertImplementationClosingReference } from "../../../workflow/planning-implementation-body.ts";
import { parsePlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import type { RunCostReport } from "./run-cost.ts";
export async function publishPlanningPrRunCost(options: {
  host: PullRequestBodyHostProvider;
  prUrl: string;
  report: RunCostReport;
  marker: string;
  issueNumber: number;
}): Promise<"updated" | "unchanged"> {
  const body = await options.host.readPullRequestBody(options.prUrl);
  const next = upsertPlanningRunCostSection(
    body,
    options.report,
    options.marker,
  );
  if (parsePlanningPullRequestMarker(next) === undefined)
    throw new Error("Planning marker is invalid after cost publication");
  assertImplementationClosingReference(next, options.issueNumber);
  if (next === body) return "unchanged";
  await options.host.updatePullRequestBody(options.prUrl, next);
  return "updated";
}

export async function publishPrRunCost(options: {
  host: PullRequestBodyHostProvider;
  prUrl: string;
  report: RunCostReport;
}): Promise<"updated" | "unchanged"> {
  const body = await options.host.readPullRequestBody(options.prUrl);
  const next = upsertRunCostSection(body, options.report);
  if (next === body) return "unchanged";
  await options.host.updatePullRequestBody(options.prUrl, next);
  return "updated";
}
