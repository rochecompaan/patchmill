---
title: Workflow labels
description: Reference triage labels and legacy compatibility label fields.
---

Patchmill uses triage labels to classify whether an issue is ready for
automation. Configure `triage.stateMap` to map repository labels to
`agent-ready`, `needs-info`, `agent-unsuitable`, or `blocked`. The configured
ready label must map to `agent-ready`.

## Planning review-gate settings

`workflow.specApproval.required` and `workflow.planApproval.required` are
planning review-gate settings for a fresh Issue run. At initialization,
`planning-pr-v1` snapshots their required values. A required gate means the
assigned spec or plan phase is reviewed in a planning pull request and advances
only after that exact pull request is merged and verified.

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

The property names remain stable. `reviewLabel` and `approvedLabel` are
compatibility data for unfinished legacy runs; adding an approval label does not
authorize a fresh phase. See the four pull-request sequences in
[Run-once](/using-patchmill/run-once/#gate-matrix).

## Blocked triage state

`blocked` means an otherwise suitable issue waits for specific same-repository
issues. Triage records the blocker numbers and rechecks them later. When all are
closed, Patchmill removes `blocked`, restores the ready label, and posts an
unblock comment.

## Legacy approval-label flow

For unfinished legacy Issue runs only, review and approved labels retain their
previous control meaning. Legacy runs may select ready, spec-approved, or
plan-approved states and consume deterministic artifact comments. Do not use
this flow to advance fresh planning state; review, merge, and rerun the exact
planning pull request instead.
