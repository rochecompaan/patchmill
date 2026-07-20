# Patchmill Pi and subagent configuration documentation design

**Date:** 2026-07-19 **Status:** Approved

## Context

Patchmill's public site explains provider authentication, workflow skills, and
that implementation sessions may use `pi-subagents`. It does not explain how a
user selects the model and thinking level for Patchmill's main Pi orchestrator
or assigns different model and thinking defaults to the subagents used most
often by Patchmill.

Patchmill runs Pi with an isolated agent directory at `.patchmill/pi-agent/`.
The relevant settings therefore belong in `.patchmill/pi-agent/settings.json`,
not in a user's ordinary global Pi configuration. The missing documentation
should stay focused on this Patchmill-owned runtime rather than becoming a
general Pi or `pi-subagents` manual.

A particularly important omission is the inheritance behavior of built-in
subagents. Without explicit role overrides, `scout`, `worker`, and `reviewer`
can inherit the orchestrator model. That makes cheap repository exploration
unnecessarily expensive and can leave implementation or review using a model and
thinking level selected for orchestration rather than for those workloads.

## Goals

- Explain where Patchmill's Pi runtime settings live.
- Show how to configure the main orchestrator model and thinking level.
- Make role-specific subagent configuration a recommended baseline rather than
  an optional advanced topic.
- Show how to configure model and thinking overrides for `scout`, `worker`, and
  `reviewer`.
- Provide one concrete, copyable, mixed-provider example optimized by role.
- Explain the authentication and verification steps needed by the example.
- Connect the new guide to existing configuration, provider, and lifecycle
  documentation without duplicating it.
- Link to upstream Pi and `pi-subagents` references for exhaustive options.

## Non-goals

- Explaining standard Pi global settings at `~/.pi/agent/settings.json`.
- Explaining standard Pi project settings at `.pi/settings.json` except where an
  upstream link provides broader reference material.
- Documenting custom agents, saved chains, dynamic fanout, profiles, tool
  policies, or the complete `pi-subagents` settings surface.
- Documenting unrelated Pi settings such as themes, interactive editor behavior,
  message delivery, compaction, or session management.
- Changing Patchmill or Pi runtime behavior.

## Information architecture

Create one guide:

- `site/src/content/docs/guides/pi-and-subagents.md`

Add it to the Starlight **Guides** sidebar in `site/astro.config.mjs` with the
label **Pi and subagents**.

Add short contextual links to the guide from:

- `site/src/content/docs/getting-started/configuration.md`
- `site/src/content/docs/guides/providers.md`
- `site/src/content/docs/reference/agent-workflow-lifecycle.md`

The existing pages should retain their current responsibilities. They should
point to the new guide instead of repeating its settings example or role
selection advice.

## Guide structure

### 1. Explain the isolated Patchmill runtime

Open by stating that Patchmill sets `PI_CODING_AGENT_DIR` to
`.patchmill/pi-agent/` for its Pi processes. Users configuring Patchmill runs
must therefore edit:

```text
.patchmill/pi-agent/settings.json
```

Clarify that this directory is machine-specific runtime state and should remain
uncommitted, consistent with the existing configuration documentation.

### 2. Emphasize explicit role configuration

Place a prominent Starlight note or caution near the start of the guide:

> Configure subagent roles explicitly. Without overrides, built-in subagents
> inherit the orchestrator model. Repository exploration, implementation, and
> review have different cost, latency, and reasoning needs, so they should not
> all run with the orchestrator's defaults.

This warning is a core requirement of the guide, not a footnote.

### 3. Present the complete configuration example

Use this role-oriented example:

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

Describe these as concrete examples rather than permanent model recommendations.
Model catalogs change, so users should substitute currently available models
that fit the same role characteristics.

### 4. Explain each settings layer

Explain the distinction between:

- `defaultProvider` and `defaultModel`: the main Patchmill orchestrator model.
- `defaultThinkingLevel`: the main orchestrator thinking level.
- `subagents.agentOverrides.<role>.model`: a provider-qualified subagent model
  such as `openai-codex/gpt-5.4`.
- `subagents.agentOverrides.<role>.thinking`: that role's thinking level.

List the supported thinking values:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

### 5. Explain the role choices

Include a concise table:

| Role              | Workload                                              | Configuration goal                                  |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Main orchestrator | Coordinates the Patchmill run and synthesizes results | Balance reasoning quality, latency, and cost        |
| `scout`           | Finds files and maps repository structure             | Prefer fast, inexpensive exploration                |
| `worker`          | Implements production changes                         | Prefer a strong coding model with deeper reasoning  |
| `reviewer`        | Performs adversarial correctness review               | Prefer an independent, high-capability review model |

The prose should encourage deliberate role assignment without claiming that one
provider or model is universally best.

### 6. Authenticate every referenced provider

Explain that each provider used by the orchestrator or a subagent override must
be available to Patchmill's isolated runtime. Users can rerun:

```sh
patchmill auth
```

when adding or repairing a provider. A mixed-provider configuration may require
running the command once for each provider. The final orchestrator selection
must agree with `defaultProvider` and `defaultModel`; rerunning `patchmill auth`
preserves unrelated settings in the same JSON object.

### 7. Verify and troubleshoot

Use this primary verification command:

```sh
patchmill doctor
```

State its boundary accurately: `doctor` validates the main Pi runtime and lists
the resources Patchmill will load, while a configured child provider/model is
fully exercised only when that subagent runs.

Cover the likely failures briefly:

- Unknown model ID: choose an available model and correct the relevant setting.
- Missing provider authentication: rerun `patchmill auth` for that provider.
- Unsupported thinking level: use one of the documented values.
- Child model failure: repair the role override rather than deleting all
  overrides and unintentionally making every role inherit the orchestrator.

### 8. Link to exhaustive upstream references

End with links to the authoritative Pi settings documentation and the
`pi-subagents` README. These links provide the complete settings surfaces while
the Patchmill guide remains intentionally narrow.

## Content flow

The page follows the order a user needs:

1. Identify the correct settings file.
2. Understand why role overrides matter.
3. Copy a complete example.
4. Adapt each role deliberately.
5. Authenticate all referenced providers.
6. Validate the runtime and troubleshoot failures.
7. Continue to upstream references only when advanced configuration is needed.

No application data flow or runtime behavior changes are introduced. The guide
documents configuration that Patchmill and bundled `pi-subagents` already
consume.

## Verification strategy

This change is static documentation and sidebar configuration. Under the Testing
Value Gate, no new automated test should assert documentation text or sidebar
YAML/JavaScript structure. Verify the change directly with:

```sh
npm run lint:md
npm run site:build
```

The Markdown lint validates documentation style. The Astro build validates
frontmatter, sidebar routes, internal links, and successful site generation.

## Acceptance criteria

- The public site has a dedicated **Pi and subagents** guide.
- The guide uses `.patchmill/pi-agent/settings.json` as its sole primary
  configuration scope.
- The guide prominently warns against allowing all subagents to inherit the
  orchestrator model and thinking defaults.
- The guide shows main orchestrator settings and explicit `scout`, `worker`, and
  `reviewer` overrides in one copyable JSON example.
- The example uses a mixed, role-oriented provider/model selection and explains
  how to replace its model IDs.
- The guide explains provider authentication and the limits of
  `patchmill doctor` verification accurately.
- Existing configuration, provider, and lifecycle pages link to the new guide
  without duplicating it.
- Custom agents and chains remain out of scope.
- Markdown lint and the site build pass.
