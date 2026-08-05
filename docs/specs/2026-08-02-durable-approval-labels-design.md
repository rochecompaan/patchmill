# Durable Workflow Approval Labels Design

## Summary

Patchmill will treat `spec-approved` and `plan-approved` as durable statements
about the current specification and implementation plan. It will no longer
consume those labels merely because `run-once` advances to a later workflow
stage.

Patchmill will not remove approval labels automatically. When an approval label
is present, the corresponding artifact must resolve and be reused. If it is
missing or ambiguous, `run-once` will fail safely without invoking Pi or
changing labels. Active run state, rather than the absence of an approval label,
will control implementation resume behavior.

## Problem

The current workflow models approval labels as actionable state tokens. Before
implementation, `run-once` removes all ready, review, and approval labels while
retaining `in-progress`. A normal implementation run can therefore change:

```text
spec-review + spec-approved -> in-progress
```

If implementation then fails unexpectedly, the saved run remains resumable.
Selection correctly finds the `in-progress` issue, but planning-stage
advancement checks the issue's current labels again. Because Patchmill removed
`spec-approved`, the resumed run stops at `spec-review` and removes
`in-progress`. A human must reapply an approval that Patchmill had already
validated.

The same defect applies to `plan-approved` when plan approval is required.

This behavior makes approval history misleading and couples recovery to labels
that Patchmill deliberately destroyed. Existing unexpected-failure tests do not
expose the defect because they use the default configuration, where spec and
plan approvals are disabled.

## Goals

- Preserve valid spec and plan approvals through claim, implementation,
  unexpected failure, resume, and successful completion.
- Never remove an approval label automatically.
- Require an approved artifact to resolve uniquely and reuse it rather than
  creating a replacement.
- Reject contradictory approval and artifact state without invoking Pi or
  changing labels.
- Resume an authorized implementation without reevaluating completed approval
  gates.
- Keep automatic selection correct when a durable earlier-stage approval and a
  later review label coexist.
- Preserve custom configured workflow-label names.
- Cover required-approval recovery with regression tests.

## Non-goals

- Bind approvals cryptographically to artifact contents or commits.
- Detect every out-of-band artifact edit made after human approval.
- Restore approval labels that were removed by older Patchmill versions from
  finished or non-resumable issues.
- Change how humans grant approval.
- Add an automated revision workflow for an approved artifact.
- Change triage classification or priority ordering.

## Approval invariants

Approval labels describe the current artifacts:

- The configured spec-approved label means the current specification is
  approved.
- The configured plan-approved label means the current implementation plan is
  approved.
- Advancing to implementation does not make either statement false.
- An implementation failure does not make either statement false.
- Successful implementation does not make either statement false.

Approval labels are also artifact-existence guards:

- `spec-approved` requires one uniquely resolvable specification. Patchmill must
  reuse it and must not invoke Pi to create or replace a spec.
- `plan-approved` requires one uniquely resolvable implementation plan.
  Patchmill must reuse it and must not invoke Pi to create or replace a plan.
- A missing or ambiguous approved artifact is a safety error, not permission to
  synthesize a replacement.
- Revising an approved spec requires a human to withdraw both spec approval and
  downstream plan approval first.
- Revising an approved plan requires a human to withdraw plan approval first.

`run-once` never removes an approval label on the human's behalf. Review labels
remain transient workflow-state labels. Ready, in-progress, needs-info, and done
labels remain lifecycle labels.

## Label transitions

The names below are defaults; all behavior uses configured label names.

### Claim

Claiming removes `agent-ready` and adds `in-progress`. It preserves
`spec-approved`, `plan-approved`, `spec-review`, and `plan-review` until the
resolved workflow transition determines which review labels are stale.

### Spec creation

Patchmill may create a spec only when neither `spec-approved` nor
`plan-approved` is present. If the pipeline determines that spec creation is
required while either approval is present, it fails with a safety error before
invoking Pi or changing labels.

After creating an unapproved spec, Patchmill:

- adds `spec-review` when spec approval is required;
- removes `agent-ready` and `in-progress` at the review stop;
- removes stale plan review state;
- does not remove any approval label because artifact creation was prohibited
  while an approval was present.

### Plan creation

Patchmill may create a plan only when `plan-approved` is absent. An approved
spec may be used to create its first plan and remains approved.

After creating an unapproved plan, Patchmill:

- preserves `spec-approved`;
- adds `plan-review` when plan approval is required;
- removes `agent-ready`, `spec-review`, and `in-progress` at the review stop;
- does not remove `plan-approved` because plan creation was prohibited while
  that approval was present.

### Enter implementation

Before implementation:

- preserve `spec-approved` and `plan-approved`;
- remove `agent-ready`, `spec-review`, and `plan-review`;
- retain `in-progress`.

### Unexpected implementation failure

An unexpected failure:

- preserves both approval labels;
- preserves `in-progress`;
- records a resumable `implementing` run state and the error.

A rerun resumes implementation without requiring either approval to be added
again.

### Successful completion

Successful completion:

- preserves both approval labels;
- removes `agent-ready`, review labels, `in-progress`, and `needs-info`;
- adds `agent-done`.

## Workflow-state resolution

Durable earlier-stage approvals can coexist with later-stage review labels. The
resolver must therefore prefer the latest workflow stage, while an approval
still wins over the review label for the same stage.

Resolution order will be:

1. plan approved;
2. waiting for plan review;
3. spec approved;
4. waiting for spec review;
5. agent ready;
6. not actionable.

Examples:

| Labels                                          | Resolved state          |
| ----------------------------------------------- | ----------------------- |
| `spec-review`, `spec-approved`                  | spec approved           |
| `spec-approved`, `plan-review`                  | waiting for plan review |
| `spec-approved`, `plan-review`, `plan-approved` | plan approved           |
| `agent-ready`, `spec-review`                    | waiting for spec review |

This prevents a durable `spec-approved` label from causing automatic selection
while a new plan is waiting for approval.

## Resume semantics

Saved active run state is authoritative for stages already completed.

When the saved state is `implementing`, `run-once` may resolve and validate the
saved artifacts and workspace, but it must not send the issue back through spec
or plan approval gates. Entering the implementing state proves those gates were
satisfied for the artifacts used by that run.

For new runs and saved `planning` runs, approval gates continue to inspect the
current labels. Because approvals are no longer consumed on entry to
implementation, a failure before the implementing state is persisted remains
retryable without manual relabeling.

This rule also provides compatibility for an active run created by an older
Patchmill version after that version already removed its approval labels.

## Cleanup responsibilities

Label cleanup will be split by purpose rather than using one helper that removes
all workflow labels:

- artifact guards validate approved artifacts before any artifact-creation Pi
  call;
- review-transition cleanup removes ready, in-progress, and stale review labels
  but never approval labels;
- implementation cleanup removes ready and review labels but preserves approval
  labels;
- completion cleanup removes lifecycle and review labels but preserves approval
  labels;
- failure cleanup changes only labels required by the failure outcome.

No `run-once` cleanup caller may infer that approval is stale or remove an
approval label merely because the workflow advanced or an artifact could not be
resolved.

## Development-environment failures

Development-environment readiness failures currently reconstruct actionable
labels because implementation cleanup has consumed them. With durable approvals,
that reconstruction is unnecessary when approval labels are already present.

The retry path will preserve existing approvals and remove `in-progress` as
required by its terminal outcome. Compatibility behavior for a legacy active run
must use saved run state rather than inventing a new approval for an artifact
that was never approved.

## Error handling and consistency

Label updates and run-state writes are separate host operations and cannot be
atomic. The design minimizes inconsistent recovery states by ensuring that:

- approved-artifact guards run before claim or artifact-creation side effects;
- a missing or ambiguous approved artifact produces a clear safety error naming
  the approval label and artifact problem;
- the guard does not invoke Pi or mutate issue labels;
- approval facts survive ordinary progression and implementation errors;
- an active implementing state bypasses completed approval gates;
- label operations are idempotent;
- rerunning after any partial transition converges on the same label set.

Patchmill must not remove a valid approval as generic cleanup after a later
operation fails.

## Compatibility

No configuration migration is required. Custom review and approval label names
continue to come from the workflow approval policy.

Active legacy runs saved as `implementing` can resume even if an older version
removed their approvals. Patchmill cannot safely infer and restore historical
approvals for finished, blocked, or otherwise non-resumable issues; those labels
remain unchanged unless a human reapplies them.

An issue that carries an approval label but lacks a uniquely resolvable approved
artifact will now fail safely instead of causing Patchmill to generate a new
artifact and remove the approval. This is an intentional tightening of an
inconsistent-state path.

## Testing strategy

Automated regression coverage will include:

1. A required-spec-approval implementation returns unsupported Pi JSON, remains
   in progress with `spec-approved`, and resumes to completion without manual
   relabeling.
2. The equivalent required-plan-approval failure and resume preserves
   `plan-approved`.
3. `spec-approved` with a missing or ambiguous spec fails before Pi or label
   mutation.
4. `plan-approved` with a missing or ambiguous plan fails before Pi or label
   mutation.
5. Creating an unapproved spec stops at spec review without removing any
   approval label.
6. Creating an unapproved plan from an approved spec preserves spec approval and
   stops at plan review.
7. Entering implementation and successful completion preserve both approvals.
8. Workflow-state resolution treats `spec-approved + plan-review` as waiting for
   plan approval.
9. An existing spec approval still wins over `spec-review`, and an existing plan
   approval still wins over `plan-review`.
10. A legacy saved `implementing` run with only `in-progress` bypasses approval
    gates and resumes.
11. Development-environment retry behavior does not fabricate approvals.

The focused run-once tests, full test suite, lint, and build must pass.

## Expected implementation areas

The implementation is expected to update:

- `src/cli/commands/run-once/workflow-state.ts` for state resolution and focused
  cleanup behavior;
- planning artifact resolution and source stages for approved-artifact safety
  guards;
- `src/cli/commands/run-once/stage-advancement.ts` for artifact-creation guards
  and approval-gate bypass on implementation resume;
- `src/cli/commands/run-once/pipeline.ts` and
  `src/cli/commands/run-once/pipeline-finish.ts` for implementation and
  completion transitions;
- `src/cli/commands/run-once/development-environment-stage.ts` for retry labels;
- run-once unit and scenario tests for required-approval recovery.

No host-provider API change is expected.
