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

## Shared mutations during explicit concurrency

Independent explicit issues can use one local clone concurrently. Short,
token-owned Git transactions protect shared fetches, worktree registration,
recovery refs, and branch deletion. Agent work, validation, and review do not
hold this guard.

Transactions wait at most 10 seconds by default. A busy transaction stops before
its action starts and returns `repository-busy`. Each owned Git command has a
60-second default timeout and bounded shutdown. An interrupted command can leave
partial mutations. Unknown shutdown evidence remains blocked.

Fetch operations pin the fetched OID before another transaction can replace
shared fetch data. Branch deletion requires the observed OID. Patchmill does not
force-update a changed branch, prune unrelated worktrees, or reset the shared
clone worktree.

## PR-only publication and merge proof

Implementation agents publish only their owned issue branch and a pull request.
They cannot update or push the target branch directly. `git.allowDirectLand`
defaults to `false`, and an explicit `true` value is rejected.

An open PR leaves the Issue run in progress. Completion requires the saved PR's
verified identity and merge commit, plus the remaining finish checkpoints.
Patchmill verifies the merge commit against a pinned target-base fetch. A
missing issue branch does not prove completion.

For a fork PR, the publishing remote can differ from the target repository.
Configure a fetch remote for the target before starting Run attempts. Patchmill
accepts exactly one preconfigured fetch endpoint with the saved target's
repository identity. Missing or ambiguous matches block. Patchmill does not
synthesize URLs or change Git configuration.

During active Run attempts, do not change Git configuration or mutate shared Git
state manually. Stop affected processes before an upgrade or namespace
migration. Do not remove another process's locks or force-clean its workspace.
