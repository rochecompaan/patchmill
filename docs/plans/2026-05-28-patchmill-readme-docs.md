# Patchmill README Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clarify Patchmill's README and supporting docs so newcomers understand
it as a software factory before seeing runtime/customization details.

**Architecture:** This is a documentation-only change. Update the README
first-impression sections, then align provider/configuration/skill docs so
supported hosts, provider values, and extensibility terms are easy to find.

**Tech Stack:** Markdown documentation, existing project docs, markdown
lint/rendering checks.

---

## Task 1: Rewrite the README first impression

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Replace the introductory product framing**

Replace the current opening paragraph and `What Patchmill does` body with copy
that explains Patchmill as an agent-driven software factory moving product work
through intake, planning, implementation, review, evidence, and landing. Do not
mention Pi in the opening section.

- [ ] **Step 2: Make supported issue hosts explicit near the top**

Add a short requirements/support paragraph near the first-use content naming
Forgejo/Gitea through `tea` (`forgejo-tea`) and GitHub through `gh`
(`github-gh`).

- [ ] **Step 3: Move runtime/customization concepts later**

Keep Pi, subagents, skills, and chain files in later customization/extensibility
sections, not the README first impression.

## Task 2: Align supporting docs

**Files:**

- Modify: `docs/configuration.md`
- Modify: `docs/providers.md`
- Modify: `docs/skills.md`
- Modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Clarify provider values**

Ensure `docs/configuration.md` and `docs/providers.md` plainly list accepted
`host.provider` values: `forgejo-tea` and `github-gh`.

- [ ] **Step 2: Clarify extensibility vocabulary**

In `docs/skills.md`, add a short explanation that skills are reusable workflow
instructions, subagents are delegated implementation/review roles, and chain
files define reusable multi-agent sequences.

- [ ] **Step 3: Improve workflow framing**

In `docs/issue-agent-workflows.md`, add or adjust the opening so the workflows
are described as stations in the software factory: intake/sorting and one-issue
production runs.

## Task 3: Verify documentation changes

**Files:**

- Verify: `README.md`
- Verify: `docs/*.md`

- [ ] **Step 1: Run formatting/lint checks available for markdown**

Run `npm test` or the narrower documentation check if available in
`package.json`. If no docs-only command exists, run the existing test suite and
report the result.

- [ ] **Step 2: Inspect git diff**

Run
`git diff -- README.md docs/configuration.md docs/providers.md docs/skills.md docs/issue-agent-workflows.md docs/specs/2026-05-28-patchmill-readme-docs-design.md docs/plans/2026-05-28-patchmill-readme-docs.md`
and confirm the diff matches the approved scope.
