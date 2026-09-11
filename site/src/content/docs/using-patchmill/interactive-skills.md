---
title: Interactive skills
description:
  Use Patchmill's human-controlled skills without confusing them with Run-once.
---

`patchmill-plan`, `patchmill-upload`, `patchmill-label`, and `patchmill-cleanup`
are human-invoked skills. They are not `patchmill.config.json` workflow entry
points, and `patchmill init` or `patchmill skills update` does not install them
as global agent skills.

## Human-controlled planning

Use `patchmill-plan` when a human intentionally wants local planning without
automated implementation. It may use an interactive review ceremony because a
human invoked it. It does not represent a Run-once planning review, create or
merge a planning pull request, or supply an approval label to fresh state.

Expose the packaged skill through the active coding agent's global skill
mechanism. For Pi, a linked directory under `~/.pi/agent/skills/` can be invoked
as:

```text
/skill:patchmill-plan 123
```

The human can review and revise the local artifact as long as needed. For fresh
automated work, use ordinary `patchmill run-once --issue N` instead; Run-once
owns phase workspaces, push, pull-request creation, review stops, merge
reconciliation, labels, and cleanup.

## Legacy/manual tooling

`patchmill-upload` and `patchmill-label` remain useful for manual workflows and
unfinished legacy Issue runs. Their published comments and approval labels do
not authorize a fresh planning phase. Do not hand them off after a fresh
Run-once planning phase; review or merge the exact planning pull request and
rerun Run-once instead.

`patchmill-cleanup` is always human-authorized. It inspects the selected issue
worktree and branch, including possible lost work, and requires confirmation
before destructive cleanup.
