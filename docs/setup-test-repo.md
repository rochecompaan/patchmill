# Setup Test Repo

`patchmill setup-test-repo` creates a disposable public Team Lunch Poll
repository for trying Patchmill safely before using it on production issues.

## When to use it

Use this command when you want to see `patchmill init` and `patchmill triage`
work on realistic greenfield issues without risking an existing project.

## Supported providers

The command supports the same issue hosts Patchmill currently supports:

- `github-gh` through the GitHub `gh` CLI.
- `forgejo-tea` through the Forgejo/Gitea `tea` CLI.

The provider is required. Patchmill does not infer it from git remotes or CLI
state.

## Create a disposable GitHub repository

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
```

## Create a disposable Forgejo/Gitea repository

```bash
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
```

## Reset a disposable repository

`--reset` deletes and recreates the selected public repository. Use it only for
a repository you are comfortable losing.

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO --reset
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
```

## Fixture contents

The seeded repository receives these files from the installed Patchmill package:

- `README.md`
- `PROJECT_BRIEF.md`
- `issues/*.md`

The source fixture lives at `fixtures/patchmill-test-repo/` in the Patchmill
package and source tree.

## Manual Patchmill workflow

After setup, clone the disposable repository and run:

```bash
patchmill init
patchmill triage --dry-run
patchmill triage
```

`setup-test-repo` does not run `patchmill init` for you. The goal is to provide
a safe repository where you can exercise the same first-use workflow you would
run on a real project.
