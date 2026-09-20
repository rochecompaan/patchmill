import type { AgentIssueBlockedResult } from "../../../issue-run/types.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import {
  runOnceFailure,
  type AnyRunOnceFailure,
  type ImplementationDiagnosticReasonCode,
  type RunOnceDiagnosticContextByReason,
  type RunOnceFailure,
} from "./result-diagnostics.ts";
import type { AgentIssueInternalBlockedResult } from "./types.ts";

type ImplementationDiagnosticBase = {
  issueNumber: number;
  status: "blocked";
  phase: "implementation";
  branch: string;
  worktreePath: string;
};

export function implementationDiagnosticBase(
  state: PlanningStateV1,
  phase: Extract<PlanningStateV1["phases"][number], { kind: "implementation" }>,
): ImplementationDiagnosticBase {
  return {
    issueNumber: state.issueNumber,
    status: "blocked",
    phase: "implementation",
    branch: phase.workspace.identity.branch,
    worktreePath: phase.workspace.identity.worktreePath,
  };
}

type ImplementationDiagnosticDetails<
  R extends ImplementationDiagnosticReasonCode,
> = Omit<
  RunOnceDiagnosticContextByReason[R],
  keyof ImplementationDiagnosticBase
>;

/** Materializes implementation evidence already observed by the workflow. */
export function implementationFailure<
  R extends ImplementationDiagnosticReasonCode,
>(
  base: ImplementationDiagnosticBase,
  reason: R,
  details: ImplementationDiagnosticDetails<R>,
): RunOnceFailure<R> {
  return runOnceFailure(reason, {
    ...base,
    ...details,
  } as RunOnceDiagnosticContextByReason[R]);
}

export function unsafeWorkspaceEvidence(input: {
  workspace: {
    state: "ready" | "missing" | "branch-only";
    clean?: boolean;
    headOid?: string;
  };
  reason: "not-ready" | "dirty" | "not-descendant";
}) {
  return {
    workspaceState: input.workspace.state,
    workspaceRecoveryReason: input.reason,
    ...(input.workspace.state === "ready"
      ? { statusEvidence: input.workspace.clean ? "clean" : "dirty" }
      : {}),
    ...(input.workspace.state === "missing"
      ? {}
      : { observedHeadOid: input.workspace.headOid }),
  };
}

export function implementationBlocked(
  reason: string,
  publicFailure: AnyRunOnceFailure,
): AgentIssueInternalBlockedResult {
  return {
    status: "blocked",
    reason,
    publicFailure,
    questions: [],
    commits: [],
    validation: [],
  };
}

export function blockedAgentWorkspaceFailure(input: {
  base: ImplementationDiagnosticBase;
  expectedHeadOid: string;
  evidence: ReturnType<typeof unsafeWorkspaceEvidence>;
  result: AgentIssueBlockedResult;
}): RunOnceFailure<"agent-blocked"> {
  return runOnceFailure("agent-blocked", {
    ...input.base,
    expectedHeadOid: input.expectedHeadOid,
    ...input.evidence,
    reportedReason: input.result.reason,
    questions: input.result.questions.map((question) =>
      typeof question === "string"
        ? question
        : question.recommendedAnswer
          ? `${question.question} (recommended: ${question.recommendedAnswer})`
          : question.question,
    ),
    evidence: input.result.validation,
  });
}
