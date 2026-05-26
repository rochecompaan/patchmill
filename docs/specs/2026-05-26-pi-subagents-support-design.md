# Pi-subagents support design

## Goal

Patchmill should make subagent support explicit and simple. Implementation
workflows depend on `pi-subagents`, not on Patchmill-specific agent-team
presets. Users should understand that Patchmill bundles `pi-subagents`, that the
default implementation skill can delegate through it, and that they can
customize agents and chains with normal pi-subagents configuration.

## Current problem

`patchmill run-once` currently requires an agent-team preset before
implementation. The implementation prompt renders a Patchmill-resolved `worker`
and `reviewer` model/thinking mapping and tells Pi to dispatch `subagent` calls
with exact model overrides.

This creates confusing implicit requirements:

- users must know about `.pi/agent-teams/<name>.json` or
  `~/.pi/agent/agent-teams/<name>.json`;
- `--agent-team`, `PATCHMILL_AGENT_TEAM`, and `pi.team` become required for
  implementation runs;
- Patchmill appears to depend on a separate agent-team extension/config concept
  even though implementation workflows primarily need `pi-subagents`;
- docs do not clearly explain the user-facing subagent contract or how users
  define/customize agents.

## Decisions

1. Drop Patchmill agent-team support completely.
   - Remove `--agent-team`.
   - Remove `PATCHMILL_AGENT_TEAM`.
   - Remove `pi.team`.
   - Remove `.pi/agent-teams/*` and `~/.pi/agent/agent-teams/*` lookup.
   - Remove the required implementation blocker for missing agent teams.

2. Treat `pi-subagents` as Patchmill's subagent integration.
   - Add `pi-subagents` as a Patchmill dependency so users do not install it
     separately.
   - Implementation prompts may assume the Pi runtime has the `subagent` tool
     from `pi-subagents`.
   - Patchmill still lets the configured implementation skill define the
     detailed workflow. The default remains
     `superpowers:subagent-driven-development`.

3. Use pi-subagents defaults and user configuration.
   - Patchmill should not require model or thinking overrides for `worker` or
     `reviewer`.
   - Builtin or user/project `worker` and `reviewer` agents are selected by
     pi-subagents discovery and precedence rules.
   - Users customize agents through pi-subagents agent files, chain files, and
     settings overrides.

4. Do not impose Patchmill-level nesting policy.
   - Patchmill should not say child subagents must never use subagents.
   - Whether a child agent can delegate is controlled by the user through
     pi-subagents agent definitions/settings/tools and max-depth configuration.
   - Documentation may explain that users can give a `worker` the `subagent`
     tool when they want it to delegate to agents such as `scout`.

## Runtime design

### Configuration loading

Remove agent-team configuration from the normalized Patchmill config surface.
The loader should no longer read or merge `pi.team` from config, environment, or
CLI arguments.

Any old `pi.team` configuration should be treated as unsupported. Because this
is a greenfield project, no compatibility or deprecation path is needed.

### Run-once pipeline

Implementation should proceed after the existing plan, approval, clean-worktree,
worktree, and branch gates without resolving an agent team.

Remove the missing-agent-team blocker and related questions. If the Pi
implementation session cannot use `pi-subagents` or cannot find required agents,
the implementation prompt should instruct Pi to return normal Patchmill blocker
JSON with actionable setup guidance.

### Prompt rendering

Replace the `Authoritative agent team` section with a `Subagent support`
section. It should state:

- Patchmill uses bundled `pi-subagents` for subagent workflows.
- The implementation session can call the `subagent` tool.
- Use pi-subagents-discovered agents and settings rather than Patchmill
  model/team mappings.
- The default implementation skill is intended to use `worker` for
  implementation handoffs and `reviewer` for review checkpoints.
- If required agents are unavailable or disabled, return Patchmill blocker JSON
  with setup instructions instead of inventing a local workflow.
- Users control agent models, thinking, tools, context mode, skills, and nesting
  behavior through pi-subagents configuration.

The prompt should not include exact `model:thinking` dispatch examples by
default.

### Types and tests

Remove `ResolvedAgentTeam` from run-once and Pi runner input types. Update tests
that currently construct or assert agent-team behavior:

- argument parsing tests for `--agent-team` and `PATCHMILL_AGENT_TEAM` should be
  removed or changed to assert unsupported input;
- config-loader tests should no longer expect `pi.team` merging;
- pipeline tests should no longer block when no agent team is present;
- prompt tests should assert the new subagent support section and absence of
  agent-team wording;
- resolver tests for `agent-team.ts` should be deleted with the module.

## Documentation design

Add a clear subagents section to README and the workflow/config docs.

The docs should say:

- Patchmill bundles `pi-subagents`.
- The default `skills.implementation` is
  `superpowers:subagent-driven-development`, which relies on subagent workflows.
- Users can rely on pi-subagents builtin agents such as `worker`, `reviewer`,
  `scout`, `planner`, `context-builder`, `researcher`, `delegate`, and `oracle`.
- Users can customize or define agents and chains using pi-subagents
  conventions.

Document these locations:

- user agents: `~/.pi/agent/agents/**/*.md`
- project agents: `.pi/agents/**/*.md`
- user chains: `~/.pi/agent/chains/**/*.chain.md`
- project chains: `.pi/chains/**/*.chain.md`
- user settings: `~/.pi/agent/settings.json`
- project settings: `.pi/settings.json`

Include a minimal agent file example:

```markdown
---
name: worker
description: Project-specific implementation worker
model: anthropic/claude-sonnet-4
thinking: high
tools: read, grep, find, ls, bash, edit, write
systemPromptMode: append
inheritProjectContext: true
inheritSkills: true
---

Follow this repository's implementation conventions. Escalate unclear product or
architecture decisions instead of guessing.
```

Include a settings override example:

```json
{
  "subagents": {
    "agentOverrides": {
      "reviewer": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high"
      }
    }
  }
}
```

Explain that users who want nested delegation can give an agent access to the
`subagent` tool and configure nesting/depth through pi-subagents settings.
Patchmill does not override those choices.

## Non-goals

- No Patchmill-specific replacement for agent-team model pinning.
- No compatibility path for old agent-team presets.
- No Patchmill-authored worker/reviewer prompt-fragment system.
- No Patchmill restriction on nested subagent use beyond whatever pi-subagents
  itself enforces.

## Acceptance criteria

- `patchmill run-once` no longer requires an agent-team preset for
  implementation.
- No public docs mention `--agent-team`, `PATCHMILL_AGENT_TEAM`, `pi.team`, or
  `.pi/agent-teams` as active configuration.
- Implementation prompts describe pi-subagents support and user-controlled agent
  customization.
- Tests cover the removal of the implementation blocker and old config surface.
- `pi-subagents` is declared as a Patchmill dependency.
