---
title: Run-once
description: Advance one issue from observed git and host facts.
---

`patchmill run-once` advances one issue through planning and implementation. It
uses a separate branch and pull request for each required planning gate, then an
implementation branch and pull request. Each phase gets a fresh Pi session. The
kernel reads git and the issue host between sessions. It never reads a saved
result to choose the next phase.

```sh
patchmill run-once
patchmill run-once --issue 123
patchmill run-once --dry-run
patchmill run-once --issue 123 --plan-only
```

Without `--issue`, selection takes the oldest open issue with `agent-ready` or
`in-progress`. Explicit selection requires an open issue, but does not require
`agent-ready`. The local issue lock still prevents concurrent attempts. Dry run
prints selection and the derived phase without claiming or running Pi.
`--plan-only` stops after planning completes and never starts implementation. It
does not bypass either planning gate.

## Claim and release

The kernel holds an exclusive OS lock on `<runsDir>/issue-N/lock` throughout the
attempt and label cleanup. It then swaps `agent-ready` for `in-progress` and
rereads the issue. A narrow race between separate clones remains possible.

The lock file is permanent. The OS releases ownership when its handle closes or
the process exits. JSON inside it records a PID and start time for diagnosis
only. Empty, stale, or corrupt JSON does not prove that the issue is inactive.
Never remove or replace the lock file or its parent directory.

After a hard crash leaves `in-progress`, run:

```sh
patchmill release --issue N
```

This command acquires the same OS lock before resetting the label to
`agent-ready`. Contention returns exit code 1 without label changes. Do not use
a label reset as permission to delete an active worktree.

## Phase derivation

After claiming, Patchmill fetches `origin` and inspects each required planning
gate before implementation. Each gate has a stable head, independent of title
edits. The kernel reuses a stage's workspace or creates it from the fetched
base. Expected spec and plan branches are not ambiguous implementation branches.
Several implementation branches stop with `needs-info`.

| Observed fact                                                       | Next action                                     |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| Required planning PR is absent                                      | Run planning for that stage and publish its PR. |
| Required planning PR is open                                        | Keep `in-progress` and stop without Pi.         |
| Required planning PR is closed, not merged                          | Stop with `needs-info`.                         |
| Required planning PR is merged and its artifacts are on the base    | Advance to the next required stage.             |
| Merged planning artifacts are absent from, or differ from, the base | Stop with `needs-info`.                         |
| No required planning gate remains, but a document is absent         | Run planning on the implementation branch.      |
| No required gate remains and both documents exist                   | Run implementation.                             |
| Implementation PR is merged and closes the issue                    | Stop with `agent-done`.                         |

`workflow.specApproval.required` and `workflow.planApproval.required` both
default off. With both on, merge the spec PR, then the plan PR, before
implementation. Review approval or an approval label does not unlock either
gate. Adding `agent-ready` cannot bypass an open required PR.

When a gate is off, its document goes into the next required planning PR. With
no later gate, it goes into the implementation PR. Planning PR bodies use
`Refs #N`, not closing keywords. Only the implementation PR completes the issue.
Each later branch starts from the fetched base with earlier merged documents.
The kernel never deletes merged planning branches or worktrees.

## Outcome checks

The agent ends with a fenced JSON block containing exactly these fields:

```json
{ "status": "done", "summary": "What changed, or what needs a human answer." }
```

`status` is `done`, `needs-input`, or `failed`. Questions go in `summary`. The
kernel checks the world rather than trusting `done`:

| Phase or result                                                       | Required fact or outcome                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning reports `done`                                               | The remote branch and required artifacts exist. Gated stages also need their non-closing planning PR. Wait for merge or derive the next phase. |
| Implementation reports `done`                                         | Open, non-draft pull request has the issue branch as head and a body with `Closes #N`, `Fixes #N`, or `Resolves #N`.                           |
| Verified implementation                                               | Set `agent-done`, without waiting for merge.                                                                                                   |
| Unverified claim, `needs-input`, `failed`, missing result, or timeout | Set `needs-info` and report the reason.                                                                                                        |

Uncommitted changes or unpushed commits produce warnings. They do not invalidate
a real ready pull request. The kernel posts one comment per stop with the
outcome, summary, best-effort cost, and warnings. The agent never changes issue
labels or posts issue comments.

To address an open ready pull request's review, add `agent-ready` and rerun. The
implementation skill reads its comments and revises the same branch and pull
request. Patchmill does not merge or automatically retry failed attempts.

## Names and local output

| Item                  | Default rule                                                   |
| --------------------- | -------------------------------------------------------------- |
| Implementation branch | `agent/issue-N-<title-slug>`, with at most 48 slug characters. |
| Required spec branch  | `agent/issue-N--spec`.                                         |
| Required plan branch  | `agent/issue-N--plan`.                                         |
| Worktree              | `.worktrees/<branch-with-slashes-replaced-by-hyphens>`.        |
| Spec                  | `docs/specs/YYYY-MM-DD-issue-N-<slug>-design.md`.              |
| Plan                  | `docs/plans/YYYY-MM-DD-issue-N-<slug>.md`.                     |
| Run output            | `.patchmill/runs/issue-N/<run-id>/`.                           |

Only the configured spec and plan naming patterns count as artifacts. A design
file cannot also count as a plan, even when both directories are equal. Each
attempt writes `prompt.md`, `pi.log`, `session-N.log`, `sessions/`, and
`result.json`. The prompt is replaced for each phase in the attempt. Session
logs stay separate. The aggregate `pi.log` contains stdout and stderr from all
phases. Raw agent output stays in logs, not the console. `result.json` is a
write-only record, never a resume input. The console shows phase progress, a
readable final outcome, log paths, and best-effort cost.

## Supervision and cleanup

Each session uses `pi.timeoutMinutes`, which defaults to 90 minutes. On timeout,
cancellation, or termination, the kernel sends `SIGTERM` to the process group.
After five seconds, it sends `SIGKILL` if needed. The kernel attempts label
cleanup and closes the local lock handle in `finally`. A hard crash can still
leave host labels unchanged.

The kernel never deletes worktrees. Use the human-controlled `patchmill-cleanup`
skill for inspected, confirmed cleanup under the same lock. Keep permanent lock
files and their parent directories intact. For independent concurrent issues,
allocate separate ports, databases, and services. Do not change shared
configuration or Git state during active runs. See
[Git safety](/reference/git-safety/) for host branch protection.
