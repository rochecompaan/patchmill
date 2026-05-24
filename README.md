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

Add `--dry-run` when you want to preview selection or triage decisions without
mutating the issue host.

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

- `patchmill-issue-triage` is Patchmill's bundled read-only issue classifier.
- `superpowers:writing-plans` writes implementation plans before code changes.
- `superpowers:subagent-driven-development` executes approved plans with
  worker/reviewer handoffs.

Customize `skills` when your repository needs different procedures. Optional
skill hooks include `toolchain`, `review`, `visualEvidence`, and `landing`; see
[skills configuration](docs/skills.md) for details and
[configuration examples](docs/configuration.md) for a fuller
`patchmill.config.json`. For full implementation runs, also set `pi.team` or
`PATCHMILL_AGENT_TEAM` to a Pi agent-team preset available on your machine.

## Environment variables

Environment variables are best for machine-local identity, CI secrets, and host
upload credentials that should not live in `patchmill.config.json`.

- `PATCHMILL_HOST_LOGIN`: host account/login Patchmill uses with `tea`;
  overrides `host.login`.
- `PATCHMILL_AGENT_TEAM`: Pi agent-team preset for implementation
  worker/reviewer models; overrides `pi.team`.
- `PATCHMILL_FORGEJO_URL`: Forgejo base URL used when uploading visual evidence
  to PRs.
- `PATCHMILL_FORGEJO_TOKEN`: Forgejo API token for visual-evidence uploads.
- `PATCHMILL_FORGEJO_REPO`: optional `owner/repo` override when Patchmill cannot
  infer the Forgejo repository from git remotes.

CLI flags override environment variables, and environment variables override
`patchmill.config.json`.

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
