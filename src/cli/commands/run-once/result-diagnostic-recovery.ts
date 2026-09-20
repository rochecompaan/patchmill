import { definition, issueCommand } from "./result-diagnostic-helpers.ts";
import type {
  RecoveryDiagnosticReasonCode,
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
export const RECOVERY_DIAGNOSTICS = {
  "active-run": {
    ...definition({
      summary: "Issue run is active",
      explanation:
        "An Issue run lease, lease guard, or repair lock is owned or cannot be proven free.",
      action:
        "Wait for affected runners to stop, then inspect with Issue run lease repair when lease repair is relevant.",
      safety: "Never remove lease resources while an owner may be active.",
      retry: same(
        "An immediate retry will give the same result while ownership is active or uncertain.",
      ),
    }),
    actions: (context) => {
      const command =
        context.resource === "lease"
          ? issueCommand("lease-repair", context.issueNumber)
          : undefined;
      return [
        {
          description:
            "Wait for affected runners to stop, then inspect with Issue run lease repair when lease repair is relevant.",
          ...(command ? { command } : {}),
        },
      ];
    },
  },
  "dirty-worktree": definition({
    summary: "Recovery found workspace changes",
    explanation:
      "Run recovery found ordinary tracked or untracked workspace changes.",
    action: "Inspect and preserve reported changes, then rerun the Issue.",
    command: "run-once",
    safety: "Do not clean or reset before confirming preservation.",
    retry: after("Retry after preserving workspace changes."),
  }),
  "unmerged-commits": definition({
    summary: "Recovery found unmerged commits",
    explanation:
      "Run recovery found unique branch commits that a mutation could lose.",
    action:
      "Merge or otherwise preserve every reported commit, then rerun the Issue.",
    command: "run-once",
    safety: "Do not reset or delete the branch.",
    retry: after("Retry after unique commits are preserved."),
  }),
  "workspace-unverifiable": definition({
    summary: "Workspace identity is unverifiable",
    explanation:
      "Saved, expected, filesystem, and Git worktree registration identities do not agree.",
    action:
      "Inspect reported identities and registrations and repair them manually before rerunning.",
    safety:
      "Do not delete a worktree or registration until ownership is proven.",
    retry: inspect("Inspect identities before retrying."),
  }),
  "legacy-active-unfenced": definition({
    summary: "Legacy active state is unfenced",
    explanation:
      "Legacy active Run recovery state lacks a valid migration fence.",
    action:
      "After affected runners stop, inspect with Issue run lease repair, then rerun.",
    command: "lease-repair",
    safety: "Do not adopt or mutate unfenced active state.",
    retry: after("Retry after lease fence repair."),
  }),
  "not-blocked": definition({
    summary: "Recovery state is not blocked",
    explanation:
      "A recovery retry or reset was requested for state that is not blocked.",
    action: "Continue with normal Run-once execution.",
    command: "run-once",
    safety: "Do not reset healthy state.",
    retry: retry("Retry now with normal Run-once execution."),
  }),
} satisfies Pick<RunOnceDiagnosticCatalog, RecoveryDiagnosticReasonCode>;
