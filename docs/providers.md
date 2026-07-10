# Patchmill Providers

Patchmill separates issue-host integrations from the core triage and run-once
workflows.

## Supported workflow

- `patchmill triage`
- `patchmill run-once`

The current built-in runtime is Pi.

## Supported issue hosts

Set `host.provider` to one of these values:

- `forgejo-tea`: Forgejo/Gitea through `tea`.
- `github-gh`: GitHub through `gh`.

## GitHub setup

Authenticate `gh`, initialize Patchmill, then run the read-only checks:

```sh
gh auth login
patchmill init
patchmill doctor
```

For repositories where `patchmill init` cannot infer GitHub from the git remote,
set the host provider explicitly:

```json
{
  "host": {
    "provider": "github-gh",
    "login": ""
  }
}
```

The first `github-gh` version uses the active `gh` authentication context and
does not support named logins.

## Runtime Pi authentication

Patchmill uses Pi as its runtime harness and keeps Patchmill-owned Pi provider
authentication in the repository-local `.patchmill/pi-agent` directory. Run the
guided auth command to configure or repair provider login and default model
selection:

```sh
patchmill auth
patchmill doctor
```

Issue-host authentication remains separate: use `gh auth login` for GitHub and
`tea` login configuration for Forgejo/Gitea access. `patchmill auth` only
manages Patchmill's repo-local Pi provider state.

## Configuration surface

Patchmill reads provider and workflow settings from `patchmill.config.json` and
`PATCHMILL_*` environment variables.

Common settings:

- `host.provider`
- `host.login`
- `paths.runStateDir`
- `paths.triageLogDir`
- `paths.worktreeDir`

Environment variables are intended for local identity and secrets rather than
shared repository policy:

- `PATCHMILL_HOST_LOGIN`: host account/login override for providers with
  named-login support, such as `forgejo-tea`. Providers without named-login
  support, such as `github-gh`, ignore it.

## Local state

Patchmill stores workflow state under `.patchmill/`:

- `.patchmill/runs/`
- `.patchmill/triage-runs/`

Task-contract details are documented in
[docs/task-contracts.md](./task-contracts.md).
