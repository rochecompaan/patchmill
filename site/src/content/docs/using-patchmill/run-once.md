---
title: Run-once
description: Advance one ready issue through Patchmill's agent workflow.
---

`patchmill run-once` advances one actionable issue through the configured
production line. It is the main command for turning a ready issue into a plan,
implementation, review result, visual evidence, pull request, or direct landing.

Preview the next action first:

```sh
patchmill run-once --dry-run
```

Dry-run mode previews the next eligible issue and workflow transition without
mutating the issue host or git repository. It is intentionally cheap: it does
not load workflow artifacts or write resumable issue state. The CLI can still
write its normal JSONL run log.

## Choose an issue

By default, `run-once` selects one open issue in an actionable workflow state,
such as the configured ready label or an approval label that allows work to
continue.

Common options:

```sh
patchmill run-once
patchmill run-once --issue 123
patchmill run-once --plan-only --issue 123
```

- `--issue <number>` processes one specific open actionable issue.
- `--plan-only` runs the spec and plan stages as needed, then stops before
  implementation.
- `--quiet` suppresses terminal progress while still writing the JSONL run log.

## What execute mode does

When `run-once` executes work, the high-level sequence is:

1. Select a ready issue or resume a retryable in-progress run.
2. Verify repository preconditions, including branch safety and clean worktree
   checks.
3. Load the issue body, comments, and Patchmill-owned workflow artifact
   comments.
4. Validate published artifact checksums before mutating labels, comments, or
   run state.
5. Claim the issue and prepare an isolated issue worktree when the next stage
   needs one.
6. Materialize published specs and plans under their recorded docs paths when
   source artifacts are present.
7. Generate missing specs or plans required by the repository workflow policy.
8. Stop for human spec or plan approval when configured approval gates require
   it.
9. Run optional development-environment preparation.
10. Run implementation with the configured skills and runtime instructions.
11. Run configured review, visual-evidence, and landing procedures when the
    workflow asks for them.
12. Record run state and handoff information.

Use [workflow artifacts](/using-patchmill/workflow-artifacts/) when humans have
already written the spec or plan that Patchmill should reuse.

## Approval gates

Repositories can require human approval before implementation proceeds. When a
required gate is reached while creating or finding an artifact, `run-once`
writes the artifact, applies the configured review label, and exits with a spec-
or plan-related result such as `spec-created`, `spec-found`, `plan-created`, or
`plan-found`.

If you explicitly select an issue that is already waiting on a review label,
`run-once` reports `approval-required` instead of advancing it.

Typical gates are:

- spec approval: review the generated or published spec before planning;
- plan approval: review the implementation plan before agents edit code.

After review, add the configured approved label, such as `spec-approved` or
`plan-approved`, then run `patchmill run-once` again.

## Development environment and implementation

If `skills.developmentEnvironment` is configured, Patchmill runs that skill from
the issue worktree after the plan is available and before implementation starts.
Use this for local services, seeded data, Tilt, Docker, Kubernetes, or other
runtime setup agents need before changing code.

Implementation then runs with the configured implementation skill. Optional
`toolchain`, `review`, `visualEvidence`, and `landing` skills add repository
rules for validation commands, review passes, screenshot evidence, and the
choice between direct landing and opening a pull request.

## Run state and retries

`run-once` writes logs under the configured run state directory, which defaults
to `.patchmill/runs/`. If a retryable run is already in progress, a later
execute run resumes it before selecting new work.

Use `run-once` as the supported operational loop. The continuous `patchmill run`
factory loop is still development testing and should not replace `run-once` for
normal usage yet.
