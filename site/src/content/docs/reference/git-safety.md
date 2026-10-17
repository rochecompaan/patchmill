---
title: Git safety
description: Issue worktrees, permanent locks, and host branch protection.
---

Patchmill fetches `origin` before deriving the phase. It uses one branch and
worktree per issue. A matching remote branch is reused. With no branch, the
worktree starts from the base branch. Several matching issue branches stop the
attempt with `needs-info` rather than selecting one.

`git.baseBranch: null` uses the remote default branch. Set a string to choose
another target branch. Branch names use `agent/issue-N-<slug>`, with at most 48
slug characters. Worktree names replace branch slashes with hyphens. The kernel
never deletes an issue worktree.

## Ownership

An OS-managed advisory lock prevents cooperating processes in one clone from
owning the same issue. This assumes a local filesystem with working advisory
locks. The kernel retains the handle through agent work and label cleanup.
Across clones, the ready-to-in-progress label swap has a narrow accepted race.
Do not treat it as a distributed lock.

The permanent `<runsDir>/issue-N/lock` file must keep its inode, the filesystem
object behind its path. Never remove or replace the file or its parent
directory. This rule applies after release and crash recovery too. The PID and
start time are diagnostic only. Neither their presence nor absence proves
ownership. The OS releases the lock when the handle closes or owner exits.

After a hard crash, `patchmill release --issue N` acquires the same lock before
resetting `in-progress` to `agent-ready`. Contention refuses the operation
without changing host labels. Label reset is not a lasting cleanup lock.

## Publication and branch protection

The skills tell agents to commit and push the issue branch, never push the base
branch, and never force-push. Shell access cannot enforce those instructions.
Direct landing is a host control, not a Patchmill feature. Use branch protection
on the host to prevent direct base-branch pushes.

Implementation success requires an open, non-draft pull request with the issue
branch as head and a body that closes the issue. The kernel then sets
`agent-done`. It does not wait for merge. Uncommitted changes or unpushed
commits produce warnings rather than invalidating a real ready pull request.

## Operator safety

For independent concurrent issues, allocate separate ports, databases, and
external services. Do not change shared configuration or Git state during active
attempts. Keep logs and sessions local because they can contain secrets.

Use the human-controlled `patchmill-cleanup` skill for worktree removal. Require
explicit loss confirmation and ownership of the same OS lock throughout cleanup.
Never use file deletion or diagnostic PID checks as lock recovery. See
[Run-once](/using-patchmill/run-once/) for supported resume actions.
