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
