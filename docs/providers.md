# Patchmill Providers

Patchmill separates orchestration from issue-host integrations. Pi is the built-in runtime for planning, implementation, skills, todos, subagents, and TUI-driven review.

## Supported now

| Area | Name | Backing tool | Status |
| --- | --- | --- | --- |
| Issue host | `forgejo-tea` | `tea` CLI | supported seed provider |
| Runtime | Pi | `pi` CLI/TUI | built-in runtime |

## Planned later

| Area | Provider | Backing tool |
| --- | --- | --- |
| Issue host | `github-gh` | `gh` CLI |
| Issue host | `gitlab-glab` | `glab` CLI or GitLab REST |

Host provider implementations and Pi prompt contracts must preserve Patchmill's safety rules: strict structured output, untrusted issue-content boundaries, checkpointed host mutations, and clean worktree checks.

Generic Patchmill configuration should use `PATCHMILL_*` names and the `patchmill` CLI. Create `patchmill.config.json` in the repo root — even `{}` is enough — to make the CLI-dispatched compatibility workflows load normalized Patchmill defaults. Without that file, `bin/patchmill.ts` still dispatches to the copied `agent-issue-*` scripts and their Croprun compatibility fallbacks for login names, agent-team names, visual-evidence upload settings, paths, cleanup, and prompt policy remain active. See [docs/migration-from-croprun-scripts.md](./migration-from-croprun-scripts.md) for the exact command and environment-variable mappings.

Pi task and plan naming conventions are documented in [docs/task-contracts.md](./task-contracts.md). Projects can override those defaults through `projectPolicy.pi.taskContract` so prompt text, todo readers, and plan-task readers stay in sync.
