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

## Final result output

Progress remains on stderr. In an interactive terminal, stdout ends with a
readable grouped report that wraps long values and renders arrays vertically.
Literal paths and URLs stay visible and copyable even when they wrap.

Redirect stdout to retain the compact one-line JSON result for scripts:

```sh
patchmill run-once > result.json
jq . result.json
```

`--quiet` suppresses progress, not the final report or result. `NO_COLOR` or
`TERM=dumb` removes ANSI styling while retaining the readable terminal text. The
resolved JSONL run log always ends with the full structured `result` event.

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
13. After a successful PR or merge handoff, run the configured cleanup hook and,
    for a PR handoff, perform built-in local workspace cleanup.

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

Patchmill keeps that approval label after the workflow advances. A failed
implementation can therefore resume without asking a human to approve the same
artifact again. If an approved artifact is missing or invalid, restore the
published artifact or explicitly remove approval before creating a replacement.

## Development environment and implementation

If `skills.developmentEnvironment` is configured, Patchmill runs that skill from
the issue worktree after the plan is available and before implementation starts.
Use this for local services, seeded data, Tilt, Docker, Kubernetes, or other
runtime setup agents need before changing code.

Implementation then runs with the configured implementation skill. Optional
`toolchain`, `review`, `visualEvidence`, and `landing` skills add repository
rules for validation commands, review passes, screenshot evidence, and the
choice between direct landing and opening a pull request.

## Cleanup after successful handoff

Set the top-level `cleanupHook` when the repository needs a deterministic script
to stop local services or remove issue-specific development resources. After
implementation finishes as `pr-created` or `merged`, Patchmill records and
reports the successful handoff, then runs:

```sh
bash <cleanupHook>
```

The command runs from the issue worktree. Relative hook paths therefore resolve
from that worktree, and the script does not need its executable bit set because
Patchmill invokes it through `bash`.

For `pr-created`, Patchmill removes its local issue worktree and branch after
the hook finishes. Keep environment cleanup inside the hook, but leave worktree,
local branch, remote branch, pull request, and run-state cleanup to Patchmill.

Make the script idempotent and scope its resources to the current issue or
worktree. It should tolerate resources that are already absent and return a
non-zero exit code when cleanup remains incomplete. Patchmill reports a hook
failure as cleanup progress but does not change an already successful PR or
merge result into an implementation failure.

The hook does not run for approval gates, blockers, implementation failures, or
other retryable outcomes. Those runs retain their environment for a later
`run-once` retry, and Patchmill does not retry a failed cleanup hook
automatically.

## Run state and retries

`run-once` writes logs under the configured run state directory, which defaults
to `.patchmill/runs/`. If a retryable run is already in progress, a later
execute run resumes it before selecting new work.

Use the explicit operational commands below. `patchmill run` is a command
family, not a continuous factory loop:

```sh
patchmill run-once --issue 123
patchmill run reset --issue 123
patchmill run lease repair --issue 123
```

Use `run-once` for normal execution; use reset or lease repair only for their
explicit recovery workflows.

## Recovering a blocked Issue run

A blocked Issue run retains its Run recovery state. After answering the blocker
outside Patchmill, restore `agent-ready` and explicitly retry the same issue;
comments provide context and are never a control signal:

```sh
patchmill run-once --issue 123
patchmill run reset --issue 123
patchmill run lease repair --issue 123
```

A clean current workspace, stale zero-ahead branch, clean branch with unique
commits, or safely recreatable workspace can resume. Unique commits are
preserved at their existing base without a merge or rewrite. Only an empty stale
branch refreshes to a pinned current base. Dirty or ignored content,
unmerged/lost commits, unverifiable paths, live leases, and unfenced legacy
active state refuse automatic recovery.

`patchmill run reset --issue N` archives the exact state, moves the expected
checkout to retained quarantine before ref updates, deletes only a
zero-unique-commit branch by expected OID, and starts a normal Run attempt. It
rejects `--dry-run`, has no force option, and changes labels only during the
normal claim. Reset accepts active `in-progress` state, blocked `agent-ready`
state (with optional `needs-info`), and finished `agent-ready` or `in-progress`
state after normal approval checks. It preserves only validated
specification/plan references and the issue-scoped start-comment receipt; a new
Issue run may therefore post legitimate failure and blocker comments.

Retry keeps same-Issue-run receipts. A legacy blocker comment is deduplicated
only after its exact canonical body is found on the issue, never from a comment
that merely says the issue is ready. Refresh and reset move the complete
checkout into retained quarantine before ref updates. Content that arrives late,
including ignored files, remains quarantined or stops publication rather than
being overwritten.

Lease repair prints a fingerprinted, operator-confirmed command for abandoned
remote leases, guards, or legacy active state. Remote lease repair requires
`--confirm-owner-stopped`; guard and legacy-state repair require
`--confirm-all-runners-stopped`. There is no automatic remote liveness guess or
force cleanup.
