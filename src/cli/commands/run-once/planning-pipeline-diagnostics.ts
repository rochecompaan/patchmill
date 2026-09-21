import type { PlanningIssueLockConflictError } from "../../../workflow/planning-issue-lock.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import { blockerQuestionText } from "./pipeline-failures.ts";
import {
  runOnceFailure,
  type AnyRunOnceFailure,
} from "./result-diagnostics.ts";
import type { AgentIssueInternalBlockedResult } from "./types.ts";

/** Builds planning diagnostic envelopes from facts already observed by orchestration. */
export function planningIdentityFailure(input: {
  expected: readonly string[];
  observed: readonly string[];
}) {
  return runOnceFailure("planning-identity-changed", {
    expectedIdentity: input.expected,
    observedIdentity: input.observed,
  });
}

export function planningLockFailure(
  issue: IssueSummary,
  diagnostic: PlanningIssueLockConflictError["diagnostic"],
) {
  const context = {
    issueNumber: issue.number,
    status: "blocked" as const,
    lockPath: diagnostic.path,
    fingerprint: diagnostic.fingerprint,
    ...(diagnostic.owner ? { owner: diagnostic.owner } : {}),
  };
  switch (diagnostic.classification) {
    case "active":
      return runOnceFailure("issue-locked", context);
    case "stale":
      return runOnceFailure("issue-lock-stale", context);
    case "unverifiable":
      return runOnceFailure("issue-lock-unverifiable", context);
    case "malformed":
      return runOnceFailure("issue-lock-malformed", context);
  }
}

export function publicFailureForBlocked(
  issue: IssueSummary,
  result: AgentIssueInternalBlockedResult,
  paths: { branch?: string; worktreePath?: string } = {},
) {
  return (
    result.publicFailure ??
    runOnceFailure("agent-blocked", {
      issueNumber: issue.number,
      status: "blocked",
      ...(paths.branch ? { branch: paths.branch } : {}),
      ...(paths.worktreePath ? { worktreePath: paths.worktreePath } : {}),
      reportedReason: result.reason,
      questions: result.questions.map(blockerQuestionText),
      evidence: result.validation,
    })
  );
}

export function statePaths(state: PlanningStateV1) {
  const implementation = state.phases.find(
    (phase) => phase.kind === "implementation",
  );
  const artifacts = state.phases.flatMap((phase) =>
    "artifacts" in phase ? phase.artifacts : [],
  );
  const workspace =
    implementation && "workspace" in implementation
      ? implementation.workspace
      : undefined;
  return {
    ...(artifacts.find((artifact) => artifact.kind === "spec")
      ? {
          specPath: artifacts.find((artifact) => artifact.kind === "spec")!
            .path,
        }
      : {}),
    ...(artifacts.find((artifact) => artifact.kind === "plan")
      ? {
          planPath: artifacts.find((artifact) => artifact.kind === "plan")!
            .path,
        }
      : {}),
    ...(workspace === undefined
      ? {}
      : {
          branch: workspace.identity.branch,
          worktreePath: workspace.identity.worktreePath,
        }),
  };
}

export function planningBlocked(
  issue: IssueSummary,
  reason: string,
  publicFailure: AnyRunOnceFailure,
) {
  return {
    status: "blocked" as const,
    issue,
    result: {
      status: "blocked" as const,
      reason,
      publicFailure,
      questions: [],
      commits: [],
      validation: [],
    },
  };
}
