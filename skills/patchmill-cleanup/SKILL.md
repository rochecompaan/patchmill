---
name: patchmill-cleanup
description: >-
  Use when a human wants to inspect and remove a Patchmill issue worktree and
  branch; not for unattended or automated runs.
---

# Patchmill Cleanup

## Context and local prerequisites

Use only in a human-controlled Pi session; stop in print, RPC, unattended, or
automated contexts. Resolve only a Patchmill issue workspace: an explicit
positive issue number wins, otherwise reuse and restate one unambiguous
same-repository conversational issue, or ask. Never accept an arbitrary path.
Read root configuration, worktree/run-state paths, configured base branch and
branch/worktree strategy, then inspect local Git state. Issue-host access,
attachments, and publication state are not prerequisites and must not be
inspected.

## Inspect before the gate

Show the issue, absolute worktree path, target branch and base branch, staged,
unstaged, and untracked files, branch-unique commits, merge state, and run-state
or active-ownership indications. Explicitly summarize work deletion may lose.
Dirty/untracked files, unmerged commits, and apparent ownership inform the
choice but do not block cleanup alone.

## Destructive confirmation

Ask once for an explicit confirmation naming both the worktree and branch. A
refusal makes no mutation. After confirmation, reread configuration, Git, and
run-state. If any displayed target or loss detail changed, show the new summary
and require a new named confirmation. Then run commands from the primary
checkout, never the target worktree. Always remove both targets: use
`git worktree remove --force <path>` when required by state, and use
`git branch -D <branch>` when unmerged (otherwise non-force removal/deletion is
acceptable).

## Verify and resume

Verify the worktree is absent from `git worktree list` and the branch is absent
from refs. Report precisely whether each target was removed; on partial or
uncertain deletion stop rather than retrying blindly, preserving the remaining
state for a later invocation.
