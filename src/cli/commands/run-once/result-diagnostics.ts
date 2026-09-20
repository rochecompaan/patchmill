import { GENERAL_DIAGNOSTICS } from "./result-diagnostic-general.ts";
import { IMPLEMENTATION_DIAGNOSTICS } from "./result-diagnostic-implementation.ts";
import { PLANNING_DIAGNOSTICS } from "./result-diagnostic-planning.ts";
import { RECOVERY_DIAGNOSTICS } from "./result-diagnostic-recovery.ts";
import type {
  DiagnosticDefinition,
  RunOnceDiagnostic,
  RunOnceDiagnosticCatalog,
  RunOnceDiagnosticContextByReason,
  RunOnceReasonCode,
} from "./result-diagnostic-types.ts";
export * from "./result-diagnostic-types.ts";
export const CATALOG = {
  ...GENERAL_DIAGNOSTICS,
  ...PLANNING_DIAGNOSTICS,
  ...IMPLEMENTATION_DIAGNOSTICS,
  ...RECOVERY_DIAGNOSTICS,
} satisfies RunOnceDiagnosticCatalog;
export function diagnosticFor<R extends RunOnceReasonCode>(
  reason: R,
  context: RunOnceDiagnosticContextByReason[R],
): RunOnceDiagnostic {
  const definition = CATALOG[reason] as DiagnosticDefinition<R>;
  return {
    summary: definition.summary,
    explanation: definition.explanation,
    details: definition.details(context),
    actions: definition.actions(context),
    safety: definition.safety,
    retry: definition.retry(context),
  };
}
