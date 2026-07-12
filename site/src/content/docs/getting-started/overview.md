---
title: Overview
description: Understand what Patchmill does and where skills fit.
---

Patchmill is a CLI for running issue-tracker-driven agent workflows in a
repository.

It uses the issue tracker as the visible state record: issues, labels, comments,
pull requests, and approval labels show where work is in the workflow. Patchmill
uses local git state and worktrees for repository changes, then writes status
back to the issue tracker.

Patchmill is configured through skills. A skill is a versioned instruction set
for one phase of the workflow, such as triage, specification and plan writing,
implementation, visual evidence, review, or landing decisions.

The important boundary is the contract around the black box:

- Patchmill code owns the workflow state machine, host-provider side effects,
  git safety checks, worktree creation, artifact validation, approval gates, and
  final result validation.
- Skills own the instructions given to agents for judgment-heavy work inside a
  phase.
- The issue tracker records what happened so humans can inspect, approve, retry,
  or stop work without relying on hidden agent state.

## Workflow at a glance

This diagram separates code-controlled steps from skill-configured steps.

```text
Issue tracker
issues, labels, comments, pull requests
        │
        ▼
[code] Load repository config and provider state
        │
        ▼
[code] Read issues and current labels/comments
        │
        ├─ patchmill triage
        │      │
        │      ▼
        │   [skill: triage] Classify issues and propose labels/comments
        │      │
        │      ▼
        │   [code] Apply allowed labels/comments to the issue tracker
        │
        └─ patchmill run-once
               │
               ▼
            [code] Select an eligible issue and check git safety
               │
               ▼
            [code] Read deterministic spec/plan artifacts and checksums
               │
               ├─ missing spec or plan
               │      │
               │      ▼
               │   [skill: planning] Write the required spec or plan
               │      │
               │      ▼
               │   [code] Record artifact state and stop for approval if required
               │
               ▼
            [code] Claim the issue, create a worktree, materialize artifacts
               │
               ├─ optional local setup
               │      ▼
               │   [skill: developmentEnvironment] Prepare local services/tools
               │
               ▼
            [skill: implementation] Apply the approved plan in the worktree
               │
               ├─ visible UI changed
               │      ▼
               │   [skill: visualEvidence] Capture committed reference screenshots
               │
               ▼
            [skill: review] Review the implementation when configured
               │
               ▼
            [skill: landing] Decide direct land versus pull request when configured
               │
               ▼
            [code] Validate final JSON, evidence, git state, labels, and PR state
               │
               ▼
            Issue tracker updated with status, comments, and pull request links
```

## What to read next

- Start with the [quickstart](/getting-started/quickstart/).
- Learn how repository behavior is configured in
  [configuration](/getting-started/configuration/).
- Review [issue-agent workflows](/guides/issue-agent-workflows/) when you want
  the detailed command behavior.
- Read [workflow artifacts](/guides/workflow-artifacts/) when you want Patchmill
  to reuse developer-authored specs or plans.
