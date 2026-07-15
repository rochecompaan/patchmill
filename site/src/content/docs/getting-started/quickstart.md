---
title: Quickstart
description: Install Patchmill and run the first repository checks.
---

Install Patchmill with npm:

```sh
npm install -g patchmill
```

Patchmill needs a working issue-host CLI before it can inspect issues or create
pull requests. Set up either GitHub's `gh` CLI or Forgejo/Gitea's `tea` CLI
first; see [Providers](/guides/providers/) for details.

In the repository you want Patchmill to manage, initialize the local
configuration:

```sh
patchmill init
```

Patchmill writes repository-local configuration, installs recommended skills,
and sets up local state.

Triage open issues with your configured workflow:

```sh
patchmill triage
```

Patchmill inspects open issues and applies the configured triage labels and
comments.

Advance one ready issue through the production line:

```sh
patchmill run-once
```

Patchmill can use published issue artifacts when your workflow requires them, or
create missing artifacts under your approval policy.

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
