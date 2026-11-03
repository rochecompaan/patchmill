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

export type RunIssueSelection =
  | { kind: "selected"; issue: Issue }
  | { kind: "none" }
  | { kind: "refused"; issue: number; reason: string };

export async function selectRunIssue(input: {
  host: Host;
  labels: LabelsConfig;
  issue?: number;
  warn: (issue: number, message: string) => void;
}): Promise<RunIssueSelection> {
  const { host, labels, issue: explicit, warn } = input;
  let issues: Issue[];
  try {
    issues = await listRunIssues(host, explicit);
  } catch (error) {
    if (explicit === undefined) throw error;
    return { kind: "refused", issue: explicit, reason: String(error) };
  }
  const candidates =
    explicit === undefined
      ? issues
          .filter((issue) => selectIssue([issue], labels) !== undefined)
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      : [selectIssue(issues, labels, explicit)].filter(
          (issue) => issue !== undefined,
        );
  for (const issue of candidates) {
    let reason: string;
    try {
      const open = (await host.listIssueDependencies(issue.number)).filter(
        (dependency) => dependency.state === "open",
      );
      if (!open.length) return { kind: "selected", issue };
      reason = `Issue #${issue.number} is blocked by: ${open.map((dependency) => `${dependency.repository}#${dependency.number}`).join(", ")}.`;
    } catch (error) {
      reason = `Cannot read dependencies for issue #${issue.number}: ${error instanceof Error ? error.message : String(error)}`;
      warn(issue.number, reason);
    }
    if (explicit !== undefined)
      return { kind: "refused", issue: explicit, reason };
  }
  return explicit === undefined
    ? { kind: "none" }
    : {
        kind: "refused",
        issue: explicit,
        reason: "Issue is missing or closed.",
      };
}

export async function listRunIssues(
  host: Host,
  issue?: number,
): Promise<Issue[]> {
  return issue === undefined
    ? host.listOpenIssues()
    : [await host.viewIssue(issue)];
}
