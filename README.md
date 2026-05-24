# Patchmill

Patchmill is an agent-driven software factory that turns repository issues into reviewed diffs.

## Commands

```sh
patchmill triage --dry-run
patchmill run-once --dry-run
```

- `patchmill triage` classifies open issues and can apply labels/comments when run with execute mode.
- `patchmill run-once` selects one ready issue, plans the work, runs implementation, and records the result.

## Configuration

Patchmill loads `patchmill.config.json` from the repository root.

Use top-level `skills` settings to customize agent procedures without editing Patchmill prompt builders; see `docs/skills.md`.

Minimal example:

```json
{}
```

Common fields:

```json
{
  "host": { "login": "triage-agent" },
  "pi": { "team": "openai-only" },
  "paths": {
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs",
    "worktreeDir": ".worktrees"
  }
}
```

## Environment variables

- `PATCHMILL_HOST_LOGIN`
- `PATCHMILL_AGENT_TEAM`
- `PATCHMILL_FORGEJO_URL`
- `PATCHMILL_FORGEJO_TOKEN`
- `PATCHMILL_FORGEJO_REPO`

CLI flags override environment variables, and environment variables override `patchmill.config.json`.

## State paths

Patchmill writes local run state under `.patchmill/`:

- `.patchmill/runs/`
- `.patchmill/triage-runs/`

## Reference docs

- `docs/providers.md`
- `docs/skills.md`
- `docs/task-contracts.md`
- `docs/specs/2026-05-22-patchmill-generalization-design.md`
- `docs/plans/2026-05-22-patchmill-generalization.md`

## Validation

```sh
npm test
npm run audit:generalization
```

Node 24+ is required.
