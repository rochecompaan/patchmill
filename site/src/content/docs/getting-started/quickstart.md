---
title: Quickstart
description: Install Patchmill and run the first repository checks.
---

Install the Patchmill CLI globally, then start with the onboarding flow:

```sh
npm install -g patchmill

patchmill init
patchmill auth
patchmill doctor
patchmill triage --dry-run
```

If you prefer not to install Patchmill globally, use `npx`:

```sh
npx patchmill init
npx patchmill auth
npx patchmill doctor
npx patchmill triage --dry-run
```

## Command sequence

1. `patchmill init` writes the local Patchmill configuration, installs
   recommended skills, and sets up repository-local state.
2. `patchmill auth` configures or repairs repo-local Pi provider authentication
   under `.patchmill/pi-agent`.
3. `patchmill doctor` runs read-only checks for git, host access, labels,
   skills, runtime access, and local paths.
4. `patchmill triage --dry-run` previews issue triage without mutating issues.

## Migrating from `@rochecompaan/patchmill`

The scoped npm package `@rochecompaan/patchmill` is deprecated. Install the
unscoped package instead:

```sh
npm uninstall -g @rochecompaan/patchmill
npm install -g patchmill
```

For one-off usage, replace `npx @rochecompaan/patchmill ...` with
`npx patchmill ...`.

## Try Patchmill on a disposable demo repository

Before pointing Patchmill at a production repository, create a disposable Team
Lunch Poll demo repository and let Patchmill triage its seeded issues.

For GitHub:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
gh repo clone OWNER/REPO
cd REPO
patchmill init
patchmill triage
patchmill run-once
```

For Forgejo or Gitea with a named `tea` login:

```bash
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
tea clone OWNER/REPO
cd REPO
patchmill init
patchmill triage
patchmill run-once
```

Use an explicit disposable public repository for `OWNER/REPO`. The reset form
deletes and recreates that repository:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO --reset
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
```

## Updating Patchmill-managed skills

To update a repository after Patchmill publishes a newer bundled skill pack,
run:

```sh
npx patchmill@latest skills update
```

The update command only changes Patchmill-managed project-local skills. It stops
if managed skill files were edited locally. After a successful update, run
`git diff` and commit the skill changes with the repository.
