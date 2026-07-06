---
title: Issue-agent workflows
description:
  Understand how Patchmill moves issues through triage and implementation.
---

Patchmill issue-agent workflows turn issue-host work into visible, reviewable
repository changes.

## Triage workflow

The triage workflow inspects open issues and determines whether each issue is
ready to advance. In dry-run mode, it previews classification without mutating
issues:

```sh
patchmill triage --dry-run
```

A normal triage run can apply labels and comments according to the configured
provider and state map.

## Run-once workflow

`patchmill run-once` advances one ready issue through the configured production
line. The workflow can reuse approved artifacts from an issue or create new
artifacts when the approval policy requires them.

The high-level sequence is:

1. Select a ready issue.
2. Check repository and provider preconditions.
3. Resolve or create the required spec and plan artifacts.
4. Claim the issue and create an isolated implementation worktree.
5. Run implementation with configured skills and runtime instructions.
6. Request review.
7. Collect evidence when the workflow asks for it.
8. Record run state and handoff information.

## Approval gates

Patchmill keeps gates explicit. A repository can require approved specs,
approved plans, implementation review, or evidence collection before work
advances.

Approval gates make automated work auditable: reviewers can see what was
planned, what changed, what was verified, and what remains blocked.

## Continuous run status

`patchmill run` is still in progress. Treat experiments with the continuous
factory loop as development testing rather than supported usage.
