---
title: Interactive skills
description: Human-controlled planning, labels, and cleanup.
---

`patchmill-plan`, `patchmill-label`, and `patchmill-cleanup` are
human-controlled skills. `init` installs them in `.patchmill/skills`, not as
global agent skills. They are not additional CLI commands or configuration entry
points. Load them through your coding agent's skill mechanism. For Pi, a loaded
skill can be invoked as `/skill:patchmill-plan 123`.

## Local planning

`patchmill-plan` resolves the issue branch and worktree, then prepares or
revises local specs and plans. It does not implement, publish, change labels, or
clean up. If required spec approval is absent, it revises the spec and stops
before the plan. Relevant resolved domain documents can accompany the spec,
subject to the envelope's artifact limits. Local self-review does not grant
approval.

Architectural specifications use the installed `domain-modeling` skill. Module
and interface designs also use `codebase-design` and `DEEPENING.md`. The planner
reads relevant glossaries, ADRs, code, and tests, then records domain ownership
and architectural choices. Terminology uses `GLOSSARY.md` and an optional
`GLOSSARY-MAP.md`, not new `CONTEXT` files. Existing legacy documents remain
inputs until an authorized rename. Non-architectural work does not require new
domain artifacts.

Every new or revised implementation plan requires a fresh, read-only canonical
`reviewer` after planner self-review. The reviewer independently inspects code
and tests, applies the architecture rubric, and cites concrete evidence for
blocking findings. The plan records dispositions and reviewed content identity.
Accepted blockers need correction and a fresh scoped confirmation. Reviewer
readiness does not grant approval or publication authority. If required skills,
resources, or reviewer tooling are absent, the helper asks and waits instead of
installing dependencies or substituting self-review.

This local helper differs from planning inside an Interactive Issue run. The
latter uses the kernel-provided submit dialog for approval and any PR choice.
The local helper never opens that publication flow itself.

For kernel planning and publication, run
`patchmill run-once --issue N --plan-only` as a separate operator action. It
reuses the same issue branch and worktree.

## Labels

`patchmill-label` inspects the current host and issue labels and applies only
human-authorized changes. It preserves unrelated labels. If a requested label is
missing, it asks before creating it. The kernel does not expose this skill as an
issue-mutation tool to unattended agents.

## Cleanup

`patchmill-cleanup` inspects dirty files, unique commits, and merge state before
requesting explicit deletion confirmation. It never removes remote branches. It
must hold the same issue OS lock throughout cleanup and prevent competing runs.
If it cannot establish ownership safely, it stops and asks.

Never delete or replace the permanent issue lock or its parent directory. Empty
or stale diagnostic JSON does not authorize cleanup. A successful
`patchmill release --issue N` only resets labels under the lock. It does not
hold that lock for later cleanup.
