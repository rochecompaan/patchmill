import {
  contextDetails,
  definition,
  issueCommand,
} from "./result-diagnostic-helpers.ts";
import type {
  PlanningDiagnosticReasonCode,
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
export const PLANNING_DIAGNOSTICS = {
  "issue-lock-stale": definition({
    summary: "Planning lock owner is stale",
    explanation:
      "The recorded planning-lock owner process is no longer running on the recorded host.",
    action:
      "Confirm the owner stopped, record the lock path and fingerprint, preserve the exact bytes as evidence, then manually archive or move them before rerunning.",
    command: "run-once",
    safety:
      "Never delete or edit the lock in place; Issue run lease repair does not apply.",
    retry: same(
      "An immediate retry will give the same result until the preserved lock is handled.",
    ),
  }),
  "issue-lock-unverifiable": definition({
    summary: "Planning lock ownership is unverifiable",
    explanation:
      "Patchmill cannot prove whether the recorded planning-lock owner is active.",
    action:
      "Coordinate with the recorded host/operator and inspect preserved lock bytes before manual archival.",
    safety:
      "Lock age alone is not evidence; do not remove the lock or use Issue run lease repair.",
    retry: inspect("Inspect ownership before retrying."),
  }),
  "issue-lock-malformed": definition({
    summary: "Planning lock cannot be parsed",
    explanation: "Existing planning-lock bytes cannot be parsed safely.",
    action:
      "Record the lock path and fingerprint, then inspect or archive the exact bytes with operator coordination.",
    safety:
      "Do not edit or delete lock bytes in place and do not use Issue run lease repair.",
    retry: inspect("Inspect preserved evidence before retrying."),
  }),
  "planning-state-invalid": definition({
    summary: "Planning state is invalid",
    explanation:
      "Durable planning state failed validation or could not be read, so resume identity is unsafe.",
    action:
      "Inspect the reported state path and validation fact, then restore valid state from authoritative evidence.",
    command: "run-once",
    safety: "Do not hand-edit state merely to bypass validation.",
    retry: inspect("Inspect and repair authoritative state before retrying."),
  }),
  "planning-identity-changed": definition({
    summary: "Planning identity changed",
    explanation:
      "Issue, workflow, legacy-state, or planning-state identity changed after advisory selection.",
    action:
      "Compare expected and observed identities and let the authoritative owner finish or repair underlying state.",
    safety:
      "Do not overwrite state, labels, or workspaces to match stale selection.",
    retry: same("Retry after identity stabilizes."),
  }),
  "planning-run-id-mismatch": definition({
    summary: "Planning Run IDs disagree",
    explanation:
      "The planning-state Run ID does not match the acquired ownership lock.",
    action:
      "Inspect the state path and both Run IDs, preserving them as evidence before operator repair.",
    safety: "Do not edit either ID or replace the lock.",
    retry: inspect("Inspect evidence before retrying."),
  }),
  "planning-workspace-dirty": definition({
    summary: "Phase workspace has local changes",
    explanation:
      "The phase workspace contains local changes and cannot be resumed or published safely.",
    action:
      "Inspect the reported phase, branch, path, state, and status evidence; preserve the work before retrying.",
    safety:
      "Do not run git clean, destructive reset, or delete the phase workspace.",
    retry: same("An immediate retry will give the same result."),
  }),
  "ambiguous-base-artifact": definition({
    summary: "Base artifact is ambiguous",
    explanation:
      "More than one candidate artifact on the fetched base can satisfy this phase.",
    action:
      "Inspect candidate paths and make the base contain exactly one authoritative artifact through normal reviewed changes.",
    safety:
      "Do not arbitrarily delete or select evidence inside the active Run attempt.",
    retry: after("Retry after reviewed base changes resolve the ambiguity."),
  }),
  "planning-pull-request-closed-unmerged": definition({
    summary: "Planning pull request closed unmerged",
    explanation: "The saved planning pull request was closed without merge.",
    action: "Inspect and repair the existing host artifact manually.",
    safety: "Do not silently create a replacement or rewrite saved evidence.",
    retry: same("An immediate retry will give the same result."),
  }),
  "planning-pull-request-missing": definition({
    summary: "Planning pull request is missing",
    explanation:
      "The saved or uniquely expected planning pull request cannot be found.",
    action:
      "Verify the reported reference and repository, then repair host state manually.",
    safety:
      "Do not create a replacement until ownership and history are reconciled.",
    retry: inspect("Inspect host evidence before retrying."),
  }),
  "planning-pull-request-ambiguous": definition({
    summary: "Planning pull request is ambiguous",
    explanation: "Multiple pull requests match one planned phase publication.",
    action:
      "Inspect every reported pull request and resolve host-side ambiguity while preserving the authoritative artifact.",
    safety: "Do not select or close a candidate without confirming ownership.",
    retry: after("Retry after host-side ambiguity is resolved."),
  }),
  "planning-head-adoption-blocked": {
    summary: "Planning head revision could not be adopted safely",
    explanation:
      "The planning pull request head changed, but Patchmill could not prove one fast-forward, artifact-only revision with agreeing host and remote evidence.",
    details: (context) => contextDetails(context),
    actions: (context) => {
      const command = issueCommand("run-once", context.issueNumber);
      return [
        {
          description:
            "Preserve or reapply the revision on the saved planning branch so it is a fast-forward descendant of the recorded head, its net changes are limited to the reported artifact paths, and host and remote heads agree; then rerun the Issue.",
          ...(command === undefined ? {} : { command }),
        },
      ];
    },
    safety: [
      "Do not hand-edit planning state, force-restore the obsolete head, or discard revised artifacts.",
    ],
    retry: (context) =>
      context.adoptionFailure === "head-moved"
        ? {
            kind: "retry-now",
            guidance:
              "The bounded observation raced; rerun now to evaluate the latest head.",
          }
        : after(
            "Retry after the saved planning branch and host evidence are repaired.",
          ),
  },
  "planning-merge-recovery-blocked": definition({
    summary: "Planning merge evidence needs reviewed base repair",
    explanation:
      "The immutable merge commit and freshly fetched target base could not prove every saved regular-file planning artifact, and exact current-base recovery was insufficient.",
    action:
      "Restore exactly one regular artifact at each reported saved path through normal reviewed changes on the configured target base, then rerun the Issue.",
    command: "run-once",
    safety:
      "Do not recreate the deleted source branch, hand-edit planning state, force-restore stale history, or choose an ambiguous candidate.",
    retry: after(
      "Retry after reviewed target-base changes restore the reported artifact evidence.",
    ),
  }),
  "planning-workspace-conflict": definition({
    summary: "Phase workspace ownership conflicts",
    explanation:
      "Phase-workspace identity, registration, base, head, cleanliness, or remote evidence conflicts with saved ownership.",
    action:
      "Inspect the conflict, phase, branch, and path and reconcile ownership manually.",
    safety: "Do not force-remove, clean, reset, or recreate preserved state.",
    retry: inspect("Inspect ownership before retrying."),
  }),
} satisfies Pick<RunOnceDiagnosticCatalog, PlanningDiagnosticReasonCode>;
