# Docs Site Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill.dev` the single public documentation source while
preserving internal specs/plans.

**Architecture:** Public user/reference documentation lives under
`site/src/content/docs/` and is linked from the Starlight sidebar. The
repository root README becomes a concise landing page that points to the docs
site. Legacy public Markdown files in `docs/*.md` are removed after their
remaining useful content is migrated, while `docs/specs/` and `docs/plans/`
remain internal records.

**Tech Stack:** Astro Starlight Markdown docs, repository Markdown, npm site
build.

## Global Constraints

- Keep `docs/specs/` and `docs/plans/` as internal project records.
- Do not publish `docs/test-coverage-baseline.md`; remove it.
- Do not keep workflow-artifacts troubleshooting content on the public site.
- Keep setup-test-repo content in the existing quickstart rather than adding a
  separate page.

---

### Task 1: Add missing site reference pages

**Files:**

- Create: `site/src/content/docs/reference/task-contracts.md`
- Create: `site/src/content/docs/reference/agent-workflow-lifecycle.md`
- Modify: `site/astro.config.mjs`

**Steps:**

- [ ] Create the task-contracts reference page from the legacy public task
      contract docs.
- [ ] Create the agent workflow lifecycle reference page from the useful
      `triage` and `run-once` lifecycle details.
- [ ] Add both pages to the Starlight Reference sidebar.

### Task 2: Remove duplicate/troubleshooting public docs

**Files:**

- Modify: `site/src/content/docs/using-patchmill/workflow-artifacts.md`
- Delete: legacy duplicated public docs in `docs/*.md`, including
  `docs/test-coverage-baseline.md`

**Steps:**

- [ ] Remove the workflow-artifacts troubleshooting section from the site page.
- [ ] Delete legacy public docs after content migration.
- [ ] Keep `docs/specs/` and `docs/plans/` untouched.

### Task 3: Reduce README and verify docs build

**Files:**

- Modify: `README.md`

**Steps:**

- [ ] Replace the long README with a concise project landing page linking to
      `https://patchmill.dev`.
- [ ] Update or remove links that point at deleted public docs.
- [ ] Run Markdown/site verification.
