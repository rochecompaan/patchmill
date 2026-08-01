# Agent-neutral interactive skills design

## Context

PR 132 adds `site/src/content/docs/using-patchmill/interactive-skills.md`, but
the page currently presents Patchmill's four interactive skills as Pi-only. The
packaged skill directories can be installed and invoked by any coding agent that
supports compatible user-global skills. Pi should remain documented as a
concrete example rather than as a requirement.

## Goal

Make the page coding-agent-neutral while preserving useful Pi installation and
invocation examples.

## Scope

Update only the interactive-skills documentation to:

- describe `patchmill-plan`, `patchmill-upload`, `patchmill-label`, and
  `patchmill-cleanup` as human-invoked, user-global coding-agent skills;
- tell users to expose the packaged skill directories through their coding
  agent's user-global skill mechanism;
- label `~/.pi/agent/skills/` as the Pi-specific installation example;
- explain that invocation syntax depends on the coding agent;
- retain Pi's `/skill:...` commands as a labeled concrete example; and
- clarify that abbreviated handoff text maps to Pi's stock command syntax only
  when Pi is the active agent.

The existing authorization boundaries, review-first handoffs, issue-number
behavior, upload and label semantics, and cleanup warnings remain unchanged.

## Non-goals

- Document every supported coding agent or maintain an agent-by-agent command
  matrix.
- Change the packaged skill files or their runtime behavior.
- Add an installer or automatic configuration for coding agents.
- Change Patchmill workflow configuration.

## Documentation approach

Use generic terminology first, followed immediately by a clearly labeled Pi
example where an exact path or command helps the reader. Avoid implying that
Pi's filesystem layout or `/skill:` syntax is universal.

## Verification

This is a static documentation-only change. Do not add an automated test that
asserts documentation text. Verify instead with:

1. the repository Markdown lint command;
2. the site production build; and
3. a focused diff review confirming that workflow and safety semantics were not
   changed.
