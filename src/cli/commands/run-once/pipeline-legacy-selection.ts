import type { IssueSummary } from "../../../issue/types.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import type { AgentIssueConfig } from "./types.ts";
import { loadSelectionIssues } from "./pipeline-selection.ts";

export async function loadLegacyPipelineSelectionIssues(
  host: RunOnceHostProvider,
  config: AgentIssueConfig,
  options: Parameters<typeof loadSelectionIssues>[2] & {
    leasedIssueNumber?: number | undefined;
  },
): Promise<IssueSummary[]> {
  if (options.leasedIssueNumber === undefined) {
    return loadSelectionIssues(host, config, options);
  }

  const issue = await host.viewIssue(options.leasedIssueNumber);
  return config.issueState?.provider === "comments"
    ? host.hydrateIssueComments([issue])
    : [issue];
}
