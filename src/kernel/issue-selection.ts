import type { TrackedIssue, WorkflowState } from "./workflow-state.ts";
import type { Host } from "../host/types.ts";

export type RunIssueSelection =
  | { kind: "selected"; issue: TrackedIssue }
  | { kind: "none" }
  | { kind: "refused"; issue: number; reason: string };

export async function selectRunIssue(input: {
  host: Host;
  workflow: WorkflowState;
  issue?: number;
  warn: (issue: number, message: string) => void;
}): Promise<RunIssueSelection> {
  const { host, workflow, issue: explicit, warn } = input;
  let issues: TrackedIssue[];
  try {
    issues =
      explicit === undefined
        ? await workflow.openIssues()
        : [await workflow.issue(explicit)];
  } catch (error) {
    if (explicit === undefined) throw error;
    return { kind: "refused", issue: explicit, reason: String(error) };
  }
  const candidates =
    explicit === undefined
      ? issues
          .filter(
            (issue) =>
              issue.state === "open" &&
              (issue.status === "ready" || issue.status === "inProgress"),
          )
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      : issues.filter(
          (issue) => issue.state === "open" && issue.number === explicit,
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
