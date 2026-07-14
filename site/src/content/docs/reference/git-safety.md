---
title: Git safety
description:
  Reference the branch-base guardrails Patchmill applies before run-once starts.
---

`patchmill run-once` creates issue branches from `git.baseRef`. The default is
`"HEAD"`, which is convenient after a normal clone but can be unsafe just after
initializing Patchmill: if you commit generated configuration locally and do not
push or merge that commit to the pull-request target branch, every issue branch
created from local `HEAD` would include that setup commit.

Before claiming an issue, commenting, writing run state, creating a worktree, or
running Pi, `run-once` checks that `git.baseRef` is contained in the configured
pull-request target base.

## Target base detection

The target base is derived from:

```text
refs/remotes/<git.remote>/<git.baseBranch>
```

When `git.baseBranch` is omitted, `run-once` tries to detect the target branch
from local git metadata in this order:

1. `refs/remotes/<git.remote>/HEAD`
2. the current branch upstream when it tracks `<git.remote>`
3. `main`

With default settings, the fallback target base is `refs/remotes/origin/main`.

Set `git.baseBranch` when the repository's pull-request target branch should be
explicit or when local git metadata cannot identify the remote default branch.
Explicit `git.baseBranch` values are authoritative and are not overwritten by
detection.

## Containment check failures

If `git.baseRef` has commits that are not in the target base, `run-once` exits
non-zero and lists the commits that would leak into the issue pull request.
There is no CLI or config override for this guardrail.

Fix the repository state by doing one of the following:

- push or merge the local setup commits into `<git.remote>/<git.baseBranch>`;
- run `git fetch <git.remote>` if the remote-tracking ref is stale;
- set `git.baseBranch` to the repository's pull-request target branch if
  detection chose the wrong branch;
- set `git.baseRef` to an upstream ref that is already contained in the target
  base, such as `refs/remotes/origin/main` or `refs/remotes/origin/master`.

`patchmill run-once --dry-run` performs the same check because it previews
whether a real `run-once` can safely start.
