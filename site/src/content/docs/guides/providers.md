---
title: Providers
description: Configure issue-host and runtime providers used by Patchmill.
---

Patchmill connects repository work to host providers and Pi runtime providers.

## Supported issue-host workflow

Patchmill issue workflows need provider access for reading issues, applying
labels, posting comments, and creating or updating pull requests.

Supported host paths include:

- GitHub through the `gh` CLI.
- Forgejo or Gitea through the `tea` CLI.

## GitHub setup

For GitHub repositories, authenticate `gh` before running Patchmill commands:

```sh
gh auth status
```

Then configure Patchmill with the provider and repository details used by your
project.

## Forgejo and Gitea setup

For Forgejo or Gitea repositories, configure a named `tea` login before running
Patchmill commands:

```sh
tea login list
```

Use the configured login name when creating disposable demo repositories or
configuring host access.

## Runtime Pi authentication

`patchmill auth` configures or repairs repo-local Pi provider authentication
under `.patchmill/pi-agent`. Run it after provider credentials, model
selections, or local runtime settings change.

## Validate provider access

Run the doctor command after provider changes:

```sh
patchmill doctor
```

The doctor command is read-only and reports host access, labels, configured
skills, runtime access, and local path status.
