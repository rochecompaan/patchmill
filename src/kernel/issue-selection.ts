import type { LabelsConfig } from "../config/config.ts";
import type { Host, Issue } from "../host/types.ts";

export function selectIssue(
  issues: Issue[],
  labels: LabelsConfig,
  explicit?: number,
): Issue | undefined {
  const eligible = issues.filter((i) => i.state === "open");
  if (explicit !== undefined)
    return eligible.find((i) => i.number === explicit);
  return eligible
    .filter(
      (i) =>
        i.labels.includes(labels.ready) || i.labels.includes(labels.inProgress),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
}

export async function listRunIssues(
  host: Host,
  issue?: number,
): Promise<Issue[]> {
  return issue === undefined
    ? host.listOpenIssues()
    : [await host.viewIssue(issue)];
}
