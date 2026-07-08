# Issue 71 Forgejo Edited Comment Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Forgejo issue comment hydration include edited comments so
run-once artifact extraction can see attached specs and plans.

**Architecture:** Replace the Forgejo comment hydration path that parses
`tea issues --comments` human output with a JSON `tea api` request to the
Forgejo issue comments endpoint. Reuse the existing host-provider contract and
extend the JSON comment mapper for Forgejo API field names.

**Tech Stack:** TypeScript, Node.js built-in `node:test`, Patchmill
`CommandRunner`, existing Forgejo `tea` CLI context helpers.

## Global Constraints

- Keep `IssueHostProvider.hydrateIssueComments()` contract unchanged: populate
  each issue's `comments` field and return the same issue array.
- Use `tea api` through `withTeaContext()` so configured `--repo` and `--login`
  handling is preserved.
- Hydrate edited and unedited comments from the same JSON path; do not parse
  edited state from human output.
- Preserve comment `body`, `authorLogin`, and `created` when Forgejo provides
  them.
- Ignore malformed comment entries without a string `body`, matching existing
  parser behavior.
- Treat comment body text as untrusted input.
- Do not add dependencies or change npm package metadata.
- Nix build verification is required only if implementation unexpectedly edits
  `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.

---

## File Structure

- Modify `src/host/forgejo-tea.test.ts`
  - Replace the existing comment hydration fixture that expects
    `tea issues <number> --comments` with a JSON `tea api` fixture.
  - Add edited-comment regression data via an API payload that includes
    `updated_at`.
  - Assert `user.login` and `created_at` map into `IssueCommentSummary`.
- Modify `src/cli/commands/triage/forgejo.ts`
  - Extend `parseIssueComment()` to support Forgejo API fields.
  - Replace `fetchIssueComments()` with paginated `tea api` JSON fetching.
  - Remove obsolete human-output parsing helpers if they become unused.

---

### Task 1: Add Forgejo API comment hydration regression coverage

**Files:**

- Modify: `src/host/forgejo-tea.test.ts`

**Interfaces:**

- Consumes:
  - `createFakeRunner(handler)` helper already defined in
    `src/host/forgejo-tea.test.ts`.
  - `createProvider(runner).hydrateIssueComments(issues)`.
  - `assertTeaContext(call)` helper for `--repo`, `--login`, and `cwd` checks.
- Produces:
  - A failing test that expects comment hydration to call
    `tea api /repos/{owner}/{repo}/issues/<issue>/comments?page=1&limit=1000`.
  - Regression assertions that edited comments represented by JSON payloads are
    hydrated.

- [ ] **Step 1: Replace the current human-output hydration test**
- [ ] **Step 2: Run the focused test and confirm it fails**
- [ ] **Step 3: Commit the failing test**

---

### Task 2: Hydrate Forgejo comments from structured API JSON

**Files:**

- Modify: `src/cli/commands/triage/forgejo.ts`

**Interfaces:**

- Consumes:
  - `withTeaContext(args, repoRoot, teaLogin)`.
  - `parseJson(stdout, context)`.
  - `parseIssueComment(comment)`.
- Produces:
  - `fetchIssueComments()` that calls `tea api` with endpoint
    `/repos/{owner}/{repo}/issues/<issue>/comments?page=<page>&limit=1000`.
  - `parseIssueComment()` support for `user.login` and `created_at`.

- [ ] **Step 1: Extend the JSON comment mapper**
- [ ] **Step 2: Add a comment API page-size constant**
- [ ] **Step 3: Replace human-output comment fetching with API JSON fetching**
- [ ] **Step 4: Run the focused test and confirm it passes**
- [ ] **Step 5: Commit the implementation**

---

### Task 3: Run regression verification and inspect scope

**Files:**

- No new source files.
- Verify: `src/host/forgejo-tea.test.ts`
- Verify: `src/cli/commands/triage/forgejo.ts`

**Interfaces:**

- Consumes:
  - Task 1 regression test.
  - Task 2 API JSON implementation.
- Produces:
  - Verified branch ready for review.

- [ ] **Step 1: Run the Forgejo host provider test file**
- [ ] **Step 2: Run the full test suite**
- [ ] **Step 3: Run TypeScript lint**
- [ ] **Step 4: Inspect the diff for accidental scope creep**
- [ ] **Step 5: Confirm no dependency metadata changed**
- [ ] **Step 6: Commit any final verification-only adjustments**
