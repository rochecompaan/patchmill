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

Add a top-level `workflow` config object:

```json
{
  "workflow": {
    "requireSpecApproval": false,
    "requirePlanApproval": false,
    "specStorage": "issue-comment",
    "planStorage": "repository"
  }
}
```

Fields:

- `requireSpecApproval`: when true, implementation is blocked until the issue
  has the configured spec-approved label.
- `requirePlanApproval`: when true, Patchmill creates or finds a plan, posts a
  plan-ready comment, applies the configured plan-review label, restores the
  ready label, and stops until the issue has the configured plan-approved label.
- `specStorage`: v1 accepts `"issue-comment"`; it documents where reviewed
  specifications are expected to live. Additional storage modes can be added
  later.
- `planStorage`: v1 accepts `"repository"`; it preserves the current plan-file
  workflow. Additional storage modes can be added later.

Existing `projectPolicy.planRequiresApproval` remains supported. When
`workflow.requirePlanApproval` is absent, Patchmill derives it from
`projectPolicy.planRequiresApproval`. When both are present,
`workflow.requirePlanApproval` wins.

## Labels

Extend `labels` with optional workflow labels:

```json
{
  "labels": {
    "specReview": "spec-review",
    "specApproved": "spec-approved",
    "planReview": "plan-review",
    "planApproved": "plan-approved"
  }
}
```

Default labels are added to the generated config and setup/doctor label checks.
These labels are distinct from canonical triage states. They are
workflow-control signals rather than replacements for `agent-ready`,
`needs-info`, `blocked`, or `in-progress`.

## Run-once behavior

### Selection

`patchmill run-once` continues to select issues by the configured ready label
and existing protection/exclusion labels. Before claiming a selected issue, it
validates workflow approvals:

- If `workflow.requireSpecApproval` is true and the issue lacks
  `labels.specApproved`, return `no-issue` for automatic selection.
- If a specific issue was requested with `--issue` and the required spec
  approval is missing, return a clear blocked/error result explaining the
  missing approval label.
- If `workflow.requirePlanApproval` is true and a plan already exists but the
  issue lacks `labels.planApproved`, stop before implementation and post/ensure
  the plan-ready path where possible.

### Plan approval stop

When plan approval is required and no approved plan label is present:

1. claim the issue as usual;
2. create or find the plan;
3. post the existing plan-ready comment;
4. apply the configured plan-review label;
5. restore the ready label and remove `in-progress`;
6. record run state as finished;
7. return `plan-created` or `plan-found`.

This preserves the current manual-review stop while making the approval state
explicit.

### Resuming after plan approval

After a human applies `labels.planApproved`, the next `run-once` may select the
issue again. If the plan file already exists, Patchmill reuses it and proceeds
to implementation instead of stopping again. It may remove `labels.planReview`
during claim or leave it as historical metadata; v1 should remove `planReview`
when moving to `in-progress` to keep the active state clear.

### Specification approval

When spec approval is required, `run-once` does not create a plan or worktree
unless `labels.specApproved` is present. This intentionally leaves spec drafting
and review to triage or a future interactive spec command.

## Triage behavior

The initial implementation does not need to change triage classification logic
beyond label definitions and documentation. Triage skills can be updated later
to produce `spec-review` rather than `agent-ready` when enough information
exists but spec approval is required.

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
- `workflow.requirePlanApproval` overrides `projectPolicy.planRequiresApproval`;
- partial config merging preserves default workflow labels and storage modes;
- selection or pipeline gating skips unapproved spec-required issues;
- plan-approval stop applies `plan-review` and restores the ready label;
- approved plan issues proceed to implementation when the plan exists.

Documentation/config-only details can be verified by type checks and existing
docs commands rather than adding tests that restate static prose.

## Future extensions

- Issue-hosted spec drafting using the configured brainstorming/spec skill.
- Issue-hosted plan comments with upsert markers.
- Artifact hashes tying approval labels to a specific spec or plan version.
- Approval comments from trusted users as an alternative to labels.
- Staleness detection when issue content changes after approval.
