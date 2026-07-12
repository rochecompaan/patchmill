---
title: Overview
description: Understand Patchmill's role as an agent-driven software factory.
---

Patchmill is an agent-driven software factory for turning product work into
reviewed, landed changes without hiding the engineering judgment between idea
and production.

It connects an issue host, repository policy, git worktrees, configurable
workflow skills, and Pi runtime instructions so a repository can move from open
product work to reviewed diffs with clear handoffs.

## The production-line model

Patchmill makes the stations in automated development explicit:

1. Intake product work from an issue host.
2. Sort what is ready to advance.
3. Write or reuse a plan.
4. Implement in an isolated worktree.
5. Review the result.
6. Collect evidence when the workflow asks for it.
7. Land the change.
8. Record what happened.

The goal is not a black box that writes code. The goal is a factory floor where
every station is visible, configurable, and designed to preserve software
craftsmanship while making iterative engineering scalable.

## What Patchmill controls

Patchmill coordinates local repository automation:

- Host provider access for issue and pull-request workflows.
- Repository-local configuration in `patchmill.config.json`.
- Project-local skills under `.patchmill/skills/`.
- Git worktrees for isolated implementation work.
- Approval gates for specs, plans, and implementation evidence.
- Pi runtime instructions for triage, planning, implementation, and review.

## Where Superpowers fits

Patchmill relies on the Superpowers skill pack for much of the workflow
discipline around planning, implementation, debugging, review, and verification.

In the factory metaphor, Patchmill provides the factory floor and Superpowers
provides much of the expertise that moves work through the factory.

## What to read next

- Start with the [quickstart](/getting-started/quickstart/).
- Learn how repository behavior is configured in
  [configuration](/getting-started/configuration/).
- Review [issue-agent workflows](/guides/issue-agent-workflows/) when you are
  ready to understand the full production line.
- Read [workflow artifacts](/guides/workflow-artifacts/) when you want Patchmill
  to reuse developer-authored specs or plans.
