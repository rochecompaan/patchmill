---
title: Run unattended
description: Triage and run issues one at a time under a process supervisor.
---

`patchmill run` triages and runs issues one at a time until you stop it. It
works in label mode and in local state mode. It needs no control plane.

```sh
patchmill run
patchmill run --help
```

The command accepts no other options. It loads `patchmill.config.json` once, at
start. Restart the runner after you change the configuration.

## The loop

Each cycle has two steps:

1. When `run.triageIntervalMinutes` has passed since the last triage, run
   triage, as `patchmill triage` does. Triage runs at the first cycle too.
2. Run one pass of work. A pass is one `patchmill run-once` without `--issue`.
   It cleans up merged issues, resolves a merge conflict, resumes in-progress
   work, and selects the next eligible issue.

The result of the pass decides what happens next:

| Pass result                                        | Next step                        |
| -------------------------------------------------- | -------------------------------- |
| A pull request is ready, or the run stopped        | Start the next cycle at once.    |
| No issue is eligible                               | Wait, then start the next cycle. |
| A planning gate waits for a merge                  | Wait, then start the next cycle. |
| Another attempt or clone holds the issue           | Wait, then start the next cycle. |
| The run threw, or a label or comment update failed | Wait with the error backoff.     |
| The third Needs Info stop in a row, and later ones | Wait with the error backoff.     |

A planning gate wait posts its waiting comment once. Later passes do not post
the same comment again. A failed triage is logged, and the pass still runs.

The Needs Info rule stops a broken provider or Pi installation from moving each
ready issue to `needs-info` without a pause. Issues still move to `needs-info`:
three at once, then one after each error wait.

## Merge conflicts

When one pull request merges, another open Patchmill pull request can conflict
with the base branch. Before it selects new work, a pass checks each Done issue
with an open implementation pull request. It runs `git merge-tree` on the
fetched branches, so the check is the same for every host. Planning pull
requests are not checked.

The oldest conflicting issue goes first. Its status changes to In Progress, and
an agent merges the base branch into the issue branch. It never rebases or
force-pushes. Patchmill then checks the pushed branch: it must merge cleanly,
and it must contain its previous head and the base commit. The issue then goes
back to Done. If the agent cannot resolve the conflict, or a check fails, the
issue stops with Needs Info and a comment that names the files.

A pull request is not tried again while its head and the base stay the same. A
new attempt also waits at least `run.conflictRetryMinutes` after the last one.
When another run holds the issue, the pass skips it and selects other work.

## Backoff

The `run.idleBackoff` and `run.errorBackoff` settings each have an
`initialSeconds` and a `maxSeconds` value. The wait doubles after each pass of
the same kind, up to `maxSeconds`. Jitter makes the actual wait between half and
all of that value. A pass that does work resets both waits. An idle pass resets
the error wait, and an error resets the idle wait.

| Key                               | Default |
| --------------------------------- | ------- |
| `run.triageIntervalMinutes`       | `5`     |
| `run.conflictRetryMinutes`        | `30`    |
| `run.idleBackoff.initialSeconds`  | `60`    |
| `run.idleBackoff.maxSeconds`      | `900`   |
| `run.errorBackoff.initialSeconds` | `30`    |
| `run.errorBackoff.maxSeconds`     | `1800`  |

Triage runs only between waits. So during a long wait, triage can run less often
than `run.triageIntervalMinutes`.

## One runner per clone

The runner takes a lock at `<git common directory>/patchmill/run.lock`. All
worktrees of the clone share this file. A second `patchmill run` in the same
clone exits with code 2 and names the owner.

The operating system frees the lock when the runner exits, also after a crash.
The file keeps a record with the instance ID, PID, process start marker, host,
and repository. On the next start, Patchmill replaces a record only when it is
demonstrably stale on the same host: its PID is gone, or the PID now belongs to
another process. A record from another host is never replaced. Remove the file
by hand when that runner is gone.

The lock does not cover a second clone of the repository:

- In local state mode, run one runner per repository. Two clones do not share
  local state.
- In label mode, two clones can still race for the same claim in a short window,
  as with `run-once`.

## Stop and exit codes

The first `SIGINT` or `SIGTERM` stops the loop. The active run or triage gets
the stop request. A run pauses: Patchmill publishes no comment or label change,
the issue stays `in-progress`, and the next start resumes it. Verified completed
work still publishes. A second signal forces an exit.

| Exit code | Meaning                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| 0         | A clean stop after a signal.                                                                         |
| 1         | Invalid arguments, configuration, or mode, a failed host CLI check, a fatal error, or a forced exit. |
| 2         | Another runner owns the lock, or its record is not demonstrably stale.                               |

## Run it under systemd

```ini
[Unit]
Description=Patchmill runner for my-repo

[Service]
WorkingDirectory=/srv/my-repo
ExecStart=/usr/bin/env patchmill run
Restart=on-failure
RestartPreventExitStatus=2
KillSignal=SIGTERM
KillMode=control-group
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

`KillMode=control-group` is the systemd default. Keep it. A forced exit ends the
runner before Pi stops, and a Pi process group that ignores `SIGTERM` can then
stay alive. The control group kill stops it. `TimeoutStopSec=30` gives the
active Pi session time to stop after the first signal.

## Logs

The runner writes one line per event to stderr, with the prefix
`patchmill run:`. Events include start, triage start and end, the pass result,
each wait, errors, and the stop. The output of each run and triage is the same
as for `run-once` and `triage`.
