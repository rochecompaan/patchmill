# Agent-Neutral Interactive Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the interactive-skills guide coding-agent-neutral while keeping
Pi installation and invocation examples useful and explicit.

**Architecture:** Keep this as a focused documentation-only change in the
existing interactive-skills page. Introduce generic user-global skill guidance
first, follow it immediately with labeled Pi-specific paths and commands, and
leave the established workflow and safety sections semantically unchanged.

**Tech Stack:** Astro Starlight Markdown content, repository Markdown lint,
Astro production build, Node.js test suite

## Global Constraints

- Implement `docs/specs/2026-08-01-agent-neutral-interactive-skills-design.md`
  exactly.
- Update only `site/src/content/docs/using-patchmill/interactive-skills.md`
  during the implementation task.
- Describe `patchmill-plan`, `patchmill-upload`, `patchmill-label`, and
  `patchmill-cleanup` as human-invoked, user-global coding-agent skills.
- Tell users to expose the packaged skill directories through their coding
  agent's user-global skill mechanism.
- Label `~/.pi/agent/skills/` as a Pi-specific installation example.
- State that invocation syntax depends on the active coding agent.
- Retain Pi's `/skill:...` commands as a clearly labeled concrete example.
- State that abbreviated handoff text maps to Pi's stock command syntax only
  when Pi is the active agent.
- Preserve the existing authorization boundaries, review-first handoffs,
  issue-number behavior, upload and label semantics, and cleanup warnings.
- Do not document an agent-by-agent command matrix, change packaged skills or
  runtime behavior, add an installer, or change workflow configuration.
- Do not add an automated test that asserts static documentation text. Use
  direct lint, build, and diff verification instead.

---

## File Structure

- Modify: `site/src/content/docs/using-patchmill/interactive-skills.md` — remain
  the single guide for installing, invoking, and understanding the four
  human-controlled interactive skills.
- Do not create test or helper modules. The guide remains under 100 lines and
  has one documentation responsibility, so splitting it would add navigation
  cost without a meaningful boundary.

### Task 1: Make the interactive-skills guide agent-neutral

**Files:**

- Modify: `site/src/content/docs/using-patchmill/interactive-skills.md:1-66`
- Test: none — static documentation text is excluded by the Testing Value Gate

**Interfaces:**

- Consumes: the packaged directories `skills/patchmill-plan`,
  `skills/patchmill-upload`, `skills/patchmill-label`, and
  `skills/patchmill-cleanup`; coding-agent-specific user-global skill discovery;
  Pi's `~/.pi/agent/skills/` layout and `/skill:` command syntax.
- Produces: one agent-neutral guide that preserves the existing workflow,
  issue-selection, publication, labeling, and cleanup contracts.

- [ ] **Step 1: Confirm the existing Pi-specific wording and safety baseline**

Run:

```bash
rg -n "Pi skills|as Pi user-global skills|Use Pi's|stock Pi|Review-first|never automatic" \
  site/src/content/docs/using-patchmill/interactive-skills.md
```

Expected: matches in the description, introduction, install/invoke section,
abbreviated handoff explanation, and unchanged review/cleanup sections.

- [ ] **Step 2: Replace the guide with agent-neutral wording and labeled Pi
      examples**

Use this complete page content:

````markdown
---
title: Interactive skills
description: >-
  Install and use Patchmill's human-controlled coding-agent skills for planning,
  publication, labels, and issue-worktree cleanup.
---

Patchmill ships four human-invoked, user-global coding-agent skills for the
parts of an issue workflow that need distinct authorization.

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
configuration manager must expose those directories through the active coding
agent's user-global skill mechanism; Patchmill does not provide an installer.
The exact installation path depends on the coding agent.

For example, Pi discovers user-global skills under `~/.pi/agent/skills/`. Place
or link the four packaged directories there when Pi is the active agent.

Invocation syntax also depends on the coding agent. With Pi, use its built-in
command names:

```text
/skill:patchmill-plan 123

# Review and revise the local spec and plan as long as needed.

/skill:patchmill-upload
/skill:patchmill-label 123 +spec-approved +plan-approved +agent-ready -needs-info
/skill:patchmill-cleanup
```

Skill handoffs may use abbreviated text such as `/patchmill-upload 123` to name
the next skill. The active coding agent determines how to invoke it. When Pi is
the active agent, `/patchmill-upload 123` maps to Pi's stock
`/skill:patchmill-upload 123` command. Explicit positive issue numbers override
conversational context. In one repository conversation, a later skill can omit
its number when exactly one issue remains unambiguous, as upload and cleanup do
above; explicitly supplying `123` remains valid.

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
````

- [ ] **Step 3: Review the focused diff against the approved safety baseline**

Run:

```bash
git diff -- \
  site/src/content/docs/using-patchmill/interactive-skills.md
```

Expected:

- only the description, introduction, installation guidance, invocation
  labeling, and abbreviated handoff explanation change;
- the four skill names and the Pi command examples remain present;
- issue-number precedence and conversational-context behavior remain present;
- review-first, upload, label, and cleanup semantics remain unchanged.

- [ ] **Step 4: Run the Markdown lint required by the design**

Run:

```bash
npm run lint:md
```

Expected: `Summary: 0 error(s)` and exit code 0.

- [ ] **Step 5: Install locked site dependencies when needed and build the
      production site**

Run:

```bash
test -x site/node_modules/.bin/astro || npm --prefix site ci
npm run site:build
git status --short -- site/package.json site/package-lock.json
```

Expected: the locked site dependencies are installed only when Astro is absent,
Astro completes the production build with exit code 0, the interactive-skills
route is generated, and neither tracked site package file changes.

- [ ] **Step 6: Run repository regression verification**

Run:

```bash
npm test
npm run lint
git diff --check origin/main...HEAD
```

Expected: all Node.js tests pass, repository lint reports no errors, and the
diff check exits 0.

- [ ] **Step 7: Commit the implementation**

```bash
git add site/src/content/docs/using-patchmill/interactive-skills.md
git commit -m "docs(site): generalize interactive skill guidance"
```

Expected: one implementation commit containing only the interactive-skills page.

## Final Verification Commands

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
npm run lint:md
npm run site:build
npm test
npm run lint
git diff --check origin/main...HEAD
```

Expected: the branch is clean; it contains the approved design, this plan, and
the focused guide implementation; verification exits 0; no packaged skill,
runtime, installer, or workflow-configuration file changed.

## Self-Review Notes

- Spec coverage: Task 1 covers every scope bullet and preserves every named
  workflow and safety semantic.
- Testing Value Gate: no new automated test is justified because it would only
  assert static documentation text. Markdown lint, the production site build,
  the existing regression suite, and focused diff review provide direct value.
- Placeholder scan: no unfinished marker, deferred implementation, or
  unspecified error-handling step remains.
- Type/interface consistency: this plan changes no code interfaces; all four
  skill names, Pi paths, command syntax, and issue-number examples are exact and
  consistent throughout.
