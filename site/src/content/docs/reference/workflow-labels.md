---
title: Workflow labels
description: The spec gate and issue lifecycle labels.
---

Labels show the issue's current state. The names below are defaults from
`patchmill.config.json`. `patchmill labels setup` creates missing labels and
leaves existing labels unchanged.

| Label           | Meaning                                               | Set by                    | Removed by           |
| --------------- | ----------------------------------------------------- | ------------------------- | -------------------- |
| `agent-ready`   | Eligible for a Run attempt.                           | Human or triage           | Kernel on claim      |
| `in-progress`   | A Run attempt holds this issue.                       | Kernel on claim           | Kernel on release    |
| `spec-review`   | The spec is pushed. A human must review it.           | Kernel after verification | Kernel on next claim |
| `spec-approved` | A human approved the spec.                            | Human                     | Human                |
| `needs-info`    | The agent asked questions, or the Run attempt failed. | Kernel                    | Kernel on next claim |
| `agent-done`    | A ready pull request that closes the issue exists.    | Kernel after verification | Human                |

## Review and resume

At a spec stop, review the pushed spec. Add `spec-approved` and `agent-ready` to
approve and resume. To request changes, leave approval off, add review comments
and `agent-ready`, then rerun. The next attempt revises the existing unapproved
spec in one planning session and stops for review again.

The plan receives review with the same pull request as the code. The kernel
never treats a pull request merge as spec approval. `agent-done` means that a
ready pull request closes the issue, not that it merged.

## Triage outcomes

Triage returns one configured value from `ready`, `unsuitable`, `blocked`, and
`needsInfo`. Their defaults are `agent-ready`, `agent-unsuitable`, `blocked`,
and `needs-info`. `wontfix` is accepted only if configured as one of those four
values. There is no automatic blocker-resolution pass.

The kernel changes issue labels and posts run comments. Planning and
implementation agents own git and the pull request, not issue mutations.
