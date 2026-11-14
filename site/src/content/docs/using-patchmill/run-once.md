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

Every selection also requires all native issue dependencies to be closed.
Automatic selection skips issues with open or unreadable dependencies. Explicit
selection refuses them, including `--interactive`, `--dry-run`, and resumed
in-progress issues. Closing the last blocker makes the issue eligible on the
next selection without another triage run.

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
After a confirmed implementation merge and issue closure, all run modes can
remove retained planning workspaces as part of merged-issue cleanup.

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

If the final label update or comment fails, the verified outcome still stands.
Patchmill records each failure next to the outcome in `result.json` and the
console, then exits with code 1. Fix the issue's labels or comment by hand.

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
| Plan                  | `docs/plans/YYYY-MM-DD-issue-N-<slug>-plan.md`.                |
| Run output            | `.patchmill/runs/issue-N/<run-id>/`.                           |

Only these spec and plan names count as artifacts. The slug comes from the issue
title and only describes the file. The issue number and the `-design` or `-plan`
suffix identify it, so a title edit never changes a file's role, even when both
directories are equal. When an issue has several files of one kind, the newest
date wins. Plans from earlier versions have no `-plan` suffix, so rename them
once to match. Each attempt writes `prompt.md`, `pi.log`, `session-N.log`,
`sessions/`, and `result.json`. The prompt is replaced for each phase in the
attempt. Session logs stay separate. The aggregate `pi.log` contains stdout and
stderr from all phases. Raw agent output stays in logs, not the console.
`result.json` is a diagnostic record, never a resume input. Cost reporting reads
its phase names, but phase selection never reads it. The console shows phase
progress, a readable final outcome, log paths, and best-effort cost.

## Cost reporting

Patchmill adds a cost table to the current planning or implementation PR. It
groups usage by phase and model across all retained local runs for the issue. An
implementation PR includes costs from earlier specification and planning PRs.
The console and issue comment continue to show the current attempt's cost.

Prompt tokens include uncached input, cache reads, and cache writes. The table
includes parent and subagent sessions. Copied assistant entries with the same ID
and usage count once. Dollar estimates use Pi's recorded prices, not a billing
statement. Missing prices leave dollar totals unavailable, not zero.

Patchmill replaces only the section between its cost markers. The rest of the PR
body stays unchanged. If usage cannot be read or publication fails, Patchmill
records a warning without changing the run outcome or skipping label cleanup.
Keep earlier run directories if later reports must include their costs.

## Supervision and cleanup

Each session uses `pi.timeoutMinutes`, which defaults to 90 minutes. On timeout,
cancellation, or termination, the kernel sends `SIGTERM` to the process group.
After five seconds, it sends `SIGKILL` if needed. The kernel attempts label
cleanup and closes the local lock handle in `finally`. A hard crash can still
leave host labels unchanged.

### Merged-issue cleanup

Every real run sweeps local issue branches and registered worktrees before
selection. This includes interactive, non-interactive, explicit-issue, and
`--plan-only` entries. The interactive CLI also sweeps before its initial
selection. A dry run performs no cleanup or cleanup writes.

The sweep works even when no open issue is eligible. An explicitly named closed
issue can therefore clean up before normal selection refuses it. Cleanup never
reclaims or reopens that issue. If an operator quits the Review wait before
merge, the next real run can clean up later. A confirmed interactive merge also
cleans up immediately before the run returns.

Each cleanup holds the issue OS lock. Contention skips that issue without
waiting. Fresh host facts must prove a closed issue and a merged implementation
PR into the resolved base. Its head must match the implementation branch in the
push repository, and its body must close this issue. Open replacements,
closed-unmerged PRs, wrong targets, and planning merges never authorize cleanup.
Local discovery still works after the host removes the remote branch.

### Hook and removal order

The optional top-level `cleanupHook` runs as `bash <cleanupHook>` from the
implementation worktree. Patchmill treats its value as one script path, not a
shell command. Relative paths resolve there. The script needs no executable bit.
A missing hook is a no-op.

The hook runs before any worktree or branch removal, including when the
implementation directory is dirty. After hook success, Patchmill inspects each
workspace again. It keeps every dirty workspace and its local branch and reports
its absolute path. Clean implementation and optional gated spec/plan workspaces
can be removed independently. Cleanup never removes remote branches or run
state.

A non-zero exit or other hook error keeps every worktree and branch. It does not
change the done outcome. The operator receives the error and the log path. Hook
stdout, stderr, exit status, and cleanup diagnostics enter
`<runsDir>/issue-N/cleanup.log`. Immediate cleanup diagnostics also enter the
current run's `pi.log`.

Use idempotent scripts that touch only resources scoped to the issue or
worktree. Tolerate missing resources. Exit non-zero when cleanup is incomplete.
Never remove Patchmill worktrees, branches, PRs, run state, or lock files from
the hook.

### Retries and manual recovery

After a successful hook step, `<runsDir>/issue-N/cleanup.json` records the merge
identity. An absent hook also completes that step. Later sweeps can retry dirty
or partially removed workspaces without repeating a successful hook. Adding or
changing the hook later does not repeat a completed step for that merge.

The receipt never replaces fresh merge verification or selects a phase. Logs and
`result.json` do not authorize cleanup. A failed hook creates no success receipt
and can retry on a later real run. A crash before receipt publication can also
require a retry, so hook scripts must be idempotent.

A corrupt or mismatched receipt requires manual inspection. A configured hook
also needs the implementation directory unless a matching receipt already proves
success. Patchmill preserves targets rather than selecting a different working
directory or guessing from an invalid receipt. If the log cannot be opened or
the receipt cannot be written, removal stops. A log error during removal stops
further removals and reports the targets already removed.

For inspected manual removal, use the human-controlled `patchmill-cleanup`
skill. It offers the configured hook first and requires explicit consent and the
same OS lock. Keep permanent lock files and their parent directories intact. For
independent concurrent issues, allocate separate ports, databases, and services.
Do not change shared configuration or Git state during active runs. See
[Git safety](/reference/git-safety/) for host branch protection.
