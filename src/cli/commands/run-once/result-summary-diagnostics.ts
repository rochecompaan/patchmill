import {
  diagnosticFor,
  type RunOnceDiagnostic,
  type RunOnceDiagnosticContextByReason,
  type RunOnceReasonCode,
} from "./result-diagnostics.ts";
export type RunOnceReasonSummary = {
  reason: RunOnceReasonCode;
  diagnostic: RunOnceDiagnostic;
};
export function summarizeFailure<R extends RunOnceReasonCode>(
  reason: R,
  diagnosticContext: RunOnceDiagnosticContextByReason[R],
): RunOnceReasonSummary & { reason: R } {
  return { reason, diagnostic: diagnosticFor(reason, diagnosticContext) };
}
export function workspaceContext(input: {
  issueNumber: number;
  phase?: "spec" | "plan" | "implementation";
  branch?: string;
  worktreePath?: string;
  status?: string;
}) {
  return {
    issueNumber: input.issueNumber,
    ...(input.status ? { status: input.status } : {}),
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
  };
}
