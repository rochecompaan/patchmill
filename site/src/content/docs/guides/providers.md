---
title: Providers
description: Configure GitHub or Forgejo host access and Pi authentication.
---

Patchmill uses `gh` for GitHub and `tea` for Forgejo or Gitea. Host
authentication and Pi model-provider authentication are separate. Configure the
host CLI before initialization.

## GitHub

Make sure that `gh auth status` reports a usable login. In the repository, run
`patchmill init --provider github-gh`. GitHub uses the active `gh`
authentication context. Init can seed `host.login` with the detected username
for comment trust. That value does not select a GitHub account.

## Forgejo and Gitea

Use `tea logins list` to inspect profiles. Run
`patchmill init --provider forgejo-tea` to use Tea's default profile. An empty
`host.login` means the default profile. To select another profile, use
`patchmill init --provider forgejo-tea --login PROFILE` with its explicit alias.
The detected username is not a profile alias. There is no Patchmill login
environment override.

For draft pull requests, the planning skill uses a `WIP:` title with Tea. The
implementation skill removes that prefix when work is ready. Patchmill also
recognizes native draft state and `Draft:` title prefixes.

## Pi authentication

`patchmill auth` opens interactive Pi with `PI_CODING_AGENT_DIR` set to the
configured agent directory. Use Pi's `/login` and `/model` flows there.
Patchmill keeps no second authentication or model record.

See [Pi and subagents](/guides/pi-and-subagents/) for local runtime settings.
After setup, run `patchmill labels setup` and `patchmill doctor`. Doctor
includes a real model smoke prompt and writes local logs. It does not repair
host or repository configuration.
