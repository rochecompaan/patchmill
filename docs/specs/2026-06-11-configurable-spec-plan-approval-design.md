# Configurable specification and plan approval design

## Summary

Patchmill should make specification and plan approval explicit workflow gates
instead of assuming that an issue labeled ready can immediately move from
planning to implementation. Repositories will be able to configure whether
specification approval, plan approval, both, or neither are required before
implementation. The default behavior remains compatible with the current
workflow.

The first implementation will add a workflow approval model, durable label-based
approval signals, and run-once gating. It will not attempt to generate full
specifications automatically; it will provide the configuration and safety gates
needed for that workflow to be added cleanly.

## Goals

- Add first-class workflow configuration for specification and plan approval.
- Preserve existing behavior unless a repository opts into the new gates.
- Treat existing `projectPolicy.planRequiresApproval` as a compatibility alias
  for plan approval.
- Prevent implementation when required specification or plan approval is
  missing.
- Allow plan approval to unblock implementation after a prior plan-only approval
  stop.
- Use host-portable labels as the v1 durable approval signal.
- Document the new configuration and workflow states.

## Non-goals

- Automatically drafting or updating issue-hosted specifications.
- Upserting editable issue comments for specs or plans.
- Hashing artifact contents and invalidating approvals when issue/spec/plan
  content changes.
- Adding an interactive brainstorming/specification command.
- Moving plan storage from repository files to issue comments.

Those capabilities should be added later once the approval model is stable.

## Configuration

Add a top-level `workflow` config object with approval policy owned by the
workflow domain:

```json
{
  "workflow": {
    "specApproval": {
      "required": false,
      "reviewLabel": "spec-review",
      "approvedLabel": "spec-approved"
    },
    "planApproval": {
      "required": false,
      "reviewLabel": "plan-review",
      "approvedLabel": "plan-approved"
    }
  }
}
```

Fields:

- `workflow.specApproval.required`: when true, implementation is blocked until
  the issue has `workflow.specApproval.approvedLabel`.
- `workflow.specApproval.reviewLabel`: the workflow-owned label that can mark an
  issue as awaiting specification review.
- `workflow.specApproval.approvedLabel`: the workflow-owned label that confirms
  specification approval.
- `workflow.planApproval.required`: when true, Patchmill creates or finds a
  plan, posts a plan-ready comment, applies `workflow.planApproval.reviewLabel`,
  restores the ready label, and stops until the issue has
  `workflow.planApproval.approvedLabel`.
- `workflow.planApproval.reviewLabel`: the workflow-owned label that marks an
  issue as awaiting plan review.
- `workflow.planApproval.approvedLabel`: the workflow-owned label that confirms
  plan approval.

Existing `projectPolicy.planRequiresApproval` remains supported. When
`workflow.planApproval.required` is absent, Patchmill derives it from
`projectPolicy.planRequiresApproval`. When both are present,
`workflow.planApproval.required` wins.

## Storage assumptions

V1 does not expose `specStorage` or `planStorage` config. Specification review
is assumed to happen in issue discussion/comments by convention, and plans
continue to use the existing repository plan-file workflow. Add storage
configuration only when Patchmill has multiple real storage implementations to
choose from.

## Label ownership

Workflow approval labels are not part of the flat triage `labels` object. They
belong to `workflow.specApproval` and `workflow.planApproval` because they are
workflow-control signals rather than canonical triage states such as
`agent-ready`, `needs-info`, `blocked`, or `in-progress`.

Setup, doctor, and host label creation should aggregate required label
definitions from both triage policy and normalized workflow approval policy.
This keeps approval labels discoverable without leaking them into generic triage
label configuration.

## Implementation boundaries

Implementation must introduce approval-specific modules before wiring behavior
into `run-once`:

- `src/workflow/approval-policy.ts` owns the normalized approval model. It
  resolves config defaults, the `projectPolicy.planRequiresApproval`
  compatibility alias, workflow-owned label names, and the workflow label
  definitions that setup/doctor should create or validate.
- `src/cli/commands/run-once/approval-gates.ts` owns run-once approval
  decisions. It consumes the normalized policy plus issue and plan state, then
  returns a small decision object for selection and pipeline code to act on.

`src/cli/commands/run-once/pipeline.ts` should consume these normalized policy
and decision objects rather than adding scattered branches for spec approval,
plan approval, plan-review labeling, ready restoration, or resume semantics.

The decision shape should distinguish at least:

- automatic-selection eligibility for spec approval;
- explicit-issue `approval-required` failures with the missing label and
  approval kind;
- plan-review stops that describe the labels/comments/state transitions the
  pipeline must apply;
- approved/proceed decisions.

## Run-once behavior

### Selection

`patchmill run-once` has separate automatic and explicit issue-selection paths.

Automatic selection continues to consider issues by the configured ready label
and existing protection/exclusion labels, but required specification approval is
part of candidate eligibility. When normalized spec approval is required,
automatic selection must filter out issues that lack
`workflow.specApproval.approvedLabel` before choosing the best candidate. If no
ready, unblocked, spec-approved candidate remains, return `no-issue`.

Explicit `--issue` selection does not silently fall back to another issue. It
should validate the requested issue fail-fast: if required spec approval is
missing, return a typed `approval-required` result/error that includes the
missing `workflow.specApproval.approvedLabel` and identifies the missing
approval as specification approval.

Plan approval remains a workflow stop rather than an automatic-selection filter:
if normalized plan approval is required and a plan already exists but the issue
lacks `workflow.planApproval.approvedLabel`, return a plan-review decision
before implementation and post/ensure the plan-ready path where possible.

Implementation should apply the spec-approval predicate before or inside
`selectIssue`/candidate eligibility. Do not select a single automatic issue and
then translate missing spec approval into `no-issue`, because a higher-priority
unapproved issue could otherwise starve lower-priority ready and approved work.

### Plan approval stop

When plan approval is required and no approved plan label is present:

1. claim the issue as usual;
2. create or find the plan;
3. post the existing plan-ready comment;
4. apply `workflow.planApproval.reviewLabel`;
5. restore the ready label and remove `in-progress`;
6. record run state as finished;
7. return `plan-created` or `plan-found`.

This preserves the current manual-review stop while making the approval state
explicit.

### Resuming after plan approval

After a human applies `workflow.planApproval.approvedLabel`, the next `run-once`
may select the issue again. If the plan file already exists, Patchmill reuses it
and proceeds to implementation instead of stopping again. It may remove
`workflow.planApproval.reviewLabel` during claim or leave it as historical
metadata; v1 should remove the review label when moving to `in-progress` to keep
the active state clear.

### Specification approval

When spec approval is required, `run-once` does not create a plan or worktree
unless `workflow.specApproval.approvedLabel` is present. This intentionally
leaves spec drafting and review to triage or a future interactive spec command.

## Triage behavior

The initial implementation does not need to change triage classification logic
beyond aggregating workflow label definitions for setup/doctor/documentation.
Triage skills can be updated later to apply `workflow.specApproval.reviewLabel`
rather than `agent-ready` when enough information exists but spec approval is
required.

For now, the run-once gate is the safety boundary: even if triage applies
`agent-ready`, implementation will not proceed without required approvals.

## Host provider impact

The v1 design uses capabilities that already exist in the host abstraction:

- read issue labels;
- create labels;
- apply labels;
- comment on issues;
- view/list issues.

No host-specific comment editing or issue body mutation is required.

## Testing

Automated tests should cover:

- default config preserves current behavior;
- `workflow.planApproval.required` overrides
  `projectPolicy.planRequiresApproval`;
- partial config merging preserves default workflow approval labels;
- normalized approval policy exposes workflow label definitions for setup/doctor
  aggregation without adding them to flat triage labels;
- automatic selection skips unapproved spec-required issues and can still pick a
  lower-priority ready, unblocked, spec-approved issue;
- explicit `--issue` selection returns a typed `approval-required` result/error
  when required spec approval is missing;
- approval-gate decisions cover plan-review stops without requiring inline
  approval branches in `run-once/pipeline.ts`;
- plan-approval stop applies `workflow.planApproval.reviewLabel` and restores
  the ready label;
- approved plan issues proceed to implementation when the plan exists.

Documentation/config-only details can be verified by type checks and existing
docs commands rather than adding tests that restate static prose.

## Future extensions

- Issue-hosted spec drafting using the configured brainstorming/spec skill.
- Issue-hosted plan comments with upsert markers.
- Artifact hashes tying approval labels to a specific spec or plan version.
- Approval comments from trusted users as an alternative to labels.
- Staleness detection when issue content changes after approval.
