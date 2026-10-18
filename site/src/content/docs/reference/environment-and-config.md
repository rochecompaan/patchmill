---
title: Environment and configuration reference
description: Repository files, Pi environment, and local run output.
---

`patchmill.config.json` controls the host, labels, paths, base branch, three
skill entry points, Pi agent directory and timeout, and optional spec gate.
Unknown keys fail by name. See the
[complete defaults](/reference/configuration-example/).

## Files and directories

| Default path                        | Purpose                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `patchmill.config.json`             | Shared repository configuration.                                          |
| `.patchmill/skills/`                | Installed skills and `patchmill-skill-pack.json` with sources and hashes. |
| `.patchmill/pi-agent/`              | Local Pi credentials, settings, and reviewer definition.                  |
| `.worktrees/`                       | One worktree per issue branch.                                            |
| `docs/specs/` and `docs/plans/`     | Specs and plans committed on the issue branch.                            |
| `.patchmill/runs/issue-N/lock`      | Permanent local OS lock with diagnostic JSON.                             |
| `.patchmill/runs/issue-N/<run-id>/` | Prompt, session logs, sessions, and write-only result.                    |
| `.patchmill/runs/triage/<run-id>/`  | Triage prompt, log, and sessions.                                         |

`init` adds local Git excludes for worktrees, runs, and the agent directory.
Commit shared configuration and skills, not credentials or local run output.
Never remove or replace the permanent lock file or its parent directory.

## Pi environment

Patchmill sets `PI_CODING_AGENT_DIR` to the configured agent directory for Pi
processes. Other provider environment comes from the shell and host CLIs.
Patchmill has no host-login environment override. GitHub uses active `gh`
authentication. Forgejo uses Tea's default profile when `host.login` is empty,
or the explicit profile alias when set.

`patchmill auth` presents standalone authentication and model pickers. Pi's SDK
saves credentials in the configured agent directory's `auth.json`. Patchmill
saves `defaultProvider` and `defaultModel` in Pi's `settings.json`, then
verifies the provider with a real model call. The command returns to the shell
without opening Pi chat. There is no separate Patchmill credential store.

Run-once loads `pi-subagents` through runtime `-e` arguments. Triage supplies no
explicit extension paths. This does not guarantee global extension isolation.

## Operator commands

| Command                                                    | Behaviour                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patchmill init`                                           | Write config when missing, install skills, provision the agent directory. Idempotent.                                                                         |
| `patchmill auth`                                           | Choose a subscription or API key, provider, and default model. Save them in the configured Pi agent directory, verify the provider, then return to the shell. |
| `patchmill doctor`                                         | Read-only checks: host CLI logged in, labels exist, worktree directory ignored, skills present, Pi answers a smoke prompt.                                    |
| `patchmill labels setup`                                   | Create missing labels.                                                                                                                                        |
| `patchmill triage [--dry-run]`                             | Run the triage skill per candidate issue. Dry run runs Pi and prints the labels and comment instead of applying them.                                         |
| `patchmill run-once [--issue N] [--dry-run] [--plan-only]` | Advance one issue. Dry run prints the selected issue and derived phase without claiming or running Pi.                                                        |
| `patchmill release --issue N`                              | Clear a stale claim after a hard crash.                                                                                                                       |
| `patchmill version`                                        | Print the version.                                                                                                                                            |
| `patchmill setup-test-repo`                                | Development tool for the end-to-end CI (#320). Outside the kernel.                                                                                            |

`doctor` is read-only with respect to repository and host configuration, but it
writes local smoke logs and makes a model call. Triage dry run also makes model
calls and writes local output. Run-once dry run does not claim or run Pi. Logs
and sessions can contain sensitive content. Keep them local.
