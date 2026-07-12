---
title: Environment and configuration reference
description:
  Public reference for common Patchmill environment and configuration entry
  points.
---

Patchmill combines CLI commands, repository configuration, host-provider
authentication, and Pi runtime state.

## Files and directories

| Path                      | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `patchmill.config.json`   | Repository-level Patchmill configuration.     |
| `.patchmill/skills/`      | Project-local managed or custom skills.       |
| `.patchmill/pi-agent/`    | Patchmill-owned repo-local Pi provider state. |
| `.patchmill/runs/`        | Local run-state records.                      |
| `.patchmill/triage-runs/` | Local triage-run records.                     |

## Common commands

| Command                      | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `patchmill init`             | Create or repair local Patchmill configuration and recommended skills. |
| `patchmill auth`             | Configure or repair repo-local Pi runtime authentication.              |
| `patchmill doctor`           | Run read-only checks for repository readiness.                         |
| `patchmill triage --dry-run` | Preview issue triage without mutating issues.                          |
| `patchmill triage`           | Run issue triage with configured provider behavior.                    |
| `patchmill run-once`         | Advance one ready issue through the configured production line.        |
| `patchmill skills update`    | Update Patchmill-managed project-local skills.                         |

## Environment variables

Patchmill inherits provider and runtime environment from the shell and the
configured CLIs. Use `patchmill auth` for Patchmill-owned Pi runtime setup and
provider-specific CLI commands such as `gh auth status` or `tea login list` for
host access checks.

| Variable               | Purpose                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PATCHMILL_HOST_LOGIN` | Host account/login override for providers with named-login support, such as `forgejo-tea`; ignored by `github-gh`. |

## Git configuration notes

`git.baseBranch` controls the pull-request target branch used by `run-once`. If
it is omitted, Patchmill checks `refs/remotes/<git.remote>/HEAD`, then the
current branch upstream when it tracks the same remote, and finally falls back
to `main`.

Set `git.baseBranch` explicitly when local git metadata cannot identify the PR
target or when repository policy requires a fixed branch. Explicit values are
authoritative.

## Verification command

Run this after changing configuration, credentials, skills, or local paths:

```sh
patchmill doctor
```
