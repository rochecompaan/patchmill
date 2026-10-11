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
   issue-closing pull request. Both planning and legacy workflows require PRs.
5. Publication returns `pr-created` and leaves the Issue run in progress.
6. After the saved PR merges, explicit resume verifies its merge commit against
   the fetched target base. Remaining cleanup and done-label checkpoints then
   complete the Issue run without new agent work.

Ignored content never blocks verification, recovery, or cleanup. Patchmill uses
ordinary Git status. Staged changes, tracked changes, and non-ignored untracked
files remain blockers. Force-added ignored files remain subject to status and
artifact-diff guards. Read-only verification preserves HEAD, the index,
artifacts, and ignored bytes.

In-place recovery preserves ignored files. Legacy refresh and reset move old
checkouts to retained quarantine paths. Patchmill never removes these paths.
Run-once refresh results and reset results name them in `quarantinePaths`.
Recovery progress and final output report the actual retained paths.

When ordinary Git status is clean and the existing safeguards pass, Patchmill
removes the phase worktree with normal `git worktree remove` without `--force`.
This operation permanently deletes all ignored content. Staged, tracked, and
non-ignored untracked changes block cleanup. Git can refuse removal if an
ordinary change appears after the last status check. Patchmill does not retry
with force.

Older saved `cleanup-pending` records remain readable. They resume normal
cleanup without a cleanup-specific ready label or new needs-info publication.
Existing needs-info state still requires the normal ready acknowledgement. A
retry rechecks saved workspace and publication evidence. It advances legacy
pending cleanup through `worktree-removed` and `removed`. The retry does not
replay a completed cleanup hook or earlier finish effect. Implementation
completion still requires verified merge and the done-label transition.

A retry can recover one unrecorded committed artifact before saved-HEAD resume.
Recovery proves workspace ownership, ordinary cleanliness, ancestry, and one
unambiguous artifact-only delta. Committed-tree discovery retains the original
path and commit, including custom artifact directories. Recovery preserves prior
evidence, the todo root, and todos. Failed proof or checkpoint stops before
later agents or publication. The normal review gates still apply.

`review-pending` and supported `stopped` results are exit-zero nonfailure
results. Patchmill no longer returns the public `cleanup-pending` result.
Same-issue contention reports `issue already in progress.` without repair
advice.

Independent `--issue N` processes can overlap in one clone. Automatic selection
remains serial and excludes other active attempts. A process exit does not
complete the Issue run. Normal recovery is an ordinary rerun:

```sh
patchmill run-once --issue N
```

See [Run-once recovery](/using-patchmill/run-once/#recovery-and-operator-safety)
for exact operator actions. Legacy `run lease repair` and `run reset` do not
authorize deleting planning locks, state, branches, or phase workspaces. Reset
retains its legacy-only scope and refuses planning state.

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
