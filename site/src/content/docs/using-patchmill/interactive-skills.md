---
title: Interactive skills
description: >-
  Install and use Patchmill's human-controlled Pi skills for planning,
  publication, labels, and issue-worktree cleanup.
---

Patchmill ships four human-invoked, user-global Pi skills for the parts of an
issue workflow that need distinct authorization.

## User-global, not project-local

`patchmill-plan`, `patchmill-upload`, `patchmill-label`, and `patchmill-cleanup`
are not `patchmill.config.json` workflow entry points. They are separate human
tools. `patchmill init` and `patchmill skills update` neither install nor update
them. In particular, `patchmill-plan` is the interactive orchestrator, while
project-local `patchmill-planning` supplies the configured planning workflow it
uses.

## Install and invoke

The npm package ships `skills/patchmill-plan`, `skills/patchmill-upload`,
`skills/patchmill-label`, and `skills/patchmill-cleanup`. An operator or
configuration manager must expose those directories as Pi user-global skills,
normally under `~/.pi/agent/skills/`; Patchmill does not provide an installer.

Use Pi's built-in command names:

```text
/skill:patchmill-plan 123

# Review and revise the local spec and plan as long as needed.

/skill:patchmill-upload
/skill:patchmill-label 123 +spec-approved +plan-approved +agent-ready -needs-info
/skill:patchmill-cleanup
```

Abbreviated handoff text such as `/patchmill-upload 123` means
`/skill:patchmill-upload 123` in stock Pi. Explicit positive issue numbers
override conversational context. In one repository conversation, a later skill
can omit its number when exactly one issue remains unambiguous, as upload and
cleanup do above; explicitly supplying `123` remains valid.

## Review-first handoffs

`patchmill-plan` creates and reviews local specification and implementation-plan
artifacts, then stops before implementation. Its `/patchmill-upload` suggestion
is a later option, not a claim that review is complete or publication-ready.
Review and revise artifacts for as long as needed before invoking upload.

On success, planning suggests upload. Upload publishes every available changed
artifact without a further confirmation, skips current attachments, and suggests
a complete configured label command only when no artifact is failed or
ambiguous. Missing artifacts do not suppress that suggestion. `patchmill-label`
accepts requested label changes without workflow warnings or another
confirmation, and suggests cleanup only after every request verifies as applied
or a no-op. It suppresses cleanup after skipped, failed, or ambiguous results.

## Cleanup authority and risk

`patchmill-cleanup` is never automatic. It inspects the selected issue worktree
and branch, including likely lost work, then requires one confirmation naming
both. Informed confirmation can delete dirty files, untracked files, unmerged
commits, or apparently active work. Cleanup intentionally does not check whether
artifacts were published.
