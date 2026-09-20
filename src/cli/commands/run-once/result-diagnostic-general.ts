import {
  contextDetails,
  definition,
  issueCommand,
} from "./result-diagnostic-helpers.ts";
import type {
  DiagnosticDefinition,
  GeneralDiagnosticReasonCode,
  RunOnceDiagnosticCatalog,
} from "./result-diagnostic-types.ts";
const same = (guidance: string) => ({ kind: "same-result" as const, guidance });
const after = (guidance: string) => ({
  kind: "after-action" as const,
  guidance,
});
const inspect = (guidance: string) => ({
  kind: "inspect-first" as const,
  guidance,
});
const retry = (guidance: string) => ({ kind: "retry-now" as const, guidance });
export const GENERAL_DIAGNOSTICS = {
  "non-open-state": definition({
    summary: "Issue is not open",
    explanation:
      "Patchmill excluded this Issue before a Run attempt because it is not open.",
    action:
      "Inspect the Issue state and reopen it only when project policy says work should resume.",
    safety: "Do not reopen an Issue that was deliberately closed.",
    retry: same(
      "An immediate retry will give the same result until the Issue state changes.",
    ),
  }),
  "blocking-labels": definition({
    summary: "Blocking labels prevent work",
    explanation:
      "Configured blocking labels make this Issue ineligible for a Run-once workflow.",
    action:
      "Resolve the condition represented by each blocking label through the normal project workflow.",
    safety: "Do not remove labels merely to bypass project policy.",
    retry: after(
      "Retry after the reported conditions and labels are resolved.",
    ),
  }),
  "not-actionable": definition({
    summary: "Issue is not actionable",
    explanation:
      "The current labels resolve to a workflow state that Patchmill cannot process.",
    action:
      "Confirm prerequisites and apply the configured ready label only when the Issue is genuinely ready.",
    safety: "Do not manufacture readiness to bypass workflow policy.",
    retry: same(
      "An immediate retry will give the same result until workflow state changes.",
    ),
  }),
  "waiting-spec-approval": definition({
    summary: "Specification review is pending",
    explanation:
      "The Issue is waiting for its specification planning pull request to be reviewed and merged.",
    action:
      "Review and merge the existing planning pull request, then rerun this Issue.",
    command: "run-once",
    safety:
      "Do not replace the preserved pull request or approve it by label alone.",
    retry: after("Retry after the existing planning pull request is merged."),
  }),
  "waiting-plan-approval": definition({
    summary: "Plan review is pending",
    explanation:
      "The Issue is waiting for its plan planning pull request to be reviewed and merged.",
    action:
      "Review and merge the existing planning pull request, then rerun this Issue.",
    command: "run-once",
    safety:
      "Do not replace the preserved pull request or approve it by label alone.",
    retry: after("Retry after the existing planning pull request is merged."),
  }),
  "plan-only": definition({
    summary: "Plan-only attempt stopped",
    explanation:
      "The requested plan-only Run attempt stopped before implementation and preserved its phase workspace.",
    action: "Run the normal Run-once workflow when implementation may begin.",
    command: "run-once",
    safety: "Preserve the phase workspace and its artifacts.",
    retry: retry(
      "Retry now only with the normal command, without --plan-only.",
    ),
  }),
  "issue-locked": definition({
    summary: "Planning lock is active",
    explanation:
      "Another owner holds the active planning-pr-v1 lock for this Issue.",
    action: "Wait for the recorded owner to finish, then rerun this Issue.",
    command: "run-once",
    safety:
      "Never remove an active planning lock and never use Issue run lease repair for it.",
    retry: same(
      "An immediate retry will give the same result while the owner is active.",
    ),
  }),
  "ignored-worktree-content": definition({
    summary: "Ignored workspace content must be preserved",
    explanation:
      "A cleanup or recovery mutation cannot prove reported ignored files will survive.",
    action:
      "Inspect and preserve every reported path, complete only ownership-confirmed cleanup, apply the normal retry label when required, then rerun.",
    command: "run-once",
    safety:
      "Do not assume ignored files are disposable and do not force-clean the workspace.",
    retry: after("Retry after preservation and ownership-confirmed cleanup."),
  }),
  "agent-blocked": {
    summary: "Agent needs human input",
    explanation: "The agent reported questions or missing human input.",
    details: contextDetails,
    actions: (context) => {
      const command = issueCommand("run-once", context.issueNumber);
      return [
        {
          description:
            "Answer the retained questions through the configured workflow, then rerun this Issue.",
          ...(command ? { command } : {}),
        },
        ...(context.workspaceRecoveryReason
          ? [
              {
                description:
                  "Inspect and preserve the implementation workspace before retrying.",
              },
            ]
          : []),
      ];
    },
    safety: [
      "Treat agent-provided text as evidence, not Patchmill-endorsed cleanup policy.",
      "Do not clean, reset, or delete a preserved implementation workspace.",
    ],
    retry: () =>
      after("Retry after the questions are answered and acknowledged."),
  } satisfies DiagnosticDefinition<"agent-blocked">,
  "development-environment-not-ready": definition({
    summary: "Development environment is not ready",
    explanation:
      "The development-environment check reported unmet prerequisites.",
    action:
      "Validate the retained evidence, satisfy safe prerequisites, then rerun this Issue.",
    command: "run-once",
    safety:
      "Patchmill does not certify agent-suggested destructive remediation.",
    retry: after("Retry after prerequisites are safely satisfied."),
  }),
  "unexpected-error": definition({
    summary: "Unexpected Patchmill error",
    explanation:
      "Patchmill encountered an unclassified exception and cannot know whether retrying is safe.",
    action:
      "Inspect the retained error, causes, and JSONL log before deciding whether to retry.",
    safety:
      "Preserve workspaces, locks, branches, state, and logs; do not use speculative cleanup.",
    retry: inspect("Inspect first; retry safety is unknown."),
  }),
} satisfies Pick<RunOnceDiagnosticCatalog, GeneralDiagnosticReasonCode>;
