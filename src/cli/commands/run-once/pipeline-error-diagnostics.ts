import { PlanningWorkspaceConflictError } from "../../../git/planning-workspaces.ts";
import { formatErrorWithCauses } from "./pi-errors.ts";
import { RunRecoveryRefusalError } from "./pipeline-recovery.ts";
import { IssueRunLeaseConflictError } from "./recovery-lease.ts";
import {
  runOnceFailure,
  type AnyRunOnceFailure,
} from "./result-diagnostics.ts";

type PublicLeaseOwner = {
  pid: number;
  hostname: string;
  acquiredAt: string;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled Run recovery refusal: ${JSON.stringify(value)}`);
}

function publicLeaseOwner(owner: {
  pid: number;
  hostname: string;
  acquiredAt: string;
}): PublicLeaseOwner {
  return {
    pid: owner.pid,
    hostname: owner.hostname,
    acquiredAt: owner.acquiredAt,
  };
}

/** Converts already-observed pipeline errors into bounded public diagnostics without I/O. */
export function failureForPipelineError(
  error: unknown,
  logPath?: string,
): AnyRunOnceFailure {
  if (error instanceof IssueRunLeaseConflictError)
    return runOnceFailure("active-run", {
      issueNumber: error.issueNumber,
      status: "error",
      resource: error.resource,
      leasePath: error.leasePath,
      ...(error.owner ? { owner: publicLeaseOwner(error.owner) } : {}),
      guidance: ["Wait for affected runners to stop before lease repair."],
    });
  if (error instanceof RunRecoveryRefusalError) {
    const { decision } = error;
    if (decision.reason === "active-run")
      return runOnceFailure("active-run", {
        ...(decision.owner ? { issueNumber: decision.owner.issueNumber } : {}),
        status: "error",
        resource: decision.resource,
        leasePath: decision.leasePath,
        ...(decision.owner ? { owner: publicLeaseOwner(decision.owner) } : {}),
        guidance: decision.guidance,
      });
    const assessment = decision.assessment;
    const workspace = {
      issueNumber: assessment.issueNumber,
      status: "error",
      branch: assessment.expectedWorkspace.branch,
      worktreePath: assessment.expectedWorkspace.worktreePath,
      runStatePath: assessment.runStatePath,
    };
    switch (decision.reason) {
      case "dirty-worktree":
        return runOnceFailure("dirty-worktree", {
          ...workspace,
          ...(assessment.worktree.dirtyStatus
            ? { dirtyStatus: assessment.worktree.dirtyStatus }
            : {}),
          guidance: decision.guidance,
        });
      case "unmerged-commits":
        return runOnceFailure("unmerged-commits", {
          ...workspace,
          commits: assessment.actualUniqueCommits,
          guidance: decision.guidance,
        });
      case "workspace-unverifiable":
        return runOnceFailure("workspace-unverifiable", {
          ...workspace,
          savedWorkspace: Object.entries(assessment.savedWorkspace).map(
            ([key, value]) => `${key}=${value ?? ""}`,
          ),
          expectedWorkspace: Object.entries(assessment.expectedWorkspace).map(
            ([key, value]) => `${key}=${value}`,
          ),
          guidance: decision.guidance,
        });
      case "legacy-active-unfenced":
        return runOnceFailure("legacy-active-unfenced", {
          issueNumber: assessment.issueNumber,
          status: "error",
          runStatePath: assessment.runStatePath,
          guidance: decision.guidance,
        });
      case "not-blocked":
        return runOnceFailure("not-blocked", {
          issueNumber: assessment.issueNumber,
          status: "error",
          runStatePath: assessment.runStatePath,
          observedStatus: assessment.status,
          guidance: decision.guidance,
        });
      case "ignored-worktree-content":
        return runOnceFailure("ignored-worktree-content", {
          ...workspace,
          ignoredPaths: assessment.worktree.ignoredEntries,
          blockedAction: decision.blockedAction,
          guidance: decision.guidance,
        });
      default:
        return assertNever(decision);
    }
  }
  if (error instanceof PlanningWorkspaceConflictError)
    return runOnceFailure("planning-workspace-conflict", {
      conflictReason: error.reason,
      branch: error.identity.branch,
      worktreePath: error.identity.worktreePath,
    });
  const formatted = formatErrorWithCauses(error);
  return runOnceFailure("unexpected-error", {
    error: formatted.message,
    ...(formatted.causes ? { causes: formatted.causes } : {}),
    ...(logPath ? { logPath } : {}),
  });
}
