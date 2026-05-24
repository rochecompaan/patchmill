# Patchmill Providers

Patchmill separates issue-host integrations from the core triage and run-once workflows.

## Supported workflow

- `patchmill triage`
- `patchmill run-once`

The current built-in runtime is Pi, and the current host integration is Forgejo through `tea`.

## Configuration surface

Patchmill reads provider and workflow settings from `patchmill.config.json` and `PATCHMILL_*` environment variables.

Common settings:

- `host.login`
- `pi.team`
- `paths.runStateDir`
- `paths.triageLogDir`
- `paths.worktreeDir`

Environment variables:

- `PATCHMILL_HOST_LOGIN`
- `PATCHMILL_AGENT_TEAM`
- `PATCHMILL_FORGEJO_URL`
- `PATCHMILL_FORGEJO_TOKEN`
- `PATCHMILL_FORGEJO_REPO`

## Local state

Patchmill stores workflow state under `.patchmill/`:

- `.patchmill/runs/`
- `.patchmill/triage-runs/`

Task-contract details are documented in [docs/task-contracts.md](./task-contracts.md).
