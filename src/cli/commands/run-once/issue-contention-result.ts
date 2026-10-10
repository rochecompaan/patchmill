import type { IssueSummary } from "../../../issue/types.ts";
import type { AgentIssuePipelineResult } from "./types.ts";
import { IssueRunLeaseConflictError } from "./recovery-lease.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
/** Only demonstrably live contention is the normal no-repair stop. */
export function liveIssueContentionResult(
  issue: IssueSummary,
  error: unknown,
): AgentIssuePipelineResult | undefined {
  if (
    !(error instanceof IssueRunLeaseConflictError) ||
    !error.owner ||
    !error.liveOwner
  )
    return undefined;
  return {
    status: "stopped",
    issue,
    reason: "issue-locked",
    publicFailure: runOnceFailure("issue-locked", {
      issueNumber: issue.number,
      status: "stopped",
      lockPath: error.leasePath,
      fingerprint: "",
      resource: "common-lease",
      owner: {
        issueNumber: error.owner.issueNumber,
        runId: error.owner.ownerToken,
        pid: error.owner.pid,
        hostname: error.owner.hostname,
        acquiredAt: error.owner.acquiredAt,
      },
    }),
  };
}
