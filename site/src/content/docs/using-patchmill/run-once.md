---
title: Run-once
description: Advance one issue from observed git and host facts.
---

`patchmill run-once` advances one issue through planning and implementation. It
uses one branch, one worktree, and one pull request per issue. Each phase gets a
fresh Pi session. The kernel reads git and the issue host between sessions. It
never reads a saved result to choose the next phase.

```sh
patchmill run-once
patchmill run-once --issue 123
patchmill run-once --dry-run
patchmill run-once --issue 123 --plan-only
```

Without `--issue`, selection takes the oldest open issue with `agent-ready` and
without `in-progress`. Explicit selection requires an open issue without
`in-progress`, but does not require `agent-ready`. Dry run prints selection and
the derived phase without claiming or running Pi. `--plan-only` stops after
planning completes. It does not bypass the spec gate.

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

After claiming, Patchmill fetches `origin` and looks for an issue branch. One
matching remote branch is reused. Several matches stop with `needs-info`. A
missing worktree is created from that branch, or from the base branch when no
issue branch exists.

| Observed fact                                           | Next action                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Pull request is merged                                  | Stop with `agent-done`.                                      |
| Spec is absent                                          | Run `planning`.                                              |
| Spec exists but required approval is absent             | Stop with `spec-review`, subject to the revision rule below. |
| Spec is approved or the gate is off, but plan is absent | Run `planning` to write the plan.                            |
| Spec and plan exist and approval is satisfied           | Run `implementation`.                                        |

One exception applies if the issue carried `agent-ready` before claiming. When
its existing spec lacks required approval, the attempt runs one planning session
to revise that spec. A verified revision stops at `spec-review` again. It never
enters implementation in that attempt. A merged pull request still takes
precedence. Other results follow normal outcome checks.

At `spec-review`, add `spec-approved` and `agent-ready` to approve and resume.
For changes, leave approval off and add review comments and `agent-ready`. The
planning skill reads issue and draft pull request comments before revising. The
plan receives review with the pull request, not a second approval gate.

## Outcome checks

The agent ends with a fenced JSON block containing exactly these fields:

```json
{ "status": "done", "summary": "What changed, or what needs a human answer." }
```

`status` is `done`, `needs-input`, or `failed`. Questions go in `summary`. The
kernel checks the world rather than trusting `done`:

| Phase or result                                                       | Required fact or outcome                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Planning reports `done`                                               | Remote branch and spec exist. Stop for required spec approval, or derive the next phase.                             |
| Implementation reports `done`                                         | Open, non-draft pull request has the issue branch as head and a body with `Closes #N`, `Fixes #N`, or `Resolves #N`. |
| Verified implementation                                               | Set `agent-done`, without waiting for merge.                                                                         |
| Unverified claim, `needs-input`, `failed`, missing result, or timeout | Set `needs-info` and report the reason.                                                                              |

Uncommitted changes or unpushed commits produce warnings. They do not invalidate
a real ready pull request. The kernel posts one comment per stop with the
outcome, summary, best-effort cost, and warnings. The agent never changes issue
labels or posts issue comments.

To address an open ready pull request's review, add `agent-ready` and rerun. The
implementation skill reads its comments and revises the same branch and pull
request. Patchmill does not merge or automatically retry failed attempts.

## Names and local output

| Item       | Default rule                                                   |
| ---------- | -------------------------------------------------------------- |
| Branch     | `agent/issue-N-<title-slug>`, with at most 48 slug characters. |
| Worktree   | `.worktrees/<branch-with-slashes-replaced-by-hyphens>`.        |
| Spec       | `docs/specs/YYYY-MM-DD-issue-N-<slug>-design.md`.              |
| Plan       | `docs/plans/YYYY-MM-DD-issue-N-<slug>.md`.                     |
| Run output | `.patchmill/runs/issue-N/<run-id>/`.                           |

Only the configured spec and plan naming patterns count as artifacts. A design
file cannot also count as a plan, even when both directories are equal. Each
attempt writes `prompt.md`, `pi.log`, `session-N.log`, `sessions/`, and
`result.json`. The prompt is replaced for each phase in the attempt. Session
logs stay separate. The aggregate `pi.log` contains stdout and stderr from all
phases. Both streams also go to the console. `result.json` is a write-only
record, never a resume input. Console output includes the final agent JSON when
present, an outcome line, and a best-effort cost line. It is not a single
machine-readable JSON stream.

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
