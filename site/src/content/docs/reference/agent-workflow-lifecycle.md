---
title: Agent workflow lifecycle
description:
  Understand triage, strict planning state, and planning pull-request recovery.
---

Patchmill has two workflows:

- **Triage** classifies open issues as `agent-ready`, `needs-info`, unsuitable,
  or blocked.
- **Run-once** processes one ready issue through durable planning state and an
  implementation pull request.

## Triage lifecycle

`patchmill triage --dry-run` previews classification without mutation.
`patchmill triage` hydrates open issues, invokes the configured triage skill,
observes labels/comments/state, and records a triage log. A blocked issue
returns to `agent-ready` only when its recorded same-repository blockers close.

## Run-once lifecycle

For a fresh eligible issue, the public facade selects `planning-pr-v1`. It also
uses that pipeline for valid active planning state. Only unfinished legacy Run
recovery state uses the legacy pipeline; conflicting, malformed, or unsupported
state blocks without fallback.

1. Patchmill acquires the exact Issue-run ownership lock and initializes strict
   state with an immutable planning review-gate snapshot.
2. The phase coordinator fetches the saved target base, checks artifact and
   workspace ownership, and prepares one phase workspace when necessary.
3. A required spec or plan gate produces one non-closing planning pull request.
   Its exact verified merge unlocks the next phase.
4. The implementation phase produces an independently validated, open,
   issue-closing pull request regardless of legacy direct-land configuration.
5. Checkpointed handoff, cleanup hook, workspace cleanup, and done labels occur
   only after implementation pull-request validation.

When ordinary Git status is clean and the existing safeguards pass, Patchmill
removes the phase worktree with normal `git worktree remove` without `--force`.
This operation permanently deletes all ignored content. Staged, tracked, and
non-ignored untracked changes block cleanup. Git can refuse removal if an
ordinary change appears after the last status check. Patchmill does not retry
with force.

New cleanup does not create ignored-content `cleanup-pending` state. Older saved
records remain readable. After the operator applies the configured ready label,
a retry rechecks the saved workspace and publication evidence. It advances
legacy pending cleanup through `worktree-removed` and `removed`. The retry does
not replay a completed cleanup hook or earlier finish effect. After cleanup,
implementation continues through the existing done-label transition.

`review-pending`, `cleanup-pending`, and `stopped` with reason `plan-only` are
exit-zero nonfailure results. Normal recovery is an ordinary rerun:

```sh
patchmill run-once --issue N
```

See [Run-once recovery](/using-patchmill/run-once/#recovery-and-operator-safety)
for exact operator actions. Legacy `run lease repair` and `run reset` do not
authorize deleting planning locks, state, branches, or phase workspaces.

## Logging and output

Run-once writes progress to stderr and a final JSON result to stdout. It appends
structured events to the configured JSONL run log. Durable planning state, host
records, remote refs, and workspace evidence are observed before a retry repeats
any effect.

## Legacy compatibility

Unfinished legacy runs retain their comment, label, workspace, and recovery
behavior. Legacy artifact setters, approval-label authorization, and plan-only
controls are not the fresh-workflow lifecycle and are documented only for that
compatibility boundary.
