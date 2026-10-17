---
title: Interactive skills
description: Human-controlled planning, labels, and cleanup.
---

`patchmill-plan`, `patchmill-label`, and `patchmill-cleanup` are
human-controlled skills. `init` installs them in `.patchmill/skills`, not as
global agent skills. They are not additional CLI commands or configuration entry
points. Load them through your coding agent's skill mechanism. For Pi, a loaded
skill can be invoked as `/skill:patchmill-plan 123`.

## Local planning

`patchmill-plan` resolves the issue branch and worktree, then prepares or
revises local specs and plans. It does not implement, publish, change labels, or
clean up. If required spec approval is absent, it revises the spec and stops
before the plan. Local self-review does not grant approval.

For kernel planning and publication, run
`patchmill run-once --issue N --plan-only` as a separate operator action. It
reuses the same issue branch and worktree.

## Labels

`patchmill-label` inspects the current host and issue labels and applies only
human-authorized changes. It preserves unrelated labels. If a requested label is
missing, it asks before creating it. The kernel does not expose this skill as an
issue-mutation tool to unattended agents.

## Cleanup

`patchmill-cleanup` inspects dirty files, unique commits, and merge state before
requesting explicit deletion confirmation. It never removes remote branches. It
must hold the same issue OS lock throughout cleanup and prevent competing runs.
If it cannot establish ownership safely, it stops and asks.

Never delete or replace the permanent issue lock or its parent directory. Empty
or stale diagnostic JSON does not authorize cleanup. A successful
`patchmill release --issue N` only resets labels under the lock. It does not
hold that lock for later cleanup.
