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

## Workflow

Patchmill combines deterministic code for state, safety, and validation with
skills for judgment-heavy agent work so each issue gets the best end result.

![Patchmill workflow diagram showing the triage and run-once phases, code-controlled steps, skill-configured steps, and issue-tracker updates.](../../../assets/patchmill-workflow.svg)

## What to read next

- Start with the [quickstart](/getting-started/quickstart/).
- Learn how repository behavior is configured in
  [configuration](/getting-started/configuration/).
- Use [Triage](/using-patchmill/triage/) and
  [Run-once](/using-patchmill/run-once/) when you want the detailed command
  behavior.
- Read [workflow artifacts](/using-patchmill/workflow-artifacts/) when you want
  Patchmill to reuse developer-authored specs or plans.
