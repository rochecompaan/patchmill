---
title: Task contracts
description:
  Reference the issue-to-plan contracts Patchmill uses to coordinate workflow
  artifacts.
---

Task contracts define how Patchmill identifies the artifacts attached to an
issue-agent workflow.

They describe how issue content, labels, comments, and generated artifacts map
to specs, plans, implementation tasks, and review checkpoints.

## Relationship to skills

Skills explain how an agent should do the work. Task contracts explain how
Patchmill recognizes the artifacts that move work from one station to the next.

## Common fields

Task contract configuration can include patterns for:

- Todo titles.
- Todo tags.
- Plan task headings.
- Spec and plan artifact labels.
- Review and evidence markers.

## Matching rules

Keep task-contract patterns stable and easy to read. They are part of the
interface between Patchmill automation, issue-host state, and human reviewers.

When changing task contracts, run a dry run against representative issues before
using the new configuration on production work.

## Repository reference

The detailed reference remains in `docs/task-contracts.md` in the Patchmill
repository.
