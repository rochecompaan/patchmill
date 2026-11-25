import {
  blockerNote,
  type TrackedIssue,
  type WorkflowState,
} from "./workflow-state.ts";
import type { Host } from "../host/types.ts";
import type { FactsResult } from "./facts.ts";
import { derivedStop } from "./interactive-loop.ts";
import { derivePhase } from "./phase.ts";

export type RunIssueSelection =
  | { kind: "selected"; issue: TrackedIssue }
  | { kind: "none" }
  | { kind: "refused"; issue: number; reason: string };

/**
 * The issue that runs next. Automatic selection takes the oldest open Ready or
 * In Progress issue that has no open dependency and does not wait on an open
 * Planning pull request. `readFacts` must be read-only; selection calls it
 * only in automatic selection, after the dependency check passes.
 */
export async function selectRunIssue(input: {
  host: Host;
  workflow: WorkflowState;
  issue?: number;
  readFacts: (issue: TrackedIssue) => Promise<FactsResult>;
  warn: (issue: number, message: string) => void;
}): Promise<RunIssueSelection> {
  const { host, workflow, issue: explicit, readFacts, warn } = input;
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
      if (!open.length) {
        if (explicit !== undefined) return { kind: "selected", issue };
        const pullRequest = await waitingPullRequest(host, readFacts, issue);
        if (pullRequest === undefined) return { kind: "selected", issue };
        warn(
          issue.number,
          `planning pull request #${pullRequest} is waiting for review; skipping it.`,
        );
        continue;
      }
      let repository: string | undefined;
      if (explicit !== undefined) {
        try {
          const { owner, repo } = await host.repository();
          repository = `${owner}/${repo}`.toLowerCase();
        } catch {
          // Repository lookup is best effort; still refuse blocked work.
        }
      }
      const blockers = await Promise.all(
        open.map(async (dependency) => {
          let note = "";
          if (repository === dependency.repository.toLowerCase()) {
            try {
              note = blockerNote(
                (await workflow.issue(dependency.number)).status,
              );
            } catch {
              // Status lookup must not hide the blocker or prevent refusal.
            }
          }
          return `${dependency.repository}#${dependency.number}${note}`;
        }),
      );
      reason = `Issue #${issue.number} is blocked by: ${blockers.join(", ")}.`;
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

/**
 * The number of the open Planning pull request that the issue waits on, from
 * the run's own decision. Unreadable facts are not a wait, so the run reports
 * them.
 */
async function waitingPullRequest(
  host: Host,
  readFacts: (issue: TrackedIssue) => Promise<FactsResult>,
  issue: TrackedIssue,
): Promise<number | undefined> {
  try {
    const result = await readFacts(issue);
    if (result.kind !== "facts") return undefined;
    const { facts } = result;
    const derived = derivePhase(facts);
    if (derived.kind !== "stop" || derived.label !== "inProgress")
      return undefined;
    if (facts.pullRequest?.state !== "open") return undefined;
    const stop = derivedStop(
      facts,
      issue.number,
      await host.repository(),
      "inProgress",
    );
    return stop.label === "inProgress" ? facts.pullRequest.number : undefined;
  } catch {
    return undefined;
  }
}
