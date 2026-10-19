---
title: Quickstart
description: Install Patchmill and advance an issue.
---

Use a repository with an `origin` remote and an authenticated `gh` or `tea` CLI.
See [Providers](/guides/providers/) before initialization. Patchmill has no
general migration path from earlier configuration or workflow state. Retired
review-label settings are accepted but ignored.

## Install and initialize

For GitHub, run these commands in the repository:

```sh
npm install -g patchmill
patchmill init --provider github-gh
patchmill auth
patchmill labels setup
patchmill doctor
```

For Forgejo, replace the init command with
`patchmill init --provider forgejo-tea`. To select a named Tea profile, append
`--login PROFILE`. Without that flag, the empty login uses Tea's default
profile.

`init` writes missing configuration, installs skills, provisions the reviewer,
and adds local Git excludes. It leaves valid existing configuration alone.
`auth` asks for an authentication method, provider, and default model. It saves
them in the repository's Pi agent directory, verifies the provider with a real
model call, and returns to the shell without opening Pi chat. `doctor` also
includes a real model call.

## Triage and run

```sh
patchmill triage --dry-run
patchmill triage
patchmill run-once --dry-run
patchmill run-once
```

Triage dry run calls Pi and writes local logs, but does not change host labels
or comments. Run-once dry run prints the selected issue and derived phase
without claiming it or running Pi.

Planning gates default off. To require a separate spec or plan review before
implementation, enable its workflow gate in the configuration. Review and merge
each planning pull request. The issue stays `in-progress` while waiting. After
each merge, run:

```sh
patchmill run-once --issue N
```

Review approval alone does not unlock a gate. An open planning pull request
keeps the workflow paused without running Pi. With both gates off, planning
writes both documents on the implementation branch and continues directly.

After implementation, `agent-done` identifies a ready pull request that closes
the issue. Review and merge it through the host. Patchmill does not merge or
remove the worktree.

## Optional disposable repository

`patchmill setup-test-repo --provider github-gh --repo OWNER/REPO` creates a
public demo repository and seeded issues. Use only an explicitly disposable
repository. The `--reset` flag deletes and recreates it. For Forgejo, use
`--provider forgejo-tea` and an optional `--login PROFILE`. Clone the resulting
repository, then follow the initialization commands above.

To reinstall the shipped skills for the installed Patchmill version, run
`patchmill init` again. Review and commit configuration and skill changes. Keep
credentials, logs, and sessions local.
