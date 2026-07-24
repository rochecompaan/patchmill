import type { PullRequestBodyHostProvider } from "../../../host/types.ts";
import { upsertRunCostSection } from "./pr-cost-summary.ts";
import type { RunCostReport } from "./run-cost.ts";
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
