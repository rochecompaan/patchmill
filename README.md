# Patchmill

Patchmill is an agent-driven software factory where humans and agents
collaborate through intentional, understandable patches—preserving software
craftsmanship while making iterative engineering feel industrial and scalable.

## What Patchmill does

Patchmill connects issue trackers, Pi agents, repository policy, and git
worktrees so a repository can move from open issues to reviewed diffs with clear
handoffs.

The two main workflows are:

- `patchmill triage` classifies open issues and can apply readiness
  labels/comments.
- `patchmill run-once` claims one ready issue, plans the work, runs
  implementation, reviews/lands the result, and records the outcome.

`patchmill triage` executes the configured triage skill by default and reports
what changed. Use `patchmill triage --dry-run` to preview the labels, comments,
closures, canonical bucket, and rationale the skill would produce without
mutating the issue host.

## First use

After installing Patchmill, start with the safety-first onboarding flow:

```sh
patchmill init
patchmill doctor
patchmill triage --dry-run
patchmill run-once --dry-run
patchmill run-once --execute
```

`patchmill init` writes a minimal local `patchmill.config.json`, reminds you how
to change the default host login, and, when Pi provider setup is not apparent,
can open Pi so you can run `/login` or prints install guidance if Pi is not
available. `patchmill doctor` is read-only: it checks git, host access, labels,
Pi, configured skills, and local paths, verifying bundled/path-like skills and
flagging name-only skills as unverified before recommending dry runs.

## Configuration

Patchmill loads `patchmill.config.json` from the repository root and fills
omitted fields with defaults. A functional starting point for the default
workflow looks like this:

```json
{
  "host": {
    "provider": "forgejo-tea",
    "login": "triage-agent"
  },
  "pi": {
    "triageThinking": "high"
  },
  "skills": {
    "triage": "patchmill-issue-triage",
    "planning": "superpowers:writing-plans",
    "implementation": "superpowers:subagent-driven-development"
  },
  "paths": {
    "plansDir": "docs/plans",
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs",
    "worktreeDir": ".worktrees"
  }
}
```

The default skills keep the workflow small and explicit:

- `patchmill-issue-triage` is the bundled default triage skill; normal triage
  runs it (or your configured replacement) and reports observed changes, while
  `--dry-run` uses a read-only preview JSON pass.
- `superpowers:writing-plans` writes implementation plans before code changes.
- `superpowers:subagent-driven-development` executes approved plans with
  worker/reviewer handoffs.

Customize `skills` when your repository needs different procedures. Optional
skill hooks include `toolchain`, `review`, `visualEvidence`, and `landing`; see
[skills configuration](docs/skills.md) for details and
[configuration examples](docs/configuration.md) for a fuller
`patchmill.config.json`.

Patchmill bundles `pi-subagents` for implementation delegation. The default
implementation skill, `superpowers:subagent-driven-development`, can use
pi-subagents builtin agents such as `worker`, `reviewer`, `scout`, `planner`,
`context-builder`, `researcher`, `delegate`, and `oracle`. Customize those
agents with normal pi-subagents user or project configuration when your
repository needs different models, tools, context behavior, or nested
delegation.

## Environment variables

Environment variables are best for machine-local identity, CI secrets, and host
upload credentials that should not live in `patchmill.config.json`.

- `PATCHMILL_HOST_LOGIN`: host account/login Patchmill uses with `tea`;
  overrides `host.login`.
- `PATCHMILL_FORGEJO_URL`: Forgejo base URL used when uploading visual evidence
  to PRs.
- `PATCHMILL_FORGEJO_TOKEN`: Forgejo API token for visual-evidence uploads.
- `PATCHMILL_FORGEJO_REPO`: optional `owner/repo` override when Patchmill cannot
  infer the Forgejo repository from git remotes.

CLI flags override environment variables, and environment variables override
`patchmill.config.json`.

## Subagents

Patchmill includes `pi-subagents`; users do not install it separately.
Implementation prompts can rely on the Pi `subagent` tool and the agents
discovered by pi-subagents.

Agent files can live in:

- `~/.pi/agent/agents/**/*.md` for user-scope agents
- `.pi/agents/**/*.md` for project-scope agents

Chain files can live in:

- `~/.pi/agent/chains/**/*.chain.md`
- `.pi/chains/**/*.chain.md`

Settings overrides can live in `~/.pi/agent/settings.json` or
`.pi/settings.json`. For example:

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

A minimal project agent file looks like:

```md
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

If you want a child agent to delegate further, include the `subagent` tool in
that agent's tools and configure nesting/depth through pi-subagents settings.
Patchmill does not override those user choices.

## State paths

Patchmill writes local run state under `.patchmill/`:

- `.patchmill/runs/`
- `.patchmill/triage-runs/`

These paths are local workflow state, not source documentation.

## Issue-agent workflows

For a deeper newcomer-friendly walkthrough,
[issue-agent workflows](docs/issue-agent-workflows.md) explains how triage
selects and labels issues, how `run-once` claims work, how Pi planning and
implementation prompts are shaped, and where Patchmill records progress and
safety checkpoints.

## Reference docs

- [Configuration examples](docs/configuration.md)
- [Issue-agent workflows](docs/issue-agent-workflows.md)
- [Providers](docs/providers.md)
- [Skills configuration](docs/skills.md)
- [Task contracts](docs/task-contracts.md)
