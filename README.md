<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="Patchmill logo" src="docs/assets/logo-light.svg" width="400">
  </picture>
</p>

Patchmill is an agent-driven software factory for turning product work into
reviewed, landed changes without hiding the engineering judgment between idea
and production.

It connects an issue host, repository policy, git worktrees, and configurable
agent skills so teams can triage issues, plan work, implement in isolation,
review results, collect evidence, and land changes with clear handoffs.

## Documentation

Read the full documentation at **[patchmill.dev](https://patchmill.dev)**.

Start here:

- [Overview](https://patchmill.dev/getting-started/overview/)
- [Quickstart](https://patchmill.dev/getting-started/quickstart/)
- [Configuration](https://patchmill.dev/getting-started/configuration/)
- [Triage](https://patchmill.dev/using-patchmill/triage/)
- [Run-once](https://patchmill.dev/using-patchmill/run-once/)

## Install

```sh
npm install -g patchmill
```

Or run one command with `npx`:

```sh
npx patchmill --help
```

## Basic workflow

```sh
patchmill init
patchmill auth
patchmill doctor
patchmill triage --dry-run
patchmill triage
patchmill run-once
```

## Main commands

- `patchmill init` initializes local configuration and recommended skills.
- `patchmill auth` configures or repairs repo-local Pi provider authentication.
- `patchmill doctor` runs read-only readiness checks.
- `patchmill triage` classifies open issues for automation.
- `patchmill run-once` advances one actionable issue through the configured
  workflow.
- `patchmill set-spec` and `patchmill set-plan` publish approved workflow
  artifacts to an issue.
- `patchmill skills update` updates Patchmill-managed project-local skills.

## Supported hosts

Patchmill currently supports:

- GitHub through the `gh` CLI (`github-gh`)
- Forgejo/Gitea through the `tea` CLI (`forgejo-tea`)

## Superpowers

Patchmill works especially well with the
[Superpowers](https://github.com/obra/superpowers) skills pack. Patchmill
provides the factory floor; Superpowers provides much of the planning,
implementation, debugging, review, and workflow discipline that moves work
through it.

## License

Apache-2.0. See [LICENSE](LICENSE).
