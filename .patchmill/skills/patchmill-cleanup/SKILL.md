---
name: patchmill-cleanup
description:
  Use when a human wants to inspect and remove a Patchmill issue worktree and
  optionally its local branch.
---

# Patchmill Cleanup

Use only in a human-controlled interactive session, not a kernel or unattended
run. Resolve an issue number, never an arbitrary deletion path. Use an explicit
positive number first, or restate one unambiguous same-repository issue from the
conversation. If the issue is ambiguous, ask before proceeding.

## Inspect and refuse active work

Read the root `patchmill.config.json` and local Git state. Resolve the single
issue branch and worktree from the configured paths and existing Git
registration. Planning and implementation share that branch and worktree. Do not
remove a separate phase workspace. Show the absolute path, branch, base, dirty
and untracked files, branch-unique commits, and merge state. Describe the work
that deletion will lose. Ask whether to retain or delete the local branch. Never
delete remote branches through this skill.

Stop while an issue run is active. The permanent lock is
`<runsDir>/issue-N/lock`, where `runsDir` comes from configuration. Its PID and
JSON are diagnostic data only. Missing, empty, stale, or corrupt JSON does not
authorize cleanup. Do not recover ownership from a PID or a timeout. Do not
unlink, replace, or remove the lock or its parent directory, even after release
or a crash.

If the operator requests a label reset, `patchmill release --issue N` acquires
the same OS lock and refuses on contention. It resets in-progress to ready when
needed. It does not delete the worktree or the permanent lock. Do not use a
successful release as a lasting cleanup lock. Another run can start after it
returns. Before deletion, require a way to hold the same OS lock throughout
cleanup and prevent competing runs. If that ownership cannot be established
safely with available tools, stop and ask the operator. There is no
`patchmill cleanup` or offline lock-purge command in this contract.

## Confirm and remove

Ask for explicit confirmation naming the worktree and the optional branch
deletion. After confirmation and lock acquisition, reread the configuration and
Git state. If the target or loss details changed, show the new details and
require confirmation again. Run Git commands from the primary checkout, never
from the target worktree. Remove the worktree with `git worktree remove <path>`.
If confirmed losses require force, use `git worktree remove --force <path>`. If
branch deletion was confirmed, use `git branch -d <branch>` for merged work. Use
`git branch -D <branch>` only for explicitly confirmed unmerged work. Release
the OS lock handle without removing its file or parent.

## Report

Make sure that `git worktree list` no longer registers the target. If deletion
was requested, make sure that the branch no longer exists in local refs. Report
each removal, retained branch, failure, and remaining state separately. If
deletion is partial or uncertain, stop rather than retrying blindly. Preserve
the permanent lock inode and parent in every outcome.
