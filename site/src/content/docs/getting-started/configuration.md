---
title: Configuration
description: Learn how Patchmill repository configuration is organized.
---

Patchmill reads repository behavior from `patchmill.config.json`. The file
describes the issue host, git policy, workflow gates, skills, runtime behavior,
and local state paths used by Patchmill commands.

Run the onboarding command to create the initial configuration:

```sh
patchmill init
```

## Common configuration areas

A typical configuration covers these areas:

- `host`: issue and pull-request provider settings.
- `git`: base branch, remotes, worktree policy, and cleanliness checks.
- `triage`: labels and state mapping for issue triage.
- `workflow`: approval gates for specs, plans, implementation, and evidence.
- `skills`: skill references used for planning, implementation, debugging, and
  review.
- `runtime`: Pi model/provider behavior used by Patchmill-owned agent runs.
- `state`: local paths where Patchmill records run state.

## Repository-local state

Patchmill stores repo-local runtime state under `.patchmill/`. This includes
managed skills and Patchmill-owned Pi provider state.

The default initialization flow adds `.patchmill` and `patchmill.config.json` to
`.git/info/exclude`. For teams that want consistent Patchmill runs across
machines and CI, commit `patchmill.config.json` and project-local skills
explicitly.

## Git safety

Patchmill relies on git state to keep automated work reviewable. Configuration
can define branch-base policy, worktree strategy, and clean-worktree
expectations before commands mutate repository state.

Use `patchmill doctor` after configuration changes to validate host access,
labels, skills, runtime access, and local paths.

## Reference source

The full configuration reference remains in the repository at
`docs/configuration.md`. This site page is the public entry point and should
link readers to focused guides as the docs grow.
