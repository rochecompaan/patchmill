# Pi and Subagent Configuration Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a Patchmill-focused guide that shows users how to assign
appropriate model and thinking defaults to the main Pi orchestrator and the
`scout`, `worker`, and `reviewer` subagents.

**Architecture:** Add one focused Starlight guide around Patchmill's isolated
`.patchmill/pi-agent/settings.json` runtime, then connect it to the existing
configuration, provider, and workflow-lifecycle pages with short links. Keep the
complete settings example and troubleshooting guidance in the new guide so
existing pages retain their current responsibilities.

**Tech Stack:** Astro 7, Starlight, Markdown, JavaScript site configuration, npm
documentation checks.

## Global Constraints

- Follow the approved design in
  `docs/specs/2026-07-19-pi-subagent-configuration-docs-design.md`.
- Document only Patchmill's isolated `.patchmill/pi-agent/settings.json` scope;
  do not explain ordinary Pi global or project configuration.
- Make explicit role-specific subagent configuration a recommended baseline so
  users do not run every task with the orchestrator model or an unsuitable
  thinking level.
- Cover only the main orchestrator plus `scout`, `worker`, and `reviewer`; do
  not document custom agents or chains.
- Use one concrete mixed-provider example, while identifying its model IDs as
  replaceable examples rather than permanent recommendations.
- Do not change dependencies or production runtime behavior.
- Do not add automated tests for documentation text or static sidebar
  configuration. Apply the Testing Value Gate and verify with Markdown lint and
  the Astro site build instead.

---

### Task 1: Add the Pi and subagent configuration guide

**Files:**

- Create: `site/src/content/docs/guides/pi-and-subagents.md`
- Modify: `site/astro.config.mjs:75-82`

**Interfaces:**

- Consumes: Existing Starlight content collection and the Patchmill runtime
  behavior documented by
  `docs/specs/2026-07-19-pi-subagent-configuration-docs-design.md`.
- Produces: The public route `/guides/pi-and-subagents/` and a **Pi and
  subagents** Guides-sidebar entry that Task 2 can link to.

- [ ] **Step 1: Create the complete guide**

Create `site/src/content/docs/guides/pi-and-subagents.md` with exactly this
content:

````markdown
---
title: Pi and subagents
description:
  Choose role-specific models and thinking levels for Patchmill's Pi runtime.
---

Patchmill runs Pi with an isolated agent directory at `.patchmill/pi-agent/`.
Configure the Pi sessions started by Patchmill in:

```text
.patchmill/pi-agent/settings.json
```

Keep this machine-specific runtime state local. Do not commit
`.patchmill/pi-agent/` with repository configuration or project-local skills.

:::caution[Configure each role explicitly] Without a `model` override, a
built-in subagent inherits the orchestrator model. Built-in roles may provide
thinking defaults, but setting both the model and thinking level explicitly
makes the intended cost, latency, and reasoning policy clear. Repository
exploration, implementation, and review should not all run with the
orchestrator's defaults. :::

## Authenticate the required providers

Run Patchmill's repository-local authentication flow before editing model
settings:

```sh
patchmill auth
```

Run it once for each provider referenced by the orchestrator or a subagent
override. For a mixed-provider setup, authenticate each provider and choose the
intended orchestrator model on the final run. `patchmill auth` updates
`defaultProvider` and `defaultModel` while preserving unrelated settings in the
same JSON object.

## Configure the orchestrator and subagents

The following example uses a balanced orchestrator, a fast scout, a
coding-focused worker, and an independent high-capability reviewer:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-6",
  "defaultThinkingLevel": "medium",
  "subagents": {
    "agentOverrides": {
      "scout": {
        "model": "anthropic/claude-haiku-4-5",
        "thinking": "low"
      },
      "worker": {
        "model": "openai-codex/gpt-5.4",
        "thinking": "high"
      },
      "reviewer": {
        "model": "anthropic/claude-opus-4-6",
        "thinking": "high"
      }
    }
  }
}
```

These model IDs are concrete examples, not permanent recommendations. Provider
catalogs change. Use models available to your Patchmill runtime that fit the
same role characteristics.

| Role              | Workload                                              | Configuration goal                                  |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Main orchestrator | Coordinates the Patchmill run and synthesizes results | Balance reasoning quality, latency, and cost        |
| `scout`           | Finds files and maps repository structure             | Prefer fast, inexpensive exploration                |
| `worker`          | Implements production changes                         | Prefer a strong coding model with deeper reasoning  |
| `reviewer`        | Performs adversarial correctness review               | Prefer an independent, high-capability review model |

## Understand the settings

- `defaultProvider` and `defaultModel` select the main Patchmill orchestrator
  model.
- `defaultThinkingLevel` sets the orchestrator's default thinking level.
- `subagents.agentOverrides.<role>.model` selects a provider-qualified subagent
  model such as `openai-codex/gpt-5.4`.
- `subagents.agentOverrides.<role>.thinking` sets that role's thinking level.

Supported thinking levels are `off`, `minimal`, `low`, `medium`, `high`,
`xhigh`, and `max`. Choose a level supported by the selected provider and model.

## Verify the configuration

After changing authentication or settings, run:

```sh
patchmill doctor
```

`doctor` validates the main Pi runtime and lists the resources Patchmill will
load. A configured child provider and model are fully exercised only when that
subagent runs.

If a role fails to start:

- For an unknown model ID, choose an available model and correct that role's
  provider-qualified `model` value.
- For missing provider authentication, rerun `patchmill auth` for that provider.
- For an unsupported thinking level, use one of the documented values supported
  by the model.
- Repair the affected role override instead of deleting all overrides and
  unintentionally making every role use the orchestrator model.

For settings beyond Patchmill's needs, see the upstream
[Pi settings reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)
and
[`pi-subagents` builtin override documentation](https://github.com/nicobailon/pi-subagents/blob/main/README.md#builtin-overrides).
````

- [ ] **Step 2: Add the guide to the Starlight sidebar**

In `site/astro.config.mjs`, replace the Guides `items` block:

```javascript
items: [
  {
    label: "Skills configuration",
    slug: "guides/skills-configuration",
  },
  { label: "Providers", slug: "guides/providers" },
],
```

with:

```javascript
items: [
  {
    label: "Skills configuration",
    slug: "guides/skills-configuration",
  },
  { label: "Providers", slug: "guides/providers" },
  {
    label: "Pi and subagents",
    slug: "guides/pi-and-subagents",
  },
],
```

- [ ] **Step 3: Run Markdown lint for the new guide and sidebar change**

Run:

```sh
npm run lint:md
```

Expected: exit 0 and `Summary: 0 error(s)`.

- [ ] **Step 4: Build the site and verify the new route is generated**

Run:

```sh
npm run site:build
```

Expected: exit 0, the Astro build reports `17 page(s) built`, and ends with
`[build] Complete!`.

- [ ] **Step 5: Review the Task 1 diff**

Run:

```sh
git diff --check
git diff -- site/src/content/docs/guides/pi-and-subagents.md site/astro.config.mjs
```

Expected: `git diff --check` prints nothing. The content diff contains only the
new guide, and the configuration diff adds only the new Guides-sidebar item.

- [ ] **Step 6: Commit the guide and navigation**

```sh
git add site/src/content/docs/guides/pi-and-subagents.md site/astro.config.mjs
git commit -m "docs(site): add Pi and subagent configuration guide"
```

Expected: one commit containing the new guide and its sidebar route.

---

### Task 2: Link existing documentation to the new guide

**Files:**

- Modify: `site/src/content/docs/getting-started/configuration.md:243-245`
- Modify: `site/src/content/docs/guides/providers.md:44-52`
- Modify: `site/src/content/docs/reference/agent-workflow-lifecycle.md:179-182`

**Interfaces:**

- Consumes: The `/guides/pi-and-subagents/` route produced by Task 1.
- Produces: Contextual discovery paths from repository configuration, runtime
  provider authentication, and implementation lifecycle documentation.

- [ ] **Step 1: Link from the getting-started configuration page**

In `site/src/content/docs/getting-started/configuration.md`, after:

```markdown
Commit `patchmill.config.json` and project-local skills when the workflow should
be shared by the team. Keep machine-specific runtime state such as
`.patchmill/pi-agent/`, `.patchmill/runs/`, and `.patchmill/triage-runs/` local.
```

add:

```markdown
Configure the main Pi orchestrator and role-specific subagent defaults in
[Pi and subagents](/guides/pi-and-subagents/). Keep those settings local with
the rest of `.patchmill/pi-agent/`.
```

- [ ] **Step 2: Link from runtime provider authentication**

In `site/src/content/docs/guides/providers.md`, after:

```markdown
Issue-host authentication remains separate: use `gh auth login` for GitHub and
`tea` login configuration for Forgejo/Gitea access. `patchmill auth` only
manages Patchmill's repo-local Pi provider state.
```

add:

```markdown
When the orchestrator, `scout`, `worker`, or `reviewer` use different providers,
authenticate each provider in this isolated runtime. See
[Pi and subagents](/guides/pi-and-subagents/) for the role-specific settings.
```

- [ ] **Step 3: Link from the implementation lifecycle**

In `site/src/content/docs/reference/agent-workflow-lifecycle.md`, after:

```markdown
Patchmill bundles `pi-subagents`, so implementation prompts may rely on the Pi
`subagent` tool and normal pi-subagents user/project discovery. Patchmill does
not hard-code a worker/reviewer procedure; it renders skill lines from runtime
configuration and observes subagent tool calls through the Pi session stream.
```

add:

```markdown
Built-in subagents inherit the orchestrator model unless they have explicit
model overrides. Configure role-specific model and thinking defaults for
`scout`, `worker`, and `reviewer`; see
[Pi and subagents](/guides/pi-and-subagents/).
```

- [ ] **Step 4: Run the final Markdown verification**

Run:

```sh
npm run lint:md
```

Expected: exit 0 and `Summary: 0 error(s)`.

No automated documentation-content test is added: these links and prose are
static documentation, so direct lint/build verification provides more value than
a test that restates their text.

- [ ] **Step 5: Run the final site build**

Run:

```sh
npm run site:build
```

Expected: exit 0, the Astro build reports `17 page(s) built`, Pagefind finishes
building the search index, and the build ends with `[build] Complete!`.

- [ ] **Step 6: Review all implementation changes**

Run:

```sh
git diff --check
git status --short
git diff HEAD~1 -- site/astro.config.mjs site/src/content/docs
```

Expected:

- `git diff --check` prints nothing.
- `git status --short` lists only the three Task 2 Markdown files.
- The cumulative site diff contains one new guide, one sidebar entry, and three
  short contextual links; it contains no dependency or runtime changes.

- [ ] **Step 7: Commit the cross-links**

```sh
git add \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/guides/providers.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md
git commit -m "docs(site): link Pi role configuration guidance"
```

Expected: one commit containing only the three contextual documentation links.

- [ ] **Step 8: Confirm the branch is clean and record verification evidence**

Run:

```sh
git status --short --branch
git log -3 --oneline
```

Expected: the branch is clean. The latest two implementation commits are
`docs(site): link Pi role configuration guidance` and
`docs(site): add Pi and subagent configuration guide`, following the committed
design and plan documents.
