---
title: Quickstart
description: Install Patchmill and advance an issue.
---

Use a repository with an `origin` remote and an authenticated `gh` or `tea` CLI.
See [Providers](/guides/providers/) before initialization. Patchmill has no
migration path from earlier configuration or workflow state.

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

At `spec-review`, review the pushed spec on the issue branch. To approve it, add
`spec-approved` and `agent-ready` to the issue. Then run:

```sh
patchmill run-once --issue N
```

To request a revision, leave approval off and add review comments and
`agent-ready`. The next attempt revises the existing spec and stops for review
again. Approval is never inferred from the agent's own review.

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
