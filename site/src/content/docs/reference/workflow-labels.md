---
title: Workflow labels
description: Issue lifecycle labels and planning merge gates.
---

Labels show the issue's current state. The names below are defaults from
`patchmill.config.json`. `patchmill labels setup` creates missing labels and
leaves existing labels unchanged.

| Label              | Meaning                                               | Set by                    | Removed by              |
| ------------------ | ----------------------------------------------------- | ------------------------- | ----------------------- |
| `agent-ready`      | Eligible for a Run attempt.                           | Human or triage           | Kernel on claim         |
| `in-progress`      | Work is active or waiting for a planning PR merge.    | Kernel on claim           | Kernel on final release |
| `needs-info`       | The agent asked questions, or the Run attempt failed. | Kernel                    | Kernel on next claim    |
| `agent-done`       | A ready pull request that closes the issue exists.    | Kernel after verification | Human                   |
| `agent-unsuitable` | The issue is not suitable for unattended agent work.  | Triage                    | Human                   |
| `blocked`          | The issue has an unresolved blocker.                  | Triage                    | Human                   |

## Review and resume

Spec and plan gates default off. Each required gate uses a separate planning
pull request. Only merging that PR into the base unlocks the next stage. Review
approval and issue labels do not grant approval. The issue stays `in-progress`
while waiting. Rerun after the merge without adding approval or ready labels. An
open planning PR does not start another Pi session.

Retired spec/plan review and approval labels are not created or used. Old
configuration keys for these labels are accepted but ignored. Patchmill does not
delete existing host labels. A planning merge never marks an issue done.
`agent-done` means that an implementation PR closes the issue, not that it
merged.

## Triage outcomes

Triage returns one configured value from `ready`, `unsuitable`, `blocked`, and
`needsInfo`. Their defaults are `agent-ready`, `agent-unsuitable`, `blocked`,
and `needs-info`. `wontfix` is accepted only if configured as one of those four
values. There is no automatic blocker-resolution pass.

The kernel changes issue labels and posts run comments. Planning and
implementation agents own git and pull requests, not issue mutations.
