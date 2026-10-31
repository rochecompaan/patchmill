---
title: Pi and subagents
description: Configure Pi runtime settings and optional child agents.
---

Patchmill sets `PI_CODING_AGENT_DIR` to the configured `pi.agentDir`, which
defaults to `.patchmill/pi-agent`. Keep credentials and machine-specific
settings local. Do not commit that directory.

## Authentication and models

Run `patchmill auth` in an interactive terminal. Choose a subscription or API
key, then a provider and model. The command verifies the provider with a real
model call and returns to the shell. It does not open Pi chat.

Pi's SDK saves credentials in `auth.json` inside the configured agent directory.
Patchmill saves `defaultProvider` and `defaultModel` in Pi's `settings.json`,
which preserves unrelated settings. There is no separate Patchmill credential
store. The command respects `pi.agentDir` and does not change global Pi
settings.

Pi runtime settings live in `.patchmill/pi-agent/settings.json` by default. Use
model IDs supported by the installed Pi provider catalog. For the current
schema, read the upstream
[Pi settings reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md).

## Reviewer and optional subagents

`init` provisions `.patchmill/pi-agent/agents/reviewer.md`. The reviewer
performs a fresh-context, read-only review of a bounded change. The canonical
role is `reviewer`, not `code-reviewer`.

Run-once loads `pi-subagents` with runtime `-e` arguments. It does not copy the
extension into the agent directory. The kernel does not observe child agents or
use their progress as workflow state. Kernel-launched skills support inline
execution without requiring subagent tools. An interactive operator can
authorize available child-agent tools through the installed skills.

Triage passes no explicit extension paths. This does not mean that Pi cannot
load extensions from its own settings or environment. For optional role-specific
model settings, read the upstream
[`pi-subagents` documentation](https://github.com/nicobailon/pi-subagents/blob/main/README.md#builtin-overrides).

## Readiness

Run `patchmill doctor` after setup. Doctor checks the main Pi runtime with a
real smoke prompt. It does not exercise every optional child model or provider.
If a child cannot start, inspect its provider credentials and model settings
before changing unrelated roles.
