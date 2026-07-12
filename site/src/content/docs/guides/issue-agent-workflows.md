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

## Workflow artifacts

Specs and plans are workflow artifacts. Patchmill can reuse artifacts that were
published with `patchmill set-spec` and `patchmill set-plan`, or create missing
artifacts when the repository approval policy requires them.

Read [workflow artifacts](/guides/workflow-artifacts/) for the deterministic
publishing format and the issue content that does not count as an authoritative
artifact.

## Run-once workflow

`patchmill run-once` advances one ready issue through the configured production
line. In execute mode, the high-level sequence is:

1. Select a ready issue or resume a retryable run.
2. Verify repository preconditions, including branch-base safety and clean
   worktree checks.
3. Load the issue body and comments.
4. Read Patchmill-owned deterministic artifact comments created by `set-spec`
   and `set-plan`.
5. Validate artifact checksums before issue labels, comments, or run state are
   mutated.
6. Claim the issue and create an isolated implementation worktree.
7. Materialize published artifacts under their recorded docs paths in the issue
   worktree.
8. Generate only the missing spec or plan artifacts required by the approval
   policy.
9. Stop for spec or plan approval labels when the configured gates require human
   review.
10. Run optional development-environment preparation.
11. Run implementation with configured skills and runtime instructions.
12. Request review, collect evidence, and create or update the pull request when
    the workflow asks for those steps.
13. Record run state and handoff information.

`patchmill run-once --dry-run` keeps a cheap transition preview. It does not
read workflow artifacts or mutate issue state.

## Approval gates

Patchmill keeps gates explicit. A repository can require approved specs,
approved plans, implementation review, or evidence collection before work
advances.

Approval gates make automated work auditable: reviewers can see what was
planned, what changed, what was verified, and what remains blocked.

## Continuous run status

`patchmill run` is still in progress. Treat experiments with the continuous
factory loop as development testing rather than supported usage.
