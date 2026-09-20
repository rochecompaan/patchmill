# Actionable Run-once Failure Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every public reason emitted by `patchmill run-once` one stable,
structured, actionable diagnostic across terminal output, redirected JSON, and
the final JSONL result or selection event.

**Architecture:** Add a pure, exhaustive diagnostic catalog keyed by a canonical
reason-code tuple, with typed reason-specific context collected at existing
classification boundaries. Normalize free-form agent, environment, validation,
recovery, workspace, and exception text into bounded public codes while keeping
the original text as attributed evidence; materialize the diagnostic once at the
summary or selection-event boundary and render that same object everywhere.
Split the catalog by reason family behind one `result-diagnostics.ts` facade so
no growing module becomes a policy and formatting god file.

**Tech Stack:** TypeScript ESM, Node.js and `node:test`, existing run-once
pipeline/planning/recovery types, existing terminal layout primitives, Astro
Starlight documentation, Prettier, ESLint, and the TypeScript build; no new
dependency.

**Spec:**
`docs/specs/2026-09-20-issue-242-make-all-run-once-failure-reasons-actionable-design.md`

## Global Constraints

- Use **Run-once workflow**, **Issue run**, **Run attempt**, **Run recovery
  state**, and **phase workspace** as defined by `CONTEXT.md`.
- Keep every existing stable reason spelling unchanged. Normalize current prose
  only to `agent-blocked`, `development-environment-not-ready`,
  `implementation-validation`, `planning-workspace-conflict`, or
  `unexpected-error`, retaining the prose as diagnostic evidence.
- Every reason-bearing public result or selection rejection must carry both
  `reason` and `diagnostic`; the diagnostic never replaces the reason.
- Every diagnostic must have a nonblank summary and explanation, at least one
  safe action, at least one safety statement, and explicit retry guidance.
- Collect context from the exact facts used by the decision. Catalog code must
  not re-read Git, lock files, host state, phase workspaces, or Run recovery
  state.
- Build commands only from validated positive Issue numbers. Never interpolate
  arbitrary paths, branch names, owner text, agent text, or error text into a
  shell command.
- A `planning-pr-v1` lock is not an Issue run lease. Never recommend
  `patchmill run lease repair` for `issue-locked`, `issue-lock-stale`,
  `issue-lock-unverifiable`, or `issue-lock-malformed`.
- Do not recommend `git clean`, destructive reset, force removal, deleting or
  editing locks in place, deleting phase workspaces, replacing existing pull
  requests, or discarding commits. A reset command may appear only when an
  assessed recovery policy explicitly proves that reset can pass.
- Keep agent-provided remediation and arbitrary exception text in attributed
  `details`; it must never alter catalog-owned actions, safety text, or retry
  classification.
- Preserve statuses, severity, exit codes, labels, comments, checkpoints,
  persisted `lastError`, blocker questions, Issue run leases, planning locks,
  Run recovery state, cleanup behavior, and all workflow effects.
- A `no-issue` result still has no invented aggregate reason. Per-Issue
  selection rejection events remain the structured source for rejected Issues.
- Keep terminal output concise, ordered, wrapped, ANSI-sanitized, and safe at
  every positive width. Color must not be the only safety signal.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If implementation unexpectedly retains an npm dependency metadata change, run
  the Nix build required by `AGENTS.md`.

---

## File and Module Map

### New focused diagnostic modules

- `src/cli/commands/run-once/result-diagnostic-types.ts` — canonical reason
  tuple, reason-family aliases, structured diagnostic contract, typed context
  map, and correlated internal `RunOnceFailure<R>` envelope.
- `src/cli/commands/run-once/result-diagnostic-general.ts` — selection,
  expected-stop/cleanup, agent-blocker, environment, and unexpected-error
  definitions.
- `src/cli/commands/run-once/result-diagnostic-planning.ts` — planning lock,
  planning state, phase-workspace, artifact, and planning pull-request
  definitions.
- `src/cli/commands/run-once/result-diagnostic-implementation.ts` —
  implementation configuration/workspace/PR/evidence definitions.
- `src/cli/commands/run-once/result-diagnostic-recovery.ts` — Issue run lease
  and Run recovery refusal definitions.
- `src/cli/commands/run-once/result-diagnostics.ts` — merge the family catalogs
  into the single exhaustive `Record<RunOnceReasonCode, DiagnosticDefinition>`,
  validate command inputs, and expose the pure `diagnosticFor()` materializer.
- `src/cli/commands/run-once/result-diagnostics.test.ts` — exhaustive catalog,
  content, command, trust-boundary, and destructive-guidance contract tests.
- `src/cli/commands/run-once/pipeline-error-diagnostics.ts` — translate typed
  errors or unclassified exceptions into a bounded public failure without
  changing the thrown error's message, causes, or pipeline status.

### Existing types and output boundary

- `src/cli/commands/run-once/types.ts` — derive selection reason types from the
  canonical tuple and require correlated reason/context envelopes on
  reason-bearing public pipeline results.
- `src/issue-run/types.ts` — retain free-form `AgentIssueBlockedResult.reason`
  and development-environment agent fields as agent-facing contracts; document
  that adapters normalize them before public output.
- `src/cli/commands/run-once/result-summary.ts` — materialize one diagnostic per
  reason-bearing result and error while preserving existing non-reason fields.
- `src/cli/commands/run-once/result-output.ts` — continue writing the exact
  summary to redirected stdout and the final JSONL `result` event; preserve exit
  codes.
- `src/cli/commands/run-once/terminal-result.ts` — render Reason, Explanation,
  Details, Recommended action, Safety, and Retry from the shared diagnostic,
  without duplicating legacy evidence/remediation sections.
- `src/cli/commands/run-once/terminal-result-layout.ts` — only extend value
  roles or list rendering if the existing primitives cannot render stable detail
  labels and command lines cleanly; retain all sanitization and wrapping rules.

### Producer adapters

- `src/cli/commands/run-once/selection.ts` and
  `src/cli/commands/run-once/pipeline-selection.ts` — derive selection codes
  from the canonical type and add the shared diagnostic to rejection events.
- `src/cli/commands/run-once/pipeline-failures.ts` — normalize agent blockers
  and caught pipeline failures without changing persisted/commented free-form
  evidence.
- `src/cli/commands/run-once/development-environment-stage.ts` and
  `src/cli/commands/run-once/planning-implementation-adapter.ts` — normalize
  environment refusal text and evidence to the bounded public code.
- `src/cli/commands/run-once/planning-selection.ts` and
  `src/cli/commands/run-once/pipeline.ts` — keep planning-state validation facts
  separate from `planning-state-invalid`.
- `src/cli/commands/run-once/planning-pipeline.ts` — preserve planning lock
  path/fingerprint/owner and identity/run-ID evidence.
- `src/cli/commands/run-once/planning-phase-artifacts.ts`,
  `src/cli/commands/run-once/planning-phase-runner-shared.ts`,
  `src/cli/commands/run-once/planning-phase-runner-planning.ts`, and
  `src/cli/commands/run-once/planning-phase-runner-implementation.ts` — retain
  phase, artifact candidates, phase-workspace identity/state, and planning
  pull-request evidence.
- `src/cli/commands/run-once/planning-phase-reconciler.ts` and
  `src/cli/commands/run-once/planning-phase-publisher.ts` — pass existing pull
  request references, URLs, statuses, and ambiguous matches to diagnostics.
- `src/cli/commands/run-once/planning-implementation.ts`,
  `src/cli/commands/run-once/planning-implementation-validation.ts`, and
  `src/cli/commands/run-once/planning-implementation-workspace-recovery.ts` —
  retain expected/observed workspace, ancestry, remote-head, branch, URL, and
  validation subreason evidence.
- `src/cli/commands/run-once/pipeline-recovery.ts`,
  `src/cli/commands/run-once/recovery-lease.ts`, and
  `src/cli/commands/run-once/main.ts` — carry typed recovery refusals and active
  Issue run lease errors to `summarizeErrorResult()` instead of flattening them
  to prose.

### Tests and documentation

- Update focused tests beside every producer above, especially
  `planning-pipeline.test.ts`, `planning-phase-runner.test.ts`,
  `planning-implementation.test.ts`, `pipeline-recovery.test.ts`,
  `pipeline-selection.test.ts`, `result-summary.test.ts`,
  `result-output.test.ts`, `terminal-result.test.ts`, and `main.test.ts`.
- `site/src/content/docs/using-patchmill/run-once.md` — document the structured
  diagnostic fields, retry kinds, selection-event behavior, supported commands,
  and the planning-lock versus Issue run lease boundary.

The family split keeps catalog policy independent of producer I/O and terminal
presentation. `types.ts`, `result-summary.ts`, and `terminal-result.ts` are
already near or above the module-size review threshold; add narrow helpers or
focused modules rather than embedding the catalog or producer adaptation logic
inside those files.

## Shared Interfaces

Use these names and shapes consistently in every task.

```ts
// result-diagnostic-types.ts
export const RUN_ONCE_REASON_CODES = [
  "non-open-state",
  "blocking-labels",
  "not-actionable",
  "waiting-spec-approval",
  "waiting-plan-approval",
  "plan-only",
  "issue-locked",
  "ignored-worktree-content",
  "issue-lock-stale",
  "issue-lock-unverifiable",
  "issue-lock-malformed",
  "planning-state-invalid",
  "planning-identity-changed",
  "planning-run-id-mismatch",
  "planning-workspace-dirty",
  "ambiguous-base-artifact",
  "planning-pull-request-closed-unmerged",
  "planning-pull-request-missing",
  "planning-pull-request-ambiguous",
  "implementation-configuration",
  "implementation-workspace",
  "implementation-direct-merge",
  "implementation-ancestry",
  "implementation-remote-head",
  "implementation-url",
  "implementation-branch",
  "implementation-evidence",
  "active-run",
  "dirty-worktree",
  "unmerged-commits",
  "workspace-unverifiable",
  "legacy-active-unfenced",
  "not-blocked",
  "agent-blocked",
  "development-environment-not-ready",
  "implementation-validation",
  "planning-workspace-conflict",
  "unexpected-error",
] as const;

export type RunOnceReasonCode = (typeof RUN_ONCE_REASON_CODES)[number];

export type IssueSelectionReasonCode = Extract<
  RunOnceReasonCode,
  | "non-open-state"
  | "blocking-labels"
  | "not-actionable"
  | "waiting-spec-approval"
  | "waiting-plan-approval"
>;
export type GeneralDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | IssueSelectionReasonCode
  | "plan-only"
  | "issue-locked"
  | "ignored-worktree-content"
  | "agent-blocked"
  | "development-environment-not-ready"
  | "unexpected-error"
>;
export type PlanningDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | "issue-lock-stale"
  | "issue-lock-unverifiable"
  | "issue-lock-malformed"
  | "planning-state-invalid"
  | "planning-identity-changed"
  | "planning-run-id-mismatch"
  | "planning-workspace-dirty"
  | "ambiguous-base-artifact"
  | "planning-pull-request-closed-unmerged"
  | "planning-pull-request-missing"
  | "planning-pull-request-ambiguous"
  | "planning-workspace-conflict"
>;
export type ImplementationDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | "implementation-configuration"
  | "implementation-workspace"
  | "implementation-direct-merge"
  | "implementation-ancestry"
  | "implementation-remote-head"
  | "implementation-url"
  | "implementation-branch"
  | "implementation-evidence"
  | "implementation-validation"
>;
export type RecoveryDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | "active-run"
  | "dirty-worktree"
  | "unmerged-commits"
  | "workspace-unverifiable"
  | "legacy-active-unfenced"
  | "not-blocked"
>;

export type RunOnceDiagnostic = {
  summary: string;
  explanation: string;
  details: Array<{
    key: string;
    label: string;
    value: string | number | readonly string[];
  }>;
  actions: Array<{ description: string; command?: string }>;
  safety: readonly string[];
  retry: {
    kind: "retry-now" | "after-action" | "same-result" | "inspect-first";
    guidance: string;
  };
};

export type DiagnosticDefinition<R extends RunOnceReasonCode> = {
  summary: string;
  explanation: string;
  details: (
    context: RunOnceDiagnosticContextByReason[R],
  ) => RunOnceDiagnostic["details"];
  actions: (
    context: RunOnceDiagnosticContextByReason[R],
  ) => RunOnceDiagnostic["actions"];
  safety: RunOnceDiagnostic["safety"];
  retry: (
    context: RunOnceDiagnosticContextByReason[R],
  ) => RunOnceDiagnostic["retry"];
};

export type RunOnceDiagnosticCatalog = {
  [R in RunOnceReasonCode]: DiagnosticDefinition<R>;
};
```

`DiagnosticDefinition` is declared after the context map in the source file so
its reference resolves without forward-declaration confusion; it is shown here
beside the public shape to make the catalog contract explicit. Define focused
context records and then map every code explicitly; do not use a catch-all index
signature.

```ts
type BaseDiagnosticContext = {
  issueNumber?: number;
  status?: string;
};

type WorkspaceDiagnosticContext = BaseDiagnosticContext & {
  phase?: "spec" | "plan" | "implementation";
  branch?: string;
  worktreePath?: string;
  workspaceState?: string;
  statusEvidence?: string;
};

type PlanningLockDiagnosticContext = BaseDiagnosticContext & {
  lockPath: string;
  fingerprint: string;
  owner?: {
    issueNumber: number;
    runId: string;
    pid: number;
    hostname: string;
    acquiredAt: string;
  };
};

export type RunOnceDiagnosticContextByReason = {
  "non-open-state": BaseDiagnosticContext & {
    issueState: string;
    labels: readonly string[];
    workflowState: string;
  };
  "blocking-labels": BaseDiagnosticContext & {
    labels: readonly string[];
    blockingLabels: readonly string[];
    workflowState: string;
  };
  "not-actionable": BaseDiagnosticContext & {
    labels: readonly string[];
    workflowState: string;
    readyLabel?: string;
  };
  "waiting-spec-approval": BaseDiagnosticContext & {
    labels: readonly string[];
    workflowState: string;
    missingLabel?: string;
  };
  "waiting-plan-approval": BaseDiagnosticContext & {
    labels: readonly string[];
    workflowState: string;
    missingLabel?: string;
  };
  "plan-only": WorkspaceDiagnosticContext & { nextPhase?: "implementation" };
  "issue-locked": PlanningLockDiagnosticContext;
  "ignored-worktree-content": WorkspaceDiagnosticContext & {
    ignoredPaths: readonly string[];
    blockedAction?: string;
    guidance?: readonly string[];
  };
  "issue-lock-stale": PlanningLockDiagnosticContext;
  "issue-lock-unverifiable": PlanningLockDiagnosticContext;
  "issue-lock-malformed": PlanningLockDiagnosticContext;
  "planning-state-invalid": BaseDiagnosticContext & {
    statePath: string;
    validation: string;
  };
  "planning-identity-changed": BaseDiagnosticContext & {
    expectedIdentity?: readonly string[];
    observedIdentity?: readonly string[];
  };
  "planning-run-id-mismatch": BaseDiagnosticContext & {
    statePath?: string;
    savedRunId?: string;
    lockRunId?: string;
  };
  "planning-workspace-dirty": WorkspaceDiagnosticContext;
  "ambiguous-base-artifact": BaseDiagnosticContext & {
    phase?: "spec" | "plan" | "implementation";
    artifactKind?: "spec" | "plan";
    baseOid?: string;
    candidates?: readonly string[];
  };
  "planning-pull-request-closed-unmerged": BaseDiagnosticContext & {
    phase?: "spec" | "plan";
    pullRequestUrl?: string;
    pullRequestReference?: string;
    observedStatus?: string;
  };
  "planning-pull-request-missing": BaseDiagnosticContext & {
    phase?: "spec" | "plan";
    pullRequestUrl?: string;
    pullRequestReference?: string;
  };
  "planning-pull-request-ambiguous": BaseDiagnosticContext & {
    phase?: "spec" | "plan";
    pullRequestUrls?: readonly string[];
  };
  "implementation-configuration": WorkspaceDiagnosticContext & {
    expectedRemote?: string;
    observedRemote?: string;
    expectedBaseBranch?: string;
    observedBaseBranch?: string;
  };
  "implementation-workspace": WorkspaceDiagnosticContext & {
    expectedHeadOid?: string;
    observedHeadOid?: string;
  };
  "implementation-direct-merge": WorkspaceDiagnosticContext & {
    reportedBranch?: string;
    mergeCommit?: string;
  };
  "implementation-ancestry": WorkspaceDiagnosticContext & {
    baseOid?: string;
    savedHeadOid?: string;
    observedHeadOid?: string;
    commits?: readonly string[];
  };
  "implementation-remote-head": WorkspaceDiagnosticContext & {
    remote?: string;
    expectedHeadOid?: string;
    observedRemoteState?: string;
    observedHeadOid?: string;
  };
  "implementation-url": WorkspaceDiagnosticContext & {
    reportedUrl?: string;
    expectedRepository?: string;
  };
  "implementation-branch": WorkspaceDiagnosticContext & {
    expectedBranch?: string;
    reportedBranch?: string;
  };
  "implementation-evidence": WorkspaceDiagnosticContext & {
    validation?: string;
  };
  "active-run": BaseDiagnosticContext & {
    resource: "lease" | "lease-guard" | "repair-lock";
    leasePath: string;
    owner?: {
      pid: number;
      hostname: string;
      acquiredAt: string;
    };
    guidance: readonly string[];
  };
  "dirty-worktree": WorkspaceDiagnosticContext & {
    runStatePath?: string;
    dirtyStatus?: string;
    guidance: readonly string[];
  };
  "unmerged-commits": WorkspaceDiagnosticContext & {
    runStatePath?: string;
    commits: readonly string[];
    guidance: readonly string[];
  };
  "workspace-unverifiable": WorkspaceDiagnosticContext & {
    runStatePath?: string;
    savedWorkspace?: readonly string[];
    expectedWorkspace?: readonly string[];
    guidance: readonly string[];
  };
  "legacy-active-unfenced": BaseDiagnosticContext & {
    runStatePath?: string;
    guidance: readonly string[];
  };
  "not-blocked": BaseDiagnosticContext & {
    runStatePath?: string;
    observedStatus?: string;
    guidance: readonly string[];
  };
  "agent-blocked": WorkspaceDiagnosticContext & {
    reportedReason: string;
    questions: readonly string[];
    evidence?: readonly string[];
  };
  "development-environment-not-ready": WorkspaceDiagnosticContext & {
    reportedReason: string;
    evidence: readonly string[];
    reportedRemediation: readonly string[];
  };
  "implementation-validation": WorkspaceDiagnosticContext & {
    validationReason: string;
    pullRequestUrl?: string;
    expected?: readonly string[];
    observed?: readonly string[];
  };
  "planning-workspace-conflict": WorkspaceDiagnosticContext & {
    conflictReason: string;
  };
  "unexpected-error": BaseDiagnosticContext & {
    error: string;
    causes?: readonly string[];
    logPath?: string;
  };
};

export type RunOnceFailure<R extends RunOnceReasonCode> = {
  reason: R;
  diagnosticContext: RunOnceDiagnosticContextByReason[R];
};

export type AnyRunOnceFailure = {
  [R in RunOnceReasonCode]: RunOnceFailure<R>;
}[RunOnceReasonCode];

export function runOnceFailure<R extends RunOnceReasonCode>(
  reason: R,
  diagnosticContext: RunOnceDiagnosticContextByReason[R],
): RunOnceFailure<R> {
  return { reason, diagnosticContext };
}
```

The public materializer remains generic and pure. One narrow type assertion may
be used inside the facade to recover the generic key after an indexed lookup; no
producer or caller may cast an arbitrary string to `RunOnceReasonCode`.

```ts
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
```

At the summary boundary, internal context disappears and the structured
materialization remains:

```ts
function summarizeFailure<R extends RunOnceReasonCode>(
  failure: RunOnceFailure<R>,
): { reason: R; diagnostic: RunOnceDiagnostic } {
  return {
    reason: failure.reason,
    diagnostic: diagnosticFor(failure.reason, failure.diagnosticContext),
  };
}
```

## Diagnostic Copy and Recovery Policy

Implement the catalog with the following concrete operator meaning. Wording may
be tightened for readability, but it must retain every listed fact, action,
safety boundary, and retry classification.

| Reason                                  | Summary and explanation                                                                                             | Safe action                                                                                                                                                                                   | Required safety and retry                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `non-open-state`                        | The Issue is not open, so Patchmill excluded it before a Run attempt.                                               | Inspect the current Issue state and reopen it only if project policy says work should resume.                                                                                                 | Do not reopen a deliberately closed Issue. Immediate retry is `same-result` until the Issue state changes.                              |
| `blocking-labels`                       | One or more configured blocking labels make the Issue ineligible.                                                   | Resolve the condition represented by every reported blocking label, then update labels through normal project workflow.                                                                       | Do not remove labels merely to bypass policy. Retry is `after-action`.                                                                  |
| `not-actionable`                        | Labels resolve to a workflow state that is not actionable.                                                          | Confirm prerequisites and apply the configured ready label only when the Issue is genuinely ready.                                                                                            | Do not manufacture readiness. Immediate retry is `same-result`.                                                                         |
| `waiting-spec-approval`                 | The Issue is waiting for its specification planning pull request to be reviewed and merged.                         | Review/merge the existing planning pull request, then run `patchmill run-once --issue N`.                                                                                                     | Do not replace the preserved pull request or approve by label alone. Retry is `after-action`.                                           |
| `waiting-plan-approval`                 | The Issue is waiting for its plan planning pull request to be reviewed and merged.                                  | Review/merge the existing planning pull request, then run `patchmill run-once --issue N`.                                                                                                     | Do not replace the preserved pull request or approve by label alone. Retry is `after-action`.                                           |
| `plan-only`                             | The requested plan-only Run attempt stopped before implementation and preserved its phase workspace.                | Run `patchmill run-once --issue N` without `--plan-only` when implementation may begin.                                                                                                       | Preserve the workspace and artifacts. Retry is `retry-now` only with the normal command.                                                |
| `issue-locked`                          | Another owner holds the active `planning-pr-v1` lock.                                                               | Wait for that owner to finish, then run `patchmill run-once --issue N`.                                                                                                                       | Never remove an active planning lock and never use Issue run lease repair for it. Immediate retry is `same-result`.                     |
| `ignored-worktree-content`              | A cleanup or recovery mutation cannot prove reported ignored files will survive.                                    | Inspect and preserve every reported path, complete only ownership-confirmed cleanup, apply the normal retry label when required, then run `patchmill run-once --issue N`.                     | Do not assume ignored files are disposable or force-clean the workspace. Retry is `after-action`.                                       |
| `issue-lock-stale`                      | The recorded planning-lock owner process is no longer running on the recorded host.                                 | Confirm the owner stopped, record the lock path and SHA-256 fingerprint, preserve the exact bytes as evidence, manually archive or move those bytes, then run `patchmill run-once --issue N`. | Never delete or edit the lock in place; Issue run lease repair does not apply. Immediate retry is `same-result`.                        |
| `issue-lock-unverifiable`               | Patchmill cannot prove whether the recorded planning-lock owner is still active.                                    | Coordinate with the recorded host/operator and inspect the preserved lock bytes before any manual archival.                                                                                   | Lock age alone is not evidence; do not remove the lock or use Issue run lease repair. Retry is `inspect-first`.                         |
| `issue-lock-malformed`                  | Existing planning-lock bytes cannot be parsed safely.                                                               | Record the path/fingerprint and inspect or archive the exact bytes with operator coordination before retrying.                                                                                | Do not edit or delete the bytes in place and do not use Issue run lease repair. Retry is `inspect-first`.                               |
| `planning-state-invalid`                | Durable planning state failed validation or could not be read, so resume identity is unsafe.                        | Inspect the reported state path and validation fact, restore a valid state from authoritative evidence, then rerun the same Issue.                                                            | Do not hand-edit state merely to bypass validation. Retry is `inspect-first`.                                                           |
| `planning-identity-changed`             | Issue, workflow, legacy-state, or planning-state identity changed after advisory selection.                         | Compare the reported expected and observed identities and let the authoritative owner finish or repair the underlying state.                                                                  | Do not overwrite state, labels, or workspaces to match the stale selection. Immediate retry is `same-result` until identity stabilizes. |
| `planning-run-id-mismatch`              | The planning state Run ID does not match the acquired ownership lock.                                               | Inspect the state path and both Run IDs, preserving both as evidence before operator repair.                                                                                                  | Do not edit either ID or replace the lock. Retry is `inspect-first`.                                                                    |
| `planning-workspace-dirty`              | The phase workspace contains local changes and cannot be resumed or published safely.                               | Inspect the reported phase, branch, path, state, and status evidence; preserve the work before retrying.                                                                                      | Do not run `git clean`, destructive reset, or delete the phase workspace. Immediate retry is `same-result`.                             |
| `ambiguous-base-artifact`               | More than one candidate artifact on the fetched base can satisfy the phase.                                         | Inspect the reported candidate paths and make the base contain exactly one authoritative artifact through normal reviewed changes.                                                            | Do not arbitrarily delete or select evidence inside the active Run attempt. Retry is `after-action`.                                    |
| `planning-pull-request-closed-unmerged` | The saved planning pull request was closed without merge.                                                           | Inspect and repair the existing host artifact manually.                                                                                                                                       | Do not silently create a replacement or rewrite saved evidence. Immediate retry is `same-result`.                                       |
| `planning-pull-request-missing`         | The saved or uniquely expected planning pull request cannot be found.                                               | Verify the reported reference/repository and repair host state manually.                                                                                                                      | Do not create a replacement until ownership and history are reconciled. Retry is `inspect-first`.                                       |
| `planning-pull-request-ambiguous`       | Multiple pull requests match one planned phase publication.                                                         | Inspect every reported URL and resolve the host-side ambiguity while preserving the authoritative artifact.                                                                                   | Do not select or close a candidate without confirming ownership. Retry is `after-action`.                                               |
| `implementation-configuration`          | Current Git remote or base configuration differs from the pinned implementation phase.                              | Restore configuration to the reported pinned remote/base or reconcile the phase through reviewed operator action.                                                                             | Do not repoint the phase to unrelated history. Immediate retry is `same-result`.                                                        |
| `implementation-workspace`              | The implementation workspace is dirty, missing, or no longer proven to descend from saved evidence.                 | Inspect the path, branch, state, status, and head OIDs; preserve all work before retrying.                                                                                                    | Do not clean, reset, delete, or recreate the workspace speculatively. Retry is `inspect-first`.                                         |
| `implementation-direct-merge`           | The implementation agent reported a direct merge where this workflow requires an open pull request.                 | Inspect the reported branch and merge commit, then reconcile the landed state manually.                                                                                                       | Do not create duplicate work or reverse a merge automatically. Retry is `inspect-first`.                                                |
| `implementation-ancestry`               | Reported implementation commits are not on the pinned base-to-head ancestry path.                                   | Inspect the base, saved head, observed head, and reported commits; repair the existing branch history through normal review.                                                                  | Do not force-push, reset, or discard commits. Immediate retry is `same-result`.                                                         |
| `implementation-remote-head`            | The remote implementation branch is absent or differs from the verified local head.                                 | Inspect the remote, branch, and expected/observed OIDs and repair the existing publication safely.                                                                                            | Do not force-update the branch without confirming ownership. Retry is `after-action`.                                                   |
| `implementation-url`                    | The reported pull-request URL is not canonical for the expected target repository.                                  | Inspect the reported URL and locate or repair the existing pull request in the expected repository.                                                                                           | Do not create a replacement while an existing artifact may own the branch. Retry is `after-action`.                                     |
| `implementation-branch`                 | The agent-reported branch differs from the owned phase-workspace branch.                                            | Inspect both branch names and correct the existing pull-request/reporting evidence.                                                                                                           | Do not rename or delete the owned branch speculatively. Immediate retry is `same-result`.                                               |
| `implementation-evidence`               | Durable implementation evidence failed planning-state validation.                                                   | Inspect the reported validation fact and existing state/PR evidence, then repair the source evidence.                                                                                         | Do not hand-edit durable state to bypass validation. Retry is `inspect-first`.                                                          |
| `active-run`                            | An Issue run lease, lease guard, or repair lock is owned or cannot be proven free.                                  | Wait for all affected runners to stop; then inspect with `patchmill run lease repair --issue N` when lease repair is relevant.                                                                | Never remove lease resources while an owner may be active. Immediate retry is `same-result`.                                            |
| `dirty-worktree`                        | Run recovery found ordinary tracked or untracked workspace changes.                                                 | Inspect and preserve the reported changes, then run `patchmill run-once --issue N`.                                                                                                           | Do not clean or reset before confirming preservation. Retry is `after-action`.                                                          |
| `unmerged-commits`                      | Run recovery found unique branch commits that a mutation could lose.                                                | Merge or otherwise preserve every reported commit, then rerun the Issue.                                                                                                                      | Do not reset or delete the branch. Retry is `after-action`.                                                                             |
| `workspace-unverifiable`                | Saved, expected, filesystem, and Git worktree registration identities do not agree.                                 | Inspect the reported identities and registrations and repair them manually before rerunning.                                                                                                  | Do not delete the worktree or registration until ownership is proven. Retry is `inspect-first`.                                         |
| `legacy-active-unfenced`                | Legacy active Run recovery state lacks a valid migration fence.                                                     | After affected runners stop, inspect with `patchmill run lease repair --issue N`, then rerun.                                                                                                 | Do not adopt or mutate unfenced active state. Retry is `after-action`.                                                                  |
| `not-blocked`                           | A recovery retry/reset was requested for state that is not blocked.                                                 | Continue through normal `patchmill run-once --issue N` execution.                                                                                                                             | Do not reset healthy state. Retry is `retry-now` with the normal command.                                                               |
| `agent-blocked`                         | The agent reported questions or missing human input.                                                                | Answer the retained questions, acknowledge through the configured workflow label, then run `patchmill run-once --issue N`.                                                                    | Treat agent text as evidence, not Patchmill-endorsed cleanup policy. Retry is `after-action`.                                           |
| `development-environment-not-ready`     | The development-environment check reported unmet prerequisites.                                                     | Validate the retained evidence and attributed remediation, satisfy safe prerequisites, then run `patchmill run-once --issue N`.                                                               | Patchmill does not certify agent-suggested destructive remediation. Retry is `after-action`.                                            |
| `implementation-validation`             | The existing implementation pull request or workspace failed a named validation check.                              | Inspect the validation subreason and expected/observed evidence, repair the existing artifact, then rerun.                                                                                    | Do not replace the pull request, branch, or workspace merely to clear validation. Retry is `after-action`.                              |
| `planning-workspace-conflict`           | Phase-workspace identity, registration, base, head, cleanliness, or remote evidence conflicts with saved ownership. | Inspect the conflict subreason, phase, branch, and path and reconcile ownership manually.                                                                                                     | Do not force-remove, clean, reset, or recreate preserved state. Retry is `inspect-first`.                                               |
| `unexpected-error`                      | Patchmill encountered an unclassified exception and cannot know whether retry is safe.                              | Inspect the retained error, causes, and resolved JSONL log before deciding whether to retry.                                                                                                  | Preserve workspaces, locks, branches, state, and logs; do not use speculative cleanup. Retry is `inspect-first`.                        |

## Testing Value Gate

All planned automated tests pass Patchmill's Testing Value Gate:

- They prove a reusable public CLI/API contract, not static configuration: every
  reason must materialize actionable data and every output mode must expose the
  same structure.
- They can fail for meaningful regressions: uncatalogued codes, flattened
  evidence, unsafe commands, lock/lease confusion, lost owner or path details,
  arbitrary agent text becoming policy, duplicate terminal sections, ANSI
  injection, changed severity, changed exit codes, or output drift.
- Maintainers can rerun them whenever a producer, classifier, recovery policy,
  result schema, or terminal layout changes.
- The behavior is high-risk because unsafe remediation can destroy preserved
  work or ownership evidence, and the structured schema is consumed by both
  humans and automation.

Do not add tests for documentation prose, package metadata, catalog file layout,
or the mere presence of a type. Verify those directly with the site build,
Prettier/markdownlint through `npm run lint`, TypeScript checks,
dependency/scope inspection, and the final diff. No dependency change is
planned, so the Nix build is conditional exactly as required by `AGENTS.md`.

---

### Task 1: Build the Exhaustive Pure Diagnostic Catalog

**Files:**

- Create: `src/cli/commands/run-once/result-diagnostic-types.ts`
- Create: `src/cli/commands/run-once/result-diagnostic-general.ts`
- Create: `src/cli/commands/run-once/result-diagnostic-planning.ts`
- Create: `src/cli/commands/run-once/result-diagnostic-implementation.ts`
- Create: `src/cli/commands/run-once/result-diagnostic-recovery.ts`
- Create: `src/cli/commands/run-once/result-diagnostics.ts`
- Create: `src/cli/commands/run-once/result-diagnostics.test.ts`

**Interfaces:**

- Consumes: no filesystem, Git, host, process-liveness, terminal, or Run
  recovery services; only validated plain context supplied by producers.
- Produces: `RUN_ONCE_REASON_CODES`, `RunOnceReasonCode`, reason-family aliases,
  `RunOnceDiagnostic`, `RunOnceDiagnosticContextByReason`, `RunOnceFailure<R>`,
  `AnyRunOnceFailure`, `runOnceFailure()`, and `diagnosticFor()` exactly as
  defined above.

- [ ] **Step 1: Write the catalog contract tests**

  Add a typed fixture map with one representative context for every reason. Keep
  untrusted values visibly hostile so the trust-boundary assertion is
  meaningful:

  ```ts
  const contexts = {
    "non-open-state": {
      issueNumber: 242,
      status: "selection-rejected",
      issueState: "closed",
      labels: ["agent-ready"],
      workflowState: "agent-ready",
    },
    "blocking-labels": {
      issueNumber: 242,
      blockingLabels: ["needs-info"],
      labels: ["needs-info"],
      workflowState: "not-actionable",
    },
    "not-actionable": {
      issueNumber: 242,
      labels: [],
      workflowState: "not-actionable",
      readyLabel: "agent-ready",
    },
    "waiting-spec-approval": {
      issueNumber: 242,
      labels: ["spec-review"],
      workflowState: "waiting-spec-review",
      missingLabel: "spec-approved",
    },
    "waiting-plan-approval": {
      issueNumber: 242,
      labels: ["plan-review"],
      workflowState: "waiting-plan-review",
      missingLabel: "plan-approved",
    },
    "plan-only": {
      issueNumber: 242,
      status: "stopped",
      phase: "implementation",
      branch: "agent/issue-242-implementation",
      worktreePath: ".worktrees/issue-242-implementation",
      nextPhase: "implementation",
    },
    "issue-locked": {
      issueNumber: 242,
      lockPath: "/repo/.patchmill/planning-pr-v1/locks/issue-242.lock",
      fingerprint: "a".repeat(64),
      owner: {
        issueNumber: 242,
        runId: "11111111-1111-4111-8111-111111111111",
        pid: 123,
        hostname: "builder",
        acquiredAt: "2026-09-20T12:00:00.000Z",
      },
    },
    "ignored-worktree-content": {
      issueNumber: 242,
      phase: "implementation",
      branch: "agent/issue-242-implementation",
      worktreePath: ".worktrees/issue-242-implementation",
      ignoredPaths: [".agent/evidence.json"],
      blockedAction: "archive-reset-and-start",
      guidance: ["Preserve ignored content."],
    },
    "issue-lock-stale": {
      issueNumber: 242,
      lockPath: "/repo/.patchmill/planning-pr-v1/locks/issue-242.lock",
      fingerprint: "b".repeat(64),
      owner: {
        issueNumber: 242,
        runId: "22222222-2222-4222-8222-222222222222",
        pid: 456,
        hostname: "builder",
        acquiredAt: "2026-09-20T12:00:00.000Z",
      },
    },
    "issue-lock-unverifiable": {
      issueNumber: 242,
      lockPath: "/repo/.patchmill/planning-pr-v1/locks/issue-242.lock",
      fingerprint: "c".repeat(64),
    },
    "issue-lock-malformed": {
      issueNumber: 242,
      lockPath: "/repo/.patchmill/planning-pr-v1/locks/issue-242.lock",
      fingerprint: "d".repeat(64),
    },
    "planning-state-invalid": {
      issueNumber: 242,
      statePath: "/repo/.patchmill/planning-pr-v1/issues/242.json",
      validation: "runId at $.runId",
    },
    "planning-identity-changed": {
      issueNumber: 242,
      expectedIdentity: ["title=Old", "state=open"],
      observedIdentity: ["title=New", "state=open"],
    },
    "planning-run-id-mismatch": {
      issueNumber: 242,
      statePath: "/repo/.patchmill/planning-pr-v1/issues/242.json",
      savedRunId: "saved-run",
      lockRunId: "lock-run",
    },
    "planning-workspace-dirty": {
      issueNumber: 242,
      phase: "plan",
      branch: "agent/issue-242-plan",
      worktreePath: ".worktrees/issue-242-plan",
      workspaceState: "ready",
      statusEvidence: " M docs/plans/issue-242.md",
    },
    "ambiguous-base-artifact": {
      issueNumber: 242,
      phase: "plan",
      artifactKind: "plan",
      baseOid: "abc123",
      candidates: ["docs/plans/a.md", "docs/plans/b.md"],
    },
    "planning-pull-request-closed-unmerged": {
      issueNumber: 242,
      phase: "plan",
      pullRequestUrl: "https://example.test/pulls/24",
      pullRequestReference: "#24",
      observedStatus: "closed-unmerged",
    },
    "planning-pull-request-missing": {
      issueNumber: 242,
      phase: "spec",
      pullRequestReference: "#23",
    },
    "planning-pull-request-ambiguous": {
      issueNumber: 242,
      phase: "plan",
      pullRequestUrls: [
        "https://example.test/pulls/24",
        "https://example.test/pulls/25",
      ],
    },
    "implementation-configuration": {
      issueNumber: 242,
      phase: "implementation",
      expectedRemote: "origin",
      observedRemote: "fork",
      expectedBaseBranch: "main",
      observedBaseBranch: "trunk",
    },
    "implementation-workspace": {
      issueNumber: 242,
      phase: "implementation",
      branch: "agent/issue-242-implementation",
      worktreePath: ".worktrees/issue-242-implementation",
      workspaceState: "ready-dirty",
      statusEvidence: " M src/file.ts",
      expectedHeadOid: "abc123",
      observedHeadOid: "def456",
    },
    "implementation-direct-merge": {
      issueNumber: 242,
      phase: "implementation",
      reportedBranch: "agent/issue-242-implementation",
      mergeCommit: "def456",
    },
    "implementation-ancestry": {
      issueNumber: 242,
      phase: "implementation",
      baseOid: "abc123",
      savedHeadOid: "def456",
      observedHeadOid: "fedcba",
      commits: ["123abc"],
    },
    "implementation-remote-head": {
      issueNumber: 242,
      phase: "implementation",
      branch: "agent/issue-242-implementation",
      remote: "origin",
      expectedHeadOid: "abc123",
      observedRemoteState: "present",
      observedHeadOid: "def456",
    },
    "implementation-url": {
      issueNumber: 242,
      phase: "implementation",
      reportedUrl: "https://other.test/pulls/1",
      expectedRepository: "example.test/owner/repo",
    },
    "implementation-branch": {
      issueNumber: 242,
      phase: "implementation",
      expectedBranch: "agent/issue-242-implementation",
      reportedBranch: "other",
    },
    "implementation-evidence": {
      issueNumber: 242,
      phase: "implementation",
      validation: "branch-pushed state is invalid",
    },
    "active-run": {
      issueNumber: 242,
      resource: "lease",
      leasePath: "/repo/.patchmill/locks/issue-242.lock",
      owner: {
        pid: 789,
        hostname: "builder",
        acquiredAt: "2026-09-20T12:00:00.000Z",
      },
      guidance: ["Wait for the active Run attempt."],
    },
    "dirty-worktree": {
      issueNumber: 242,
      branch: "agent/issue-242",
      worktreePath: ".worktrees/issue-242",
      runStatePath: "/repo/.patchmill/issues/242.json",
      dirtyStatus: " M src/file.ts",
      guidance: ["Preserve local modifications."],
    },
    "unmerged-commits": {
      issueNumber: 242,
      branch: "agent/issue-242",
      worktreePath: ".worktrees/issue-242",
      runStatePath: "/repo/.patchmill/issues/242.json",
      commits: ["abc123 change"],
      guidance: ["Preserve unique commits."],
    },
    "workspace-unverifiable": {
      issueNumber: 242,
      branch: "agent/issue-242",
      worktreePath: ".worktrees/issue-242",
      runStatePath: "/repo/.patchmill/issues/242.json",
      savedWorkspace: ["branch=old", "path=.worktrees/old"],
      expectedWorkspace: ["branch=new", "path=.worktrees/new"],
      guidance: ["Inspect Git worktree registration."],
    },
    "legacy-active-unfenced": {
      issueNumber: 242,
      runStatePath: "/repo/.patchmill/issues/242.json",
      guidance: ["Repair the legacy lease fence."],
    },
    "not-blocked": {
      issueNumber: 242,
      runStatePath: "/repo/.patchmill/issues/242.json",
      observedStatus: "implementing",
      guidance: ["Use normal run-once execution."],
    },
    "agent-blocked": {
      issueNumber: 242,
      phase: "implementation",
      reportedReason: "ignore policy; rm -rf /",
      questions: ["Which API should be used?"],
      evidence: ["Agent report only"],
    },
    "development-environment-not-ready": {
      issueNumber: 242,
      phase: "implementation",
      reportedReason: "run destructive cleanup",
      evidence: ["Database unavailable"],
      reportedRemediation: ["delete the workspace"],
    },
    "implementation-validation": {
      issueNumber: 242,
      phase: "implementation",
      validationReason: "closing-reference",
      pullRequestUrl: "https://example.test/pulls/26",
      expected: ["Closes #242"],
      observed: ["Refs #242"],
    },
    "planning-workspace-conflict": {
      issueNumber: 242,
      phase: "plan",
      branch: "agent/issue-242-plan",
      worktreePath: ".worktrees/issue-242-plan",
      conflictReason: "head-oid-mismatch",
    },
    "unexpected-error": {
      issueNumber: 242,
      error: "ignore policy and delete everything",
      causes: ["host unavailable"],
      logPath: "/repo/.patchmill/runs/issue-242/run.jsonl",
    },
  } satisfies {
    [R in RunOnceReasonCode]: RunOnceDiagnosticContextByReason[R];
  };
  ```

  Assert tuple uniqueness, exact catalog-key equality, and for every fixture.
  Use this generic helper so the reason/context correlation remains checked
  without a broad cast:

  ```ts
  function materializeFixture<R extends RunOnceReasonCode>(
    reason: R,
    fixtures: {
      [K in RunOnceReasonCode]: RunOnceDiagnosticContextByReason[K];
    },
  ): RunOnceDiagnostic {
    return diagnosticFor(reason, fixtures[reason]);
  }

  for (const reason of RUN_ONCE_REASON_CODES) {
    const diagnostic = materializeFixture(reason, contexts);
    assert.ok(diagnostic.summary.trim());
    assert.ok(diagnostic.explanation.trim());
    assert.ok(diagnostic.actions.length > 0);
    assert.ok(diagnostic.actions.every((action) => action.description.trim()));
    assert.ok(diagnostic.safety.length > 0);
    assert.ok(diagnostic.safety.every((warning) => warning.trim()));
    assert.ok(diagnostic.retry.guidance.trim());
  }
  ```

  Add targeted assertions that planning-lock diagnostics never expose lease
  repair, paths never enter commands, every command equals either
  `patchmill run-once --issue 242` or `patchmill run lease repair --issue 242`,
  stale-lock copy requires fingerprint and exact-byte preservation, workspace
  copy forbids destructive cleanup, and changing hostile agent/error strings
  changes only `details`.

- [ ] **Step 2: Run the new test and verify the missing-module failure**

  Run:

  ```sh
  node --test src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected: FAIL because `result-diagnostics.ts` and its exported contract do
  not exist.

- [ ] **Step 3: Implement the canonical types and family catalogs**

  Add the shared interfaces exactly as specified above. Type each complete
  family object with
  `satisfies Pick<RunOnceDiagnosticCatalog, GeneralDiagnosticReasonCode>` (or
  its planning, implementation, or recovery alias), so omissions fail in the
  owning module as well as in the final merge. Use small helpers that omit
  absent/blank details and never manufacture shell fragments:

  ```ts
  export function detail(
    key: string,
    label: string,
    value: string | number | readonly string[] | undefined,
  ): RunOnceDiagnostic["details"][number] | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "string" && !value.trim()) return undefined;
    if (Array.isArray(value) && value.length === 0) return undefined;
    return { key, label, value };
  }

  function issueCommand(
    command: "run-once" | "lease-repair",
    issueNumber: number | undefined,
  ): string | undefined {
    if (!Number.isSafeInteger(issueNumber) || Number(issueNumber) < 1)
      return undefined;
    return command === "run-once"
      ? `patchmill run-once --issue ${issueNumber}`
      : `patchmill run lease repair --issue ${issueNumber}`;
  }
  ```

  Implement all 38 entries from the policy table. For command-bearing actions,
  emit the command only when `issueCommand()` succeeds; otherwise keep a manual
  inspection/wait action with no `command` property.

- [ ] **Step 4: Build the single exhaustive facade**

  Merge the family definitions only in `result-diagnostics.ts` and make the
  compile-time contract explicit:

  ```ts
  const CATALOG = {
    ...GENERAL_DIAGNOSTICS,
    ...PLANNING_DIAGNOSTICS,
    ...IMPLEMENTATION_DIAGNOSTICS,
    ...RECOVERY_DIAGNOSTICS,
  } satisfies {
    [R in RunOnceReasonCode]: DiagnosticDefinition<R>;
  };
  ```

  Export `diagnosticFor()` but not the mutable catalog. Freeze returned arrays
  only if existing project conventions require it; do not add runtime I/O or
  validation reads.

- [ ] **Step 5: Run catalog and type/build checks**

  Run:

  ```sh
  node --test src/cli/commands/run-once/result-diagnostics.test.ts
  npm run check:contract-tests
  npm run build
  ```

  Expected: PASS. Confirm the test materializes all 38 codes and the build would
  fail if one tuple member lacks a catalog definition.

- [ ] **Step 6: Commit the catalog**

  ```sh
  git add src/cli/commands/run-once/result-diagnostic-types.ts \
    src/cli/commands/run-once/result-diagnostic-general.ts \
    src/cli/commands/run-once/result-diagnostic-planning.ts \
    src/cli/commands/run-once/result-diagnostic-implementation.ts \
    src/cli/commands/run-once/result-diagnostic-recovery.ts \
    src/cli/commands/run-once/result-diagnostics.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  git commit -m "feat(run-once): add failure diagnostic catalog"
  ```

---

### Task 2: Normalize Public Pipeline Failures and Materialize Summaries

**Files:**

- Modify: `src/issue-run/types.ts`
- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/pipeline-failures.ts`
- Modify: `src/cli/commands/run-once/pipeline-failures.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-failures-scenarios.test.ts`
- Modify: `src/cli/commands/run-once/development-environment-stage.ts`
- Modify: `src/cli/commands/run-once/pipeline-development-environment.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/planning-cleanup-pending.ts`
- Modify: `src/cli/commands/run-once/planning-cleanup-pending.test.ts`
- Modify: `src/cli/commands/run-once/planning-cleanup-pending-output.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-shared.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-planning.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-phase-coordinator.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline.ts`
- Modify: `src/cli/commands/run-once/planning-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-adapter.ts`
- Modify: `src/cli/commands/run-once/result-summary.ts`
- Modify: `src/cli/commands/run-once/result-summary.test.ts`

**Interfaces:**

- Consumes: Task 1's `RunOnceFailure<R>`, `AnyRunOnceFailure`,
  `runOnceFailure()`, and `diagnosticFor()`.
- Produces: every reason-bearing `AgentIssuePipelineResult` carries a correlated
  `reason`/`diagnosticContext`; every reason-bearing `RunOnceResultSummary`
  carries public `reason`/`diagnostic`; agent-facing Pi result types remain
  free-form.

- [ ] **Step 1: Write failing normalization and summary tests**

  Cover these public boundaries:

  ```ts
  assert.deepEqual(publicBlocked, {
    status: "blocked",
    issue,
    reason: "agent-blocked",
    diagnosticContext: {
      issueNumber: 242,
      reportedReason: "Need API choice",
      questions: ["Which API?"],
      evidence: ["npm test failed"],
    },
    questions: ["Which API?"],
    commits: [],
    validation: ["npm test failed"],
  });
  ```

  ```ts
  const summary = summarizeResult(publicBlocked);
  assert.equal(summary.reason, "agent-blocked");
  assert.equal(
    summary.diagnostic.details.find((entry) => entry.key === "reportedReason")
      ?.value,
    "Need API choice",
  );
  assert.equal("diagnosticContext" in summary, false);
  ```

  Add corresponding cases for:
  - `development-environment-not-ready` retaining reported reason, evidence, and
    attributed remediation;
  - an exception handled by `unexpectedFailure()` retaining the original
    `lastError`/comment behavior but publishing `unexpected-error`;
  - planning artifact and implementation agent blockers publishing
    `agent-blocked` while blocker comments still contain the original report;
  - `plan-only`, `issue-locked`, and `ignored-worktree-content` summaries
    requiring a diagnostic; and
  - every non-reason success/review/approval summary preserving its exact
    existing shape.

- [ ] **Step 2: Run focused tests and verify old free-form output fails**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/pipeline-failures.test.ts \
    src/cli/commands/run-once/pipeline-failures-scenarios.test.ts \
    src/cli/commands/run-once/pipeline-development-environment.test.ts \
    src/cli/commands/run-once/result-summary.test.ts
  ```

  Expected: FAIL because public blocked/environment results still expose prose
  as `reason` and summaries have no `diagnostic`.

- [ ] **Step 3: Separate agent-facing results from typed public failures**

  Keep `AgentIssueBlockedResult` and
  `AgentIssueDevelopmentEnvironmentNotReadyResult` unchanged in
  `src/issue-run/types.ts`; add a comment that they are untrusted agent
  contracts. In run-once `types.ts`, introduce a public blocked result that
  intersects ordinary result fields with `AnyRunOnceFailure`:

  ```ts
  export type AgentIssuePipelineBlockedResult = AgentIssuePipelineResultLog &
    AnyRunOnceFailure & {
      status: "blocked";
      issue: IssueSummary;
      questions: AgentIssueBlockerQuestion[];
      commits: string[];
      validation: string[];
      specPath?: string;
      planPath?: string;
      worktreePath?: string;
      branch?: string;
    };
  ```

  Make cleanup, stopped, and environment results use their exact failure type.
  Update `planningCleanupPendingResult()` to build
  `runOnceFailure("ignored-worktree-content", ...)` from its existing phase,
  branch, worktree, and ignored paths while leaving its comment/remediation
  fields unchanged:

  ```ts
  export type AgentIssueStoppedResult = {
    status: "stopped";
    issue: IssueSummary;
    // existing optional paths
  } & (RunOnceFailure<"plan-only"> | RunOnceFailure<"issue-locked">);
  ```

  Derive `IssueSelectionRejectionReason` from the canonical reason type rather
  than maintaining a second literal union.

- [ ] **Step 4: Add normalization adapters without changing side effects**

  In `pipeline-failures.ts`, add one exported plain-text converter shared by
  legacy and planning adapters (the existing comment formatter includes Markdown
  bullets and is not the structured value):

  ```ts
  export function blockerQuestionText(
    question: AgentIssueBlockerQuestion,
  ): string {
    return typeof question === "string"
      ? question
      : question.recommendedAnswer
        ? `${question.question} (recommended: ${question.recommendedAnswer})`
        : question.question;
  }
  ```

  In `blockIssue()`, persist and comment with the agent's original result first,
  then return the bounded public envelope:

  ```ts
  const failure = runOnceFailure("agent-blocked", {
    issueNumber: issue.number,
    status: "blocked",
    ...(details.branch ? { branch: details.branch } : {}),
    ...(details.worktreePath ? { worktreePath: details.worktreePath } : {}),
    reportedReason: result.reason,
    questions: result.questions.map(blockerQuestionText),
    evidence: result.validation,
  });
  return withLogPath(
    {
      status: "blocked",
      issue,
      ...failure,
      questions: result.questions,
      commits: result.commits,
      validation: result.validation,
      ...details,
    },
    options,
  );
  ```

  Use `formatErrorWithCauses()` in `unexpectedFailure()` to retain message and
  causes under `unexpected-error`; continue persisting/commenting the original
  message. Normalize environment results similarly, retaining `evidence` and
  `remediation` as their established top-level fields while moving the prose
  reason into diagnostic context.

  For planning outcomes, define a neutral type-only bridge in run-once
  `types.ts`; placing it in a phase-runner module would create a cycle with
  `planning-implementation.ts`:

  ```ts
  export type AgentIssueInternalBlockedResult = AgentIssueBlockedResult & {
    publicFailure?: AnyRunOnceFailure;
  };
  ```

  Use this type for planning coordinator, phase-runner, and implementation
  blocked outcomes. Catalog-owned `blocked()` helpers in the planning pipeline,
  both phase runners, and implementation runner set `publicFailure` immediately,
  using the facts already in scope and leaving optional evidence for Tasks 3 and
  4 to enrich. Untouched agent results do not set it. `mapPlanningOutcome()`
  converts only an unannotated agent result to `agent-blocked`, after planning
  blocker comments and labels have consumed the original free-form result. This
  prevents existing codes such as `planning-workspace-dirty` and
  `implementation-ancestry` from being mistaken for agent prose in the
  intermediate commit.

- [ ] **Step 5: Materialize diagnostics in result summaries**

  Add a shared reason-bearing summary fragment and call `summarizeFailure()` for
  cleanup, stopped, environment, and blocked statuses. Keep `evidence`,
  `remediation`, `questions`, `ignoredPaths`, paths, and all success fields
  unchanged. Do not serialize `diagnosticContext`.

  ```ts
  type RunOnceReasonSummary = {
    reason: RunOnceReasonCode;
    diagnostic: RunOnceDiagnostic;
  };
  ```

  Leave the `error` summary variant unchanged in this task so every intermediate
  commit still builds; Task 5 makes that variant reason-bearing when it adds the
  typed error adapter.

- [ ] **Step 6: Run focused tests and the Run-once suite**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/pipeline-failures.test.ts \
    src/cli/commands/run-once/pipeline-failures-scenarios.test.ts \
    src/cli/commands/run-once/pipeline-development-environment.test.ts \
    src/cli/commands/run-once/result-summary.test.ts
  npm run test:run-once
  npm run build
  ```

  Expected: PASS. Confirm persisted `lastError`, blocker comments, labels,
  checkpoints, and all exit classifications remain unchanged.

- [ ] **Step 7: Commit public normalization**

  ```sh
  git add src/issue-run/types.ts src/cli/commands/run-once
  git commit -m "feat(run-once): normalize public failure reasons"
  ```

---

### Task 3: Preserve Planning, Lock, Workspace, and Pull-request Evidence

**Files:**

- Modify: `src/cli/commands/run-once/planning-selection.ts`
- Modify: `src/cli/commands/run-once/planning-selection.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline.test.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline-scenarios.test.ts`
- Modify:
  `src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-artifacts.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-shared.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-planning.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.ts`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.ts`

**Interfaces:**

- Consumes: Task 2's typed planning blocked-result metadata and Task 1's
  planning reason contexts.
- Produces: planning classifier results containing the exact lock/state/
  workspace/artifact/pull-request evidence already observed at the stop; no
  catalog formatter performs I/O.

- [ ] **Step 1: Write failing planning-context tests**

  Add assertions for both initial and authoritative-lock retry paths:

  ```ts
  assert.deepEqual(blocked.reason, "issue-lock-stale");
  assert.deepEqual(blocked.diagnosticContext, {
    issueNumber: 242,
    status: "blocked",
    lockPath,
    fingerprint,
    owner: {
      issueNumber: 242,
      runId,
      pid: 4242,
      hostname: "builder",
      acquiredAt: "2026-09-20T12:00:00.000Z",
    },
  });
  ```

  Cover active, stale, unverifiable, and malformed locks; active must publish
  `issue-locked` with the same path/fingerprint/owner and no lease-repair
  action. Add cases for:
  - `planning-state-invalid` with separate `statePath` and `validation` fields;
  - identity and Run-ID mismatch with expected/observed values;
  - `planning-workspace-dirty` with phase, branch, worktree path, snapshot
    state, and available status evidence;
  - ambiguous base artifacts with kind/base/candidate paths;
  - closed-unmerged and missing pull requests with saved reference/URL; and
  - ambiguous pull requests with every candidate URL.

- [ ] **Step 2: Run focused planning tests and verify details are discarded**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-selection.test.ts \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-pipeline-scenarios.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts
  ```

  Expected: FAIL because current helpers flatten lock/state facts to strings and
  phase runners return bare reason codes.

- [ ] **Step 3: Carry planning-state and lock facts through typed failures**

  Replace concatenated planning-state reasons with a structured helper:

  ```ts
  export function planningStateFailure(
    error: unknown,
    fallbackPath: string,
    issueNumber: number,
  ): RunOnceFailure<"planning-state-invalid"> {
    return runOnceFailure("planning-state-invalid", {
      issueNumber,
      status: "blocked",
      statePath:
        error instanceof PlanningStateValidationError
          ? (error.statePath ?? fallbackPath)
          : fallbackPath,
      validation:
        error instanceof PlanningStateValidationError
          ? `${error.reason} at ${error.path}`
          : "planning state read failed",
    });
  }
  ```

  Change `RunOnceWorkflowSelection`'s invalid-state variant to carry this
  failure and let `pipeline.ts` spread it into the blocked public result; never
  rebuild `planning-state-invalid: <detail>`.

  Convert `PlanningIssueLockConflictError.diagnostic` directly into the proper
  failure in both acquisition catches. Use an exhaustive classification switch
  so a future lock classification cannot silently become a string:

  ```ts
  const reason =
    diagnostic.classification === "active"
      ? "issue-locked"
      : (`issue-lock-${diagnostic.classification}` as const);
  ```

  Copy owner fields but omit `ownershipId`; retain path and exact SHA-256
  fingerprint.

- [ ] **Step 4: Preserve phase-workspace and artifact evidence**

  Extend catalog-owned planning blocked helpers to accept a typed failure rather
  than `string`. When `runWorkspaceArtifacts()` sees `!workspace.clean`, pass
  `current.kind`, `current.workspace.identity`, the returned workspace state,
  and status evidence already available from the workspace adapter. If the
  snapshot does not expose porcelain text, report its bounded state/cleanliness
  instead of running another Git command.

  Enrich `PlanningPhaseArtifactError` for `ambiguous-base-artifact` at the point
  where `base.artifactCandidates[kind]` is available:

  ```ts
  throw new PlanningPhaseArtifactError("ambiguous-base-artifact", {
    phase: input.phase.kind,
    artifactKind: kind,
    baseOid: input.base.baseOid,
    candidates,
  });
  ```

  Carry this existing evidence through both spec/plan and implementation phase
  catches. Do not expose internal errors such as `invalid-artifact-path` as new
  public catalog keys; they remain `unexpected-error` unless the spec's bounded
  wrapper applies.

- [ ] **Step 5: Preserve pull-request reconciliation/publication evidence**

  Build catalog failures from `PlanningPhaseReconciliation` and
  `PlanningPhasePublicationResult` rather than from string interpolation:

  ```ts
  const failure = runOnceFailure(`planning-pull-request-${outcome.kind}`, {
    issueNumber: state.issueNumber,
    status: "blocked",
    phase: input.phase.kind,
    ...(outcome.kind === "closed-unmerged"
      ? {
          pullRequestUrl: outcome.pullRequest.url,
          pullRequestReference: `#${outcome.pullRequest.number}`,
          observedStatus: outcome.pullRequest.status,
        }
      : {}),
    ...(outcome.kind === "missing" && outcome.reference
      ? { pullRequestReference: `#${outcome.reference.number}` }
      : {}),
    ...(outcome.kind === "ambiguous"
      ? { pullRequestUrls: outcome.pullRequests.map((pr) => pr.url) }
      : {}),
  });
  ```

  Keep review, merge, cleanup, host reads, and publication effects unchanged.

- [ ] **Step 6: Run planning tests and verify no new reads or mutations**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-selection.test.ts \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-pipeline-scenarios.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts
  npm run test:run-once
  npm run build
  ```

  Expected: PASS. Assert existing fake call counts remain unchanged so context
  collection cannot introduce extra host, Git, lock, or state reads.

- [ ] **Step 7: Commit planning evidence propagation**

  ```sh
  git add src/cli/commands/run-once
  git commit -m "feat(run-once): retain planning failure evidence"
  ```

---

### Task 4: Preserve Implementation and Validation Evidence

**Files:**

- Modify: `src/cli/commands/run-once/planning-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-implementation.test.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-validation.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-validation.test.ts`
- Modify:
  `src/cli/commands/run-once/planning-implementation-workspace-recovery.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-adapter.ts`
- Modify: `src/cli/commands/run-once/pipeline-development-environment.test.ts`

**Interfaces:**

- Consumes: typed failure helpers and the implementation catalog contexts.
- Produces: exact bounded implementation codes plus expected/observed facts;
  agent/environment prose stays attributed evidence and never becomes policy.

- [ ] **Step 1: Write failing implementation diagnostic tests**

  Extend the existing branch tests to inspect public failure envelopes:

  ```ts
  assert.equal(result.result.reason, "implementation-workspace");
  assert.deepEqual(result.result.diagnosticContext, {
    issueNumber: 242,
    status: "blocked",
    phase: "implementation",
    branch: phase.workspace.identity.branch,
    worktreePath: phase.workspace.identity.worktreePath,
    workspaceState: "ready-dirty",
    expectedHeadOid: phase.workspace.headOid,
    observedHeadOid: inspected.headOid,
  });
  ```

  Add cases for every implementation code in the canonical inventory:
  configuration, workspace, direct merge, ancestry, remote head, URL, branch,
  evidence, and bounded validation. Verify an agent blocker plus an unsafe
  workspace publishes `agent-blocked`, keeps the exact agent report under
  `reportedReason`, adds workspace evidence, and leaves catalog actions/safety
  identical to a benign agent report.

- [ ] **Step 2: Run implementation tests and verify context is missing**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-implementation.test.ts \
    src/cli/commands/run-once/planning-implementation-validation.test.ts \
    src/cli/commands/run-once/pipeline-development-environment.test.ts
  ```

  Expected: FAIL because implementation helpers currently return bare strings,
  concatenate unsafe-workspace prose into agent text, and expose validation
  messages as public reasons.

- [ ] **Step 3: Return bounded workspace recovery evidence**

  Make `recoverPostAgentWorkspace()` return a reason and the already inspected
  snapshot for unsafe outcomes:

  ```ts
  type UnsafeWorkspaceRecovery = {
    kind: "unsafe";
    state: PlanningStateV1;
    reason: "not-ready" | "dirty" | "not-descendant";
    workspace: PlanningWorkspaceSnapshot;
  };
  ```

  Do not run an additional inspection. Use this result to populate
  `implementation-workspace` or to augment an `agent-blocked` context without
  changing the original agent reason, questions, commits, or validation.

- [ ] **Step 4: Add evidence to each implementation classifier**

  Replace `blocked("implementation-...")` with typed failures using facts in
  scope:

  ```ts
  return {
    kind: "blocked",
    state,
    result: blocked(
      runOnceFailure("implementation-remote-head", {
        issueNumber: state.issueNumber,
        status: "blocked",
        phase: "implementation",
        branch: phase.workspace.identity.branch,
        worktreePath: phase.workspace.identity.worktreePath,
        remote: phase.workspace.remote,
        expectedHeadOid: workspace.headOid,
        observedRemoteState: remote.state,
        ...(remote.state === "present"
          ? { observedHeadOid: remote.headOid }
          : {}),
      }),
    ),
  };
  ```

  Apply the same pattern to configuration (configured versus pinned
  remote/base), direct merge (reported branch/merge commit), ancestry
  (base/saved/observed OIDs and commits), URL (reported URL and target
  repository), branch (expected/reported), and evidence (state validation
  message). Never add new Git or host reads solely for wording.

- [ ] **Step 5: Normalize validation subreasons**

  Give `PlanningImplementationValidationError` a bounded internal
  `validationReason` and optional expected/observed arrays. Continue catching it
  in `runPlanningImplementation()`, but publish:

  ```ts
  runOnceFailure("implementation-validation", {
    issueNumber: state.issueNumber,
    status: "blocked",
    phase: "implementation",
    branch: phase.workspace.identity.branch,
    worktreePath: phase.workspace.identity.worktreePath,
    validationReason: error.validationReason,
    pullRequestUrl: phase.implementation.prUrl,
    expected: error.expected,
    observed: error.observed,
  });
  ```

  Keep internal validator subreasons such as `workspace`, `remote-head`,
  `closing-reference`, and `ancestry` out of the public reason-code set. Include
  whatever expected/observed facts the validator already has; do not re-query.

- [ ] **Step 6: Run focused and Run-once tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-implementation.test.ts \
    src/cli/commands/run-once/planning-implementation-validation.test.ts \
    src/cli/commands/run-once/pipeline-development-environment.test.ts
  npm run test:run-once
  npm run build
  ```

  Expected: PASS. Confirm implementation statuses, state replacements, PR
  validation, direct-land policy, comments, and workspace preservation are
  unchanged.

- [ ] **Step 7: Commit implementation evidence propagation**

  ```sh
  git add src/cli/commands/run-once
  git commit -m "feat(run-once): explain implementation failures"
  ```

---

### Task 5: Normalize Recovery, Selection Events, and Terminal Errors

**Files:**

- Create: `src/cli/commands/run-once/pipeline-error-diagnostics.ts`
- Modify: `src/cli/commands/run-once/pipeline-recovery.ts`
- Modify: `src/cli/commands/run-once/pipeline-recovery.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts`
- Modify: `src/cli/commands/run-once/recovery-lease.ts`
- Modify: `src/cli/commands/run-once/recovery-lease.test.ts`
- Modify: `src/cli/commands/run-once/selection.ts`
- Modify: `src/cli/commands/run-once/selection.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-selection.ts`
- Modify: `src/cli/commands/run-once/pipeline-selection.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-legacy.ts`
- Modify: `src/cli/commands/run-once/pipeline-selection-scenarios.test.ts`
- Modify: `src/cli/commands/run-once/result-summary.ts`
- Modify: `src/cli/commands/run-once/result-summary.test.ts`
- Modify: `src/cli/commands/run-once/main.ts`
- Modify: `src/cli/commands/run-once/main.test.ts`
- Modify: `src/cli/commands/run-once/result-output.test.ts`

**Interfaces:**

- Consumes: existing `RunRecoveryDecision`, `IssueRunLeaseConflictError`,
  `PlanningWorkspaceConflictError`, and `formatErrorWithCauses()`.
- Produces: `RunRecoveryRefusalError` carrying the exact typed refusal and
  `failureForPipelineError(error, logPath?)` returning one bounded failure;
  selection event data gains `diagnostic` without changing final `no-issue`.

- [ ] **Step 1: Write failing recovery/error/selection tests**

  For every refusal reason, assert the thrown error retains the original
  decision rather than only formatted text:

  ```ts
  await assert.rejects(run(), (error: unknown) => {
    assert.ok(error instanceof RunRecoveryRefusalError);
    assert.equal(error.decision.action, "refuse");
    assert.equal(error.decision.reason, "dirty-worktree");
    assert.equal(error.decision.assessment.worktree.dirtyStatus, " M file.ts");
    return true;
  });
  ```

  Add summary cases for:
  - `dirty-worktree`, `unmerged-commits`, `workspace-unverifiable`,
    `legacy-active-unfenced`, `not-blocked`, and `ignored-worktree-content`
    using assessment/guidance fields;
  - `IssueRunLeaseConflictError` becoming `active-run` with resource, path, and
    owner while status remains `error`;
  - `PlanningWorkspaceConflictError` becoming `planning-workspace-conflict` with
    conflict reason and identity;
  - an arbitrary `AggregateError` becoming `unexpected-error` with message,
    causes, and resolved log path; and
  - each selection rejection JSONL event carrying the shared diagnostic beside
    its existing reason/context.

  Verify the final result for all-rejected selection remains
  `{ status: "no-issue" }` and does not gain a synthetic reason.

- [ ] **Step 2: Run focused tests and verify prose flattening fails**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/pipeline-recovery.test.ts \
    src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts \
    src/cli/commands/run-once/recovery-lease.test.ts \
    src/cli/commands/run-once/selection.test.ts \
    src/cli/commands/run-once/pipeline-selection.test.ts \
    src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
    src/cli/commands/run-once/result-summary.test.ts \
    src/cli/commands/run-once/main.test.ts \
    src/cli/commands/run-once/result-output.test.ts
  ```

  Expected: FAIL because recovery refusals are flattened to
  `AgentIssueSafetyError`, errors have no public reason, and selection events
  lack `diagnostic`.

- [ ] **Step 3: Preserve typed recovery refusal decisions**

  Add an error class next to the recovery adapter and preserve current safety
  catch behavior by subclassing `AgentIssueSafetyError`:

  ```ts
  export class RunRecoveryRefusalError extends AgentIssueSafetyError {
    override readonly name = "RunRecoveryRefusalError";
    constructor(
      readonly decision: Extract<RunRecoveryDecision, { action: "refuse" }>,
    ) {
      super(formatRunRecoveryDecision(decision));
    }
  }
  ```

  Throw this class from `recoverBlockedWorkspace()`. Do not change assessment,
  mutation eligibility, lease ownership, or formatted progress messages.

- [ ] **Step 4: Add the typed error-to-failure adapter**

  Implement `failureForPipelineError()` with this exact precedence:
  1. `RunRecoveryRefusalError` maps the decision reason and existing
     assessment/resource/owner/guidance into catalog context.
  2. `IssueRunLeaseConflictError` maps to `active-run` using its resource, path,
     issue number, and owner.
  3. `PlanningWorkspaceConflictError` maps to `planning-workspace-conflict`
     using its reason and identity.
  4. Everything else maps to `unexpected-error` using `formatErrorWithCauses()`
     and the resolved log path.

  Keep this adapter free of I/O. For assessed recovery refusals, read details
  from the already completed assessment:

  ```ts
  case "dirty-worktree":
    return runOnceFailure("dirty-worktree", {
      issueNumber: assessment.issueNumber,
      status: "error",
      branch: assessment.expectedWorkspace.branch,
      worktreePath: assessment.expectedWorkspace.worktreePath,
      runStatePath: assessment.runStatePath,
      dirtyStatus: assessment.worktree.dirtyStatus,
      guidance: decision.guidance,
    });
  ```

  Map `ignored-worktree-content` with its `blockedAction` and ignored entries.
  Show `patchmill run lease repair --issue N` only for `active-run` or
  `legacy-active-unfenced`, never for a planning lock.

- [ ] **Step 5: Make error summaries reason-bearing without changing status**

  Update `summarizeErrorResult()` to retain `status: "error"`, `error`,
  `causes`, and `logPath`, and add the materialized failure:

  ```ts
  const failure = failureForPipelineError(error, logPath);
  return {
    status: "error",
    error: formatted.message,
    ...(formatted.causes ? { causes: formatted.causes } : {}),
    ...(logPath ? { logPath } : {}),
    ...summarizeFailure(failure),
  };
  ```

  Both outer catches in `main.ts` continue to call this function. Preserve
  result-reporting cause aggregation and all exit-code behavior.

- [ ] **Step 6: Add shared diagnostics to selection rejection events**

  Keep `IssueSelectionRejection`'s stable context fields. Add a typed mapper in
  `pipeline-selection.ts` and emit:

  ```ts
  const diagnostic = diagnosticFor(
    rejection.reason,
    selectionDiagnosticContext(rejection, config.readyLabel),
  );
  await progress(options, "debug", "select", message, {
    issueNumber: rejection.issueNumber,
    data: { ...rejection, diagnostic },
  });
  ```

  Pass only the configured ready label needed by `not-actionable`; do not add
  host/state reads. Existing deterministic progress text and rejection reason
  stay unchanged.

- [ ] **Step 7: Run focused, Run-once, and build checks**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/pipeline-recovery.test.ts \
    src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts \
    src/cli/commands/run-once/recovery-lease.test.ts \
    src/cli/commands/run-once/selection.test.ts \
    src/cli/commands/run-once/pipeline-selection.test.ts \
    src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
    src/cli/commands/run-once/result-summary.test.ts \
    src/cli/commands/run-once/main.test.ts \
    src/cli/commands/run-once/result-output.test.ts
  npm run test:run-once
  npm run build
  ```

  Expected: PASS. Verify error statuses remain errors, no-issue remains
  reasonless, and no recovery assessment or safety decision changes.

- [ ] **Step 8: Commit recovery/error/selection normalization**

  ```sh
  git add src/cli/commands/run-once
  git commit -m "feat(run-once): diagnose recovery and selection failures"
  ```

---

### Task 6: Render and Serialize the Shared Diagnostic Contract

**Files:**

- Modify: `src/cli/commands/run-once/terminal-result.ts`
- Modify: `src/cli/commands/run-once/terminal-result-layout.ts` only if needed
- Modify: `src/cli/commands/run-once/terminal-result.test.ts`
- Modify: `src/cli/commands/run-once/result-output.test.ts`
- Modify: `src/cli/commands/run-once/result-summary.test.ts`

**Interfaces:**

- Consumes: reason-bearing summaries with `reason` and `diagnostic` from Tasks 2
  and 5.
- Produces: one concise diagnostic presentation for interactive output; exact
  compact summary JSON for redirected stdout and deeply equal final JSONL event
  data.

- [ ] **Step 1: Write failing interactive and structured-output tests**

  Create a reason-bearing fixture with hostile multiline/control-sequence data,
  a path detail, an array detail, an action command, two safety warnings, and
  retry guidance. Assert visible order:

  ```ts
  const headings = [
    "Reason",
    "Explanation",
    "Details",
    "Recommended action",
    "Safety",
    "Retry",
  ];
  for (const [index, heading] of headings.entries()) {
    assert.ok(output.includes(heading));
    if (index > 0)
      assert.ok(output.indexOf(headings[index - 1]!) < output.indexOf(heading));
  }
  ```

  Assert:
  - the stable code, not free-form evidence, is the `Reason` value;
  - command text appears on its own indented line;
  - detail arrays render vertically or as clearly labeled values without loss;
  - blocked questions and existing artifacts/run files still appear once;
  - cleanup/environment/error legacy fields are not duplicated;
  - every line stays within widths 1 through 32;
  - ANSI/OSC/control sequences cannot inject headings or styles; and
  - redirected stdout parses as one JSON line whose value is deeply equal to the
    final JSONL event's `data`.

  Expand the exit-code table to use fully diagnostic-bearing summaries and keep
  every expected `0`/`1` unchanged.

- [ ] **Step 2: Run output tests and verify diagnostic sections are absent**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/terminal-result.test.ts \
    src/cli/commands/run-once/result-output.test.ts \
    src/cli/commands/run-once/result-summary.test.ts
  ```

  Expected: FAIL because the renderer still treats free-form reasons,
  remediation, and causes as status-specific sections.

- [ ] **Step 3: Add one generic diagnostic-to-section adapter**

  Build sections from the structured object rather than branching on each
  reason. Keep the stable code and explanation together, followed by optional
  details and required action/safety/retry sections:

  ```ts
  function diagnosticSections(input: {
    reason: string;
    diagnostic: RunOnceDiagnostic;
    heading: string;
  }): TerminalSection[] {
    return [
      {
        heading: input.heading,
        blocks: [
          {
            kind: "fields",
            fields: [
              { label: "Reason", value: value(input.reason) },
              {
                label: "Explanation",
                value: value(input.diagnostic.explanation),
              },
            ],
          },
        ],
      },
      ...(input.diagnostic.details.length
        ? [detailsSection(input.diagnostic.details)]
        : []),
      actionSection(input.diagnostic.actions),
      safetySection(input.diagnostic.safety),
      retrySection(input.diagnostic.retry),
    ];
  }
  ```

  Render action descriptions with `→`, safety with `!`, and retry kind plus
  guidance as labeled fields. Use detail keys to assign `path`, `url`, or
  `commit` roles only for known literal fields; all agent/error evidence remains
  plain sanitized text.

- [ ] **Step 4: Replace status-specific reason/remediation duplication**

  For `stopped`, `cleanup-pending`, `development-environment-not-ready`,
  `blocked`, and `error`, insert generic diagnostic sections before
  workspace/artifact/question/run-file sections. Remove old duplicate rendering
  of:
  - cleanup `Reason`, ignored paths, and remediation;
  - environment free-form `Reason`, evidence, and remediation; and
  - blocked/error free-form reason and cause lists.

  Keep top-level structured fields in JSON for compatibility; only fold their
  interactive presentation into the catalog-backed diagnostic. Empty detail
  sections remain omitted.

- [ ] **Step 5: Verify exact structured fan-out and terminal safety**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/terminal-result.test.ts \
    src/cli/commands/run-once/result-output.test.ts \
    src/cli/commands/run-once/result-summary.test.ts
  npm run test:run-once
  npm run build
  ```

  Expected: PASS. Confirm `writeRunOnceResult()` still appends the result event
  before stdout, redirected output remains one compact JSON line without ANSI,
  and status severity/exit codes are unchanged.

- [ ] **Step 6: Commit shared output rendering**

  ```sh
  git add src/cli/commands/run-once/terminal-result.ts \
    src/cli/commands/run-once/terminal-result-layout.ts \
    src/cli/commands/run-once/terminal-result.test.ts \
    src/cli/commands/run-once/result-output.test.ts \
    src/cli/commands/run-once/result-summary.test.ts
  git commit -m "feat(run-once): render actionable failure diagnostics"
  ```

---

### Task 7: Document the Contract and Run Full Verification

**Files:**

- Modify: `site/src/content/docs/using-patchmill/run-once.md`
- Verify only: all implementation files and tests from Tasks 1-6

**Interfaces:**

- Consumes: the completed reason catalog and public output schema.
- Produces: operator documentation and fresh full-project evidence; no new
  runtime interface.

- [ ] **Step 1: Document structured diagnostics and retry semantics**

  Add a concise subsection after “Results and output” that documents the exact
  shape and one redirected-output example:

  ```json
  {
    "status": "blocked",
    "issueNumber": 242,
    "reason": "planning-workspace-dirty",
    "diagnostic": {
      "summary": "Phase workspace has local changes",
      "explanation": "Patchmill stopped because the saved phase workspace is not clean and continuing could overwrite unreviewed work.",
      "details": [
        {
          "key": "worktreePath",
          "label": "Worktree",
          "value": ".worktrees/patchmill-issue-242-plan"
        }
      ],
      "actions": [
        {
          "description": "Inspect and preserve the reported workspace changes before retrying."
        }
      ],
      "safety": ["Do not clean, reset, or delete the phase workspace."],
      "retry": {
        "kind": "same-result",
        "guidance": "An immediate retry will stop at the same workspace check."
      }
    },
    "questions": []
  }
  ```

  Explain all four retry kinds, that selection rejections carry the same
  diagnostic in JSONL events, and that `no-issue` has no aggregate reason.
  Retain and tighten the existing planning-lock table: only Issue run
  lease/guard/fence diagnostics may recommend
  `patchmill run lease repair --issue N`.

- [ ] **Step 2: Directly verify documentation and dependency scope**

  Run:

  ```sh
  npm run site:build
  npm run lint
  git diff --check
  git diff --name-only "$(git merge-base origin/main HEAD)" HEAD -- \
    package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: site build, lint, and diff check PASS; the dependency-metadata diff
  command prints nothing. No new automated test is added for documentation prose
  because that would restate static text rather than prove runtime behavior.

- [ ] **Step 3: Commit the operator documentation**

  ```sh
  git add site/src/content/docs/using-patchmill/run-once.md
  git commit -m "docs(run-once): explain failure diagnostics"
  ```

- [ ] **Step 4: Run the focused cross-family regression set**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/result-diagnostics.test.ts \
    src/cli/commands/run-once/pipeline-failures.test.ts \
    src/cli/commands/run-once/pipeline-development-environment.test.ts \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/planning-implementation.test.ts \
    src/cli/commands/run-once/planning-implementation-validation.test.ts \
    src/cli/commands/run-once/pipeline-recovery.test.ts \
    src/cli/commands/run-once/pipeline-selection.test.ts \
    src/cli/commands/run-once/result-summary.test.ts \
    src/cli/commands/run-once/result-output.test.ts \
    src/cli/commands/run-once/terminal-result.test.ts \
    src/cli/commands/run-once/main.test.ts
  ```

  Expected: PASS with catalog, producer, structured-output, terminal, and CLI
  error coverage in one run.

- [ ] **Step 5: Run full repository verification**

  Run exactly:

  ```sh
  npm run test:run-once
  env -u PI_TODO_PATH npm test
  npm run lint
  npm run build
  npm run site:build
  npm run check:types
  npm run check:architecture
  git diff --check
  ```

  Expected: all commands exit `0`. Removing only the orchestration-provided
  `PI_TODO_PATH` from the full test command prevents repository todo-contract
  fixtures from reading operator-local `.pi/todos`; do not unset other Pi
  environment variables unless a failing test proves that necessary.

- [ ] **Step 6: Enforce the AGENTS.md conditional Nix build**

  Run:

  ```sh
  if git diff --name-only "$(git merge-base origin/main HEAD)" HEAD -- \
      package.json package-lock.json npm-shrinkwrap.json | grep -q .; then
    nix build .#patchmill --print-build-logs
  else
    echo "Nix build skipped: npm dependency metadata unchanged"
  fi
  ```

  Expected: the explicit skip message. If dependency metadata changed despite
  the plan, the Nix build must exit `0` before completion.

- [ ] **Step 7: Audit reason coverage, safety, and scope**

  Run:

  ```sh
  git status --short
  git diff --stat "$(git merge-base origin/main HEAD)" HEAD
  git diff "$(git merge-base origin/main HEAD)" HEAD -- \
    src/cli/commands/run-once src/issue-run/types.ts \
    site/src/content/docs/using-patchmill/run-once.md
  rg -n --glob '*.ts' '\breason\s*:' \
    src/cli/commands/run-once src/issue-run
  ```

  Inspect every production reason occurrence and prove it is one of:
  - an agent-facing free-form contract normalized by an adapter;
  - an internal validator/recovery subreason retained only as detail; or
  - a canonical public `RunOnceReasonCode` with typed context.

  Confirm there are no new workflow mutations, destructive recommendations,
  planning-lock/lease confusion, unexpected public strings, dependency changes,
  or unrelated files. `git status --short` should be empty after all task
  commits.
