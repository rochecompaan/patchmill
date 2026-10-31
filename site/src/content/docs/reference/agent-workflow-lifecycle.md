---
title: Agent workflow lifecycle
description: How merge gates connect planning and implementation.
---

Triage classifies issues. Run-once advances a selected issue. The kernel owns
issue labels and run comments. The agent owns git, artifacts, and pull requests.
Skills guide judgment within those boundaries.

## From ready issue to planning

1. The kernel selects an open ready or in-progress issue and acquires its
   permanent local OS lock.
2. The kernel swaps the ready label for `in-progress` and rereads the issue.
3. The kernel fetches `origin` and reads the required gates and their planning
   pull requests. It selects the workspace for the next stage.
4. The planning agent writes the required documents, commits, and pushes them. A
   required gate also publishes a non-closing planning pull request.
5. The kernel checks the artifacts and host facts. A required planning gate
   keeps the issue `in-progress` until that pull request merges.

## Human review and merge

Both planning gates default off. Enable `workflow.specApproval.required` for a
separate spec PR, or `workflow.planApproval.required` for a separate plan PR.
Only merging a required planning PR into the base unlocks the next stage. Review
approval or an approval label is not enough. An open planning PR causes no
further Pi sessions, even if the issue also has `agent-ready`.

With both gates enabled, merge the spec PR first, then the plan PR. Run
`patchmill run-once --issue N` after each merge. Each later branch starts from
the fetched base and must contain the merged artifacts. A closed, unmerged
planning PR, missing artifact, or stale copy of a merged artifact needs human
input.

If a gate is off, its document accompanies the next required planning PR.
Without any remaining gate, missing documents go into the implementation branch.
Planning PRs use `Refs #N`, never an issue-closing reference. Merging a planning
PR never marks the issue done.

## From planning to ready implementation

Implementation reads the spec and plan, prepares the environment, implements,
validates, commits, pushes, and marks the implementation pull request ready. The
kernel checks that an open, non-draft PR has the implementation branch as head
and closes the issue in its body. It then sets `agent-done`. Merge is a later
human or host action, not a completion prerequisite. A later rerun on an open
ready implementation PR addresses its review comments.

## Failure and resumption

A missing result, unverified claim, timeout, `needs-input`, or `failed` stops
with `needs-info`. The kernel posts the summary and warnings. A human answers
questions and adds `agent-ready` before retrying. After a hard crash,
`patchmill release --issue N` locks the issue before resetting a stale
`in-progress` label. Do not release a normal planning wait to approve it.

Every attempt derives its phase from git and the host. Logs, sessions, and
`result.json` are outputs only. There is no saved workflow checkpoint. The
kernel never removes issue worktrees or the permanent lock inode, the filesystem
object behind the lock path. Read [Run-once](/using-patchmill/run-once/) for the
full derivation table.
