---
title: Workflow labels
description:
  Reference triage labels, approval labels, and blocked issue behavior.
---

Patchmill uses labels for two related purposes:

- **triage labels** classify whether an issue is ready for automation;
- **workflow approval labels** control when `run-once` may continue through spec
  and plan gates.

## Triage state map

Use `triage.stateMap` to map repository labels into Patchmill's canonical triage
buckets. Keep the dashed `labels["in-progress"]` key exactly as shown in JSON.

```json
{
  "labels": {
    "ready": "ready-for-agent",
    "in-progress": "in-progress",
    "done": "agent-done",
    "blocked": "blocked"
  },
  "triage": {
    "stateMap": {
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
      "blocked": "blocked",
      "wontfix": "agent-unsuitable"
    }
  }
}
```

`triage.stateMap` keys are repository label names. Values are limited to:

- `agent-ready`
- `needs-info`
- `agent-unsuitable`
- `blocked`

The configured `labels.ready` label must map to `agent-ready`.

## Approval labels

`workflow.specApproval` and `workflow.planApproval` configure approval labels
that control when `patchmill run-once` may proceed. These are workflow signals,
not triage buckets, so they are not nested under `labels` and are not added to
`triage.stateMap`.

```json
{
  "workflow": {
    "specApproval": {
      "required": true,
      "reviewLabel": "spec-review",
      "approvedLabel": "spec-approved"
    },
    "planApproval": {
      "required": true,
      "reviewLabel": "plan-review",
      "approvedLabel": "plan-approved"
    }
  }
}
```

`run-once` treats the configured ready label, spec-approved label, and
plan-approved label as actionable workflow states. Review labels without
matching approved labels are waiting states for human review.

## Approval flows

When both spec and plan approval are required:

```text
agent-ready   --run-once--> write spec, stop at spec-review
spec-approved --run-once--> write/reuse spec, write plan, stop at plan-review
plan-approved --run-once--> write/reuse spec and plan, implement, stop at agent-done
```

When spec approval is required and plan approval is not required:

```text
agent-ready   --run-once--> write spec, stop at spec-review
spec-approved --run-once--> write/reuse spec, write plan, implement, stop at agent-done
```

When spec approval is not required and plan approval is required:

```text
agent-ready   --run-once--> write spec, write plan, stop at plan-review
plan-approved --run-once--> write/reuse spec and plan, implement, stop at agent-done
```

When neither approval is required:

```text
agent-ready --run-once--> write spec, write plan, implement, stop at agent-done
```

Humans may either replace review labels with approved labels or add approved
labels while leaving review labels in place. Patchmill tolerates both and
removes stale `spec-*` and `plan-*` workflow labels as it advances.

`projectPolicy.planRequiresApproval` remains as a compatibility alias. If
`workflow.planApproval.required` is omitted, Patchmill derives plan approval
from `projectPolicy.planRequiresApproval`. If both are present,
`workflow.planApproval.required` wins.

## Blocked triage state

`blocked` means the issue is clear and suitable for automation but must wait for
specific same-repository issues to close. The triage agent records those
blockers as issue numbers in `blockedBy` and in a comment line such as:

```text
Blocked by: #1, #2
```

Later triage runs re-check those blocker issues. When all blockers are closed,
Patchmill removes the blocked label, adds the ready label, and posts an unblock
comment.
