---
title: Agent workflow lifecycle
description: How triage, planning, and implementation share one issue branch.
---

Triage classifies issues. Run-once advances a selected issue. The kernel owns
issue labels and run comments. The agent owns git, artifacts, and the pull
request. Skills guide judgment within those boundaries.

## From ready issue to spec review

1. The kernel selects an issue and acquires its permanent local OS lock.
2. The kernel swaps the ready label for `in-progress` and rereads the issue.
3. The kernel fetches `origin`, reuses or creates the issue worktree, and
   derives the phase.
4. The planning agent writes the spec, commits, pushes, and opens or updates a
   draft pull request.
5. The kernel checks the remote branch and spec. With required approval absent,
   it stops at `spec-review`.

## Human review

A human reviews the spec and adds `spec-approved` and `agent-ready` to resume.
To request changes, the human leaves approval off, adds review comments and
`agent-ready`, then reruns. One planning session revises the existing spec and
stops at `spec-review` again. It does not grant approval or implement. A merged
pull request takes precedence over this revision rule.

## From approval to ready pull request

After approval, planning writes the missing plan on the same branch.
Implementation reads the spec and plan, prepares the environment, implements,
validates, commits, pushes, and marks the same pull request ready. The plan
receives review with that pull request.

The kernel checks that an open, non-draft pull request has the issue branch as
head and closes the issue in its body. It then sets `agent-done`. Merge is a
later human or host action, not a completion prerequisite. A later rerun on an
open ready pull request addresses its review comments.

## Failure and resumption

A missing result, unverified claim, timeout, `needs-input`, or `failed` stops
with `needs-info`. The kernel posts the summary and warnings. A human answers
questions and adds `agent-ready` before retrying. After a hard crash,
`patchmill release --issue N` locks the issue before resetting a stale
`in-progress` label.

Every attempt derives its phase from git and the host. Logs, sessions, and
`result.json` are outputs only. There is no saved workflow checkpoint or
earlier-version reader. The kernel never removes the issue worktree or the
permanent lock inode, the filesystem object behind the lock path. Read
[Run-once](/using-patchmill/run-once/) for the full derivation table.
