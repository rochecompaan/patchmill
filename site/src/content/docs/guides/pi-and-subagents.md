---
title: Pi and subagents
description:
  Choose role-specific models and thinking levels for Patchmill's Pi runtime.
---

Patchmill sets `PI_CODING_AGENT_DIR` to `.patchmill/pi-agent/` for its Pi
processes, giving them an isolated agent directory. Configure the Pi sessions
started by Patchmill in:

```text
.patchmill/pi-agent/settings.json
```

Keep this machine-specific runtime state local. Do not commit
`.patchmill/pi-agent/` with repository configuration or project-local skills.

:::caution[Configure each role explicitly]

Without a `model` override, a built-in subagent inherits the orchestrator model.
Built-in roles may provide thinking defaults, but setting both the model and
thinking level explicitly makes the intended cost, latency, and reasoning policy
clear. Repository exploration, implementation, and review should not all run
with the orchestrator's defaults.

:::

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

Pi recognizes `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` for
the main runtime. For an explicit subagent role override, use `minimal`, `low`,
`medium`, `high`, `xhigh`, or `max`; `off` lets the child use its default
thinking level instead. Choose a level supported by the selected provider and
model.

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
