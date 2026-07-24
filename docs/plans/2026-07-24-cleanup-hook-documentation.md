# Cleanup Hook Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document Patchmill's existing `cleanupHook` configuration and
terminal-success lifecycle without changing runtime behavior.

**Architecture:** Extend the operational `run-once` guide and lifecycle
reference first so they define the canonical cleanup contract. Then add concise
getting-started configuration guidance that links to that contract. Keep the
full configuration example and all production code unchanged.

**Tech Stack:** Markdown, Astro/Starlight documentation, Prettier,
markdownlint-cli2

## Global Constraints

- Follow `docs/specs/2026-07-24-cleanup-hook-documentation-design.md`.
- This is documentation-only: do not change configuration parsing, hook
  execution, progress events, result statuses, skills, or workspace cleanup.
- Describe `cleanupHook` as a top-level script path executed as
  `bash <cleanupHook>` from the issue worktree.
- State that the hook runs only after terminal `pr-created` or `merged` success,
  after handoff recording and before built-in PR workspace removal.
- State that a hook failure is reported but does not reverse an already
  successful handoff.
- State that approval-required, blocked, failed, and other retryable outcomes
  retain their environments and do not run the hook.
- Keep project-specific environment cleanup separate from Patchmill-owned
  worktree and branch cleanup.
- Recommend idempotent, issue- or worktree-scoped scripts that tolerate
  already-absent resources and return non-zero when cleanup remains incomplete.
- Do not add automated tests that assert documentation prose; use formatting,
  lint, build, and direct content verification instead.

---

### Task 1: Document the cleanup lifecycle

**Files:**

- Modify: `site/src/content/docs/using-patchmill/run-once.md:40-106`
- Modify: `site/src/content/docs/reference/agent-workflow-lifecycle.md:82-107`

**Interfaces:**

- Consumes: Existing `run-once` terminal-success behavior in
  `src/cli/commands/run-once/pipeline-finish.ts` and hook execution in
  `src/pi/hooks.ts`.
- Produces: The canonical `#cleanup-after-successful-handoff` documentation
  anchor referenced by Task 2.

- [ ] **Step 1: Add cleanup to the run-once sequence and operational guide**

In `site/src/content/docs/using-patchmill/run-once.md`, extend the execute-mode
list after current step 12:

```markdown
12. Record run state and handoff information.
13. After a successful PR or merge handoff, run the configured cleanup hook and
    then perform built-in local PR workspace cleanup.
```

Add this section between “Development environment and implementation” and “Run
state and retries”:

````markdown
## Cleanup after successful handoff

Set the top-level `cleanupHook` when the repository needs a deterministic script
to stop local services or remove issue-specific development resources. After
implementation finishes as `pr-created` or `merged`, Patchmill records and
reports the successful handoff, then runs:

```sh
bash <cleanupHook>
```

The command runs from the issue worktree. Relative hook paths therefore resolve
from that worktree, and the script does not need its executable bit set because
Patchmill invokes it through `bash`.

For `pr-created`, Patchmill removes its local issue worktree and branch after
the hook finishes. Keep environment cleanup inside the hook, but leave worktree,
local branch, remote branch, pull request, and run-state cleanup to Patchmill.

Make the script idempotent and scope its resources to the current issue or
worktree. It should tolerate resources that are already absent and return a
non-zero exit code when cleanup remains incomplete. Patchmill reports a hook
failure as cleanup progress but does not change an already successful PR or
merge result into an implementation failure.

The hook does not run for approval gates, blockers, implementation failures, or
other retryable outcomes. Those runs retain their environment for a later
`run-once` retry, and Patchmill does not retry a failed cleanup hook
automatically.
````

- [ ] **Step 2: Add terminal cleanup to the lifecycle reference**

In `site/src/content/docs/reference/agent-workflow-lifecycle.md`, retain step 15
and add step 16:

```markdown
15. Record run state, labels, comments, commits, and final handoff data.
16. After a successful `pr-created` or `merged` handoff, run the configured
    cleanup hook from the issue worktree and, for a PR handoff, remove the local
    issue worktree and branch.
```

Add this paragraph immediately after the numbered list:

```markdown
See
[Cleanup after successful handoff](/using-patchmill/run-once/#cleanup-after-successful-handoff)
for hook execution, failure, retry, and workspace-ownership details.
```

- [ ] **Step 3: Verify the two edited Markdown files**

Run:

```sh
npx prettier --check \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md
npx markdownlint-cli2 \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md
```

Expected: Prettier reports both files use its code style; markdownlint reports
`0 error(s)`.

- [ ] **Step 4: Build the site**

Run:

```sh
npm run site:build
```

Expected: Astro completes the production build with exit code 0.

- [ ] **Step 5: Commit the lifecycle documentation**

```sh
git add \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md
git commit -m "docs(site): explain cleanup hook lifecycle"
```

### Task 2: Document cleanup-hook configuration

**Files:**

- Modify: `site/src/content/docs/getting-started/configuration.md:95-160`
- Verify unchanged:
  `site/src/content/docs/reference/configuration-example.md:80`

**Interfaces:**

- Consumes: Task 1's
  `/using-patchmill/run-once/#cleanup-after-successful-handoff` anchor.
- Produces: Discoverable setup guidance for the existing top-level `cleanupHook`
  configuration.

- [ ] **Step 1: Add getting-started cleanup configuration guidance**

In `site/src/content/docs/getting-started/configuration.md`, add this section
after the link to “Skills configuration” and before “Configure visual evidence
paths”:

````markdown
## Clean up successful development environments

Use the top-level `cleanupHook` when a successful implementation leaves local
services or issue-specific development resources that a deterministic script can
remove:

```json
{
  "cleanupHook": "./scripts/cleanup.sh"
}
```

Patchmill invokes the configured path through `bash` from the issue worktree.
For example, a repository using a worktree-scoped Docker Compose project could
provide:

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose down --remove-orphans
```

Use the repository's own teardown command when it uses another environment tool.
Make cleanup idempotent, namespace resources to the current issue or worktree,
tolerate resources that are already absent, and leave Patchmill's Git worktree
and branch intact.

The hook runs only after a successful PR or merge handoff. See
[Cleanup after successful handoff](/using-patchmill/run-once/#cleanup-after-successful-handoff)
for ordering, retry, failure-reporting, and workspace-ownership details.
````

- [ ] **Step 2: Confirm the full configuration example still exposes the key**

Run:

```sh
rg -n '"cleanupHook": "\./scripts/cleanup\.sh"' \
  site/src/content/docs/reference/configuration-example.md
```

Expected: one match for the existing top-level `cleanupHook` example. Do not
modify that file.

- [ ] **Step 3: Verify cross-document terminology and link targets**

Run:

```sh
rg -n \
  'cleanupHook|Cleanup after successful handoff|cleanup-after-successful-handoff' \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/reference/configuration-example.md
```

Expected: the configuration guide and example name `cleanupHook`; the run-once
guide defines the cleanup heading; and both links use its generated anchor.

- [ ] **Step 4: Run full documentation verification**

Run:

```sh
npm run format:check
npm run lint:md
npm run site:build
```

Expected: Prettier reports no formatting differences, markdownlint reports
`0 error(s)`, and Astro completes the production build with exit code 0.

No new automated test is added because this change only documents existing
behavior; static prose assertions would not provide regression value under the
Testing Value Gate.

- [ ] **Step 5: Commit the configuration documentation**

```sh
git add site/src/content/docs/getting-started/configuration.md
git commit -m "docs(site): document cleanup hook configuration"
```

- [ ] **Step 6: Verify the completed branch**

Run:

```sh
git status --short
git log -2 --oneline
```

Expected: `git status --short` prints nothing. The two latest commits are the
cleanup lifecycle and cleanup configuration documentation commits from this
plan.
