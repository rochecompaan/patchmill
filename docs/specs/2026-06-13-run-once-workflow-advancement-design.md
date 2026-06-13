# `run-once` Workflow Advancement Design

## Summary

Patchmill should treat `patchmill run-once` as the command that advances one
issue through the configured automation workflow. The `agent-ready` label means
"Patchmill automation may start or continue advancing this issue", not
"implementation can begin immediately". Human review labels are workflow stops;
approved labels are actionable states for the next automated step.

This replaces the current behavior where `workflow.specApproval.required` makes
`agent-ready` issues ineligible until `spec-approved` is already present. That
behavior is confusing because an issue can be labeled `agent-ready` while
`run-once` refuses to select it.

## Goals

- Keep `patchmill run-once` as the single one-issue advancement command.
- Preserve triage as intake classification: enough information, needs info,
  unsuitable, blocked, priority, and issue type.
- Ensure the agent always writes a spec before writing a plan.
- Ensure the agent always writes a plan before implementation.
- Stop at configured human approval gates.
- Make `agent-ready`, `spec-approved`, and `plan-approved` actionable states.
- Make `spec-review` and `plan-review` non-actionable waiting states.
- Tolerate issues carrying both review and approved labels at the same time.
- Remove stale `spec-*` and `plan-*` labels when `run-once` advances past those
  stages.

## Non-goals

- Add separate primary commands such as `patchmill spec` or `patchmill plan`.
- Require humans to add `agent-ready` again after approving specs or plans.
- Change the configured label names or require a migration for repositories that
  already use the default workflow labels.
- Make triage responsible for writing specs or plans.

## Workflow states

Patchmill-owned workflow labels fall into three groups.

Actionable labels:

- `labels.ready`, default `agent-ready`
- `workflow.specApproval.approvedLabel`, default `spec-approved`
- `workflow.planApproval.approvedLabel`, default `plan-approved`

Waiting labels:

- `workflow.specApproval.reviewLabel`, default `spec-review`
- `workflow.planApproval.reviewLabel`, default `plan-review`

Terminal or non-actionable labels:

- `labels.needsInfo`, default `needs-info`
- `labels.unsuitable`, default `agent-unsuitable`
- `labels.done`, default `agent-done`
- `labels.inProgress`, default `in-progress`
- blocked/protection labels from the triage policy

Approved labels dominate review labels. For example, an issue labeled both
`spec-review` and `spec-approved` is actionable as `spec-approved`; an issue
labeled both `plan-review` and `plan-approved` is actionable as `plan-approved`.

## State transitions

### Spec and plan approval required

```text
agent-ready   --run-once--> write spec, stop at spec-review
spec-approved --run-once--> write/reuse spec, write plan, stop at plan-review
plan-approved --run-once--> write/reuse spec and plan, implement, stop at agent-done
```

### Spec approval required, plan approval not required

```text
agent-ready   --run-once--> write spec, stop at spec-review
spec-approved --run-once--> write/reuse spec, write plan, implement, stop at agent-done
```

### Spec approval not required, plan approval required

```text
agent-ready   --run-once--> write spec, write plan, stop at plan-review
plan-approved --run-once--> write/reuse spec and plan, implement, stop at agent-done
```

### Neither approval required

```text
agent-ready --run-once--> write spec, write plan, implement, stop at agent-done
```

In every configuration, spec creation happens before plan creation, and plan
creation happens before implementation.

## Command responsibilities

### `patchmill triage`

`triage` remains the intake/sorting station. It should label actionable issues
with `agent-ready` when they have enough information for automation to begin. It
should use `needs-info`, `agent-unsuitable`, blocked, type, and priority labels
as it does today.

`triage` should not write specs or plans and should not apply `spec-review`,
`spec-approved`, `plan-review`, or `plan-approved` as ordinary triage outcomes.
Those labels belong to the `run-once` workflow advancement state machine and to
human approval.

### `patchmill run-once`

`run-once` selects one issue in an actionable state, claims it with
`in-progress`, advances it until the next configured human review stop or final
completion, then removes `in-progress`.

Automatic selection should consider issues actionable when their resolved
workflow state is one of:

1. `plan-approved`
2. `spec-approved`
3. `agent-ready`

The state priority above resolves conflicts on the same issue. Across different
issues, the existing priority-label and issue-number ordering should continue to
control selection so repository priority policy remains stable.

Explicit `patchmill run-once --issue <number>` should validate the requested
issue and either advance it, return an approval-required result for a waiting
review state, or fail clearly if the issue is not open/actionable.

## Label cleanup rules

When `run-once` advances past a stage, it removes stale workflow labels from
that stage and any invalidated later stage.

When entering `spec-review` after writing a new spec:

- add `spec-review`
- remove `agent-ready`
- remove stale `spec-approved`
- remove stale `plan-review`
- remove stale `plan-approved`

When entering `plan-review` after writing a new plan:

- add `plan-review`
- remove `agent-ready`
- remove `spec-review`
- remove `spec-approved`
- remove stale `plan-approved`

When entering implementation from `plan-approved` or from a configuration that
skips plan approval:

- remove `agent-ready`
- remove `spec-review`
- remove `spec-approved`
- remove `plan-review`
- remove `plan-approved`
- keep `in-progress` until the implementation result is recorded

When finishing successfully:

- add `agent-done`
- remove `in-progress`
- ensure all stale `spec-*` and `plan-*` labels are absent

This cleanup is tolerant of human workflows where approvers add approved labels
without removing review labels.

## Spec and plan artifacts

`run-once` should create a spec artifact before creating a plan. The spec should
be stored under the configured/spec documentation area, using a deterministic
issue-oriented filename such as:

```text
docs/specs/YYYY-MM-DD-issue-<number>-<slug>-design.md
```

The plan should remain under `docs/plans/` and should reference the spec path.
When an existing spec or plan is present, `run-once` may reuse it if it matches
the current issue and workflow state. If a new spec is generated, any old plan
approval must be considered stale and removed by the cleanup rules above.

The run state should record the spec path and, when applicable, the spec commit,
just as it records plan and implementation checkpoints today. Resume behavior
should not duplicate comments, labels, specs, or plans after a partial run.

## Approval-required results

The old behavior returns `no-issue` for automatic selection when all ready
issues lack `spec-approved`. The new behavior should instead allow `agent-ready`
issues to be selected and advanced to `spec-review` when spec approval is
required.

`approval-required` remains useful for explicit issue selection in waiting
states:

- `spec-review` without `spec-approved` returns missing `spec-approved`
- `plan-review` without `plan-approved` returns missing `plan-approved`

Automatic selection should simply ignore waiting states unless the approved
label is also present.

## Dry-run behavior

`patchmill run-once --dry-run` should report which issue would be selected and
what transition would be attempted. For example:

- `agent-ready -> spec-review`
- `agent-ready -> plan-review`
- `agent-ready -> agent-done`
- `spec-approved -> plan-review`
- `plan-approved -> agent-done`

Dry-run should not write specs, plans, comments, labels, branches, or run-state
checkpoints.

## Documentation updates

Documentation should describe `agent-ready` as an actionable workflow state for
`run-once`, not as a guarantee that implementation starts immediately. The
configuration docs should show the four approval-mode transition tables above.

The issue workflow docs should explain that humans may either replace review
labels with approved labels or add approved labels while leaving review labels
in place; `run-once` tolerates both and cleans stale labels as it advances.

## Test strategy

Automated tests should cover behavior, not static config text.

Selection tests:

- automatic selection includes `agent-ready` when spec approval is required
- automatic selection includes `spec-approved` when planning is the next step
- automatic selection includes `plan-approved` when implementation is the next
  step
- automatic selection ignores `spec-review` and `plan-review` without approved
  labels
- approved labels dominate review labels when both are present

Pipeline tests:

- spec and plan approval required: `agent-ready` stops at `spec-review`
- spec and plan approval required: `spec-approved` stops at `plan-review`
- spec and plan approval required: `plan-approved` implements and reaches
  `agent-done`
- plan-only approval: `agent-ready` writes spec and plan, then stops at
  `plan-review`
- no approvals: `agent-ready` writes spec and plan, then implements
- stale `spec-*` and `plan-*` labels are removed during advancement
- explicit waiting-state issues return `approval-required` with the missing
  approved label
- resume behavior does not duplicate spec, plan, comments, or label mutations

Dry-run tests:

- dry-run reports selected issue and planned transition without mutations

## Open decisions resolved

- `run-once`, not new `spec` or `plan` commands, owns workflow advancement.
- `agent-ready` means automation may advance the issue, not necessarily that
  implementation may start.
- Humans do not need to remove review labels manually; Patchmill tolerates both
  review and approved labels and cleans them up during the next advancement.
