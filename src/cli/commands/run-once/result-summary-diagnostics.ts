import {
  diagnosticFor,
  type RunOnceDiagnostic,
  type RunOnceReasonCode,
  type RunOnceFailure,
} from "./result-diagnostics.ts";
export type RunOnceReasonSummary = {
  reason: RunOnceReasonCode;
  diagnostic: RunOnceDiagnostic;
};
export function summarizeFailure<R extends RunOnceReasonCode>(
  failure: RunOnceFailure<R>,
): RunOnceReasonSummary & { reason: R } {
  return {
    reason: failure.reason,
    diagnostic: diagnosticFor(failure.reason, failure.diagnosticContext),
  };
}
