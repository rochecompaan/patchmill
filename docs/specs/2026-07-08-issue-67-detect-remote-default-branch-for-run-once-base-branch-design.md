# Base Branch Detection Design

## Purpose

`patchmill run-once` currently defaults `git.baseBranch` to `main` and derives
the PR target base as `refs/remotes/<git.remote>/<git.baseBranch>`. The run-once
branch-base safety guard correctly fails when that ref cannot be resolved, but
repos whose default branch is `master` now get an unhelpful error unless they
manually configure `git.baseBranch`.

Patchmill should detect the repository's remote default branch when the user has
not explicitly configured `git.baseBranch`, while keeping explicit configuration
authoritative.

## Goals

- Let existing repos such as `agibase` run with no git config when the local git
  metadata clearly shows that `origin/master` is the default branch.
- Preserve the safety guard that verifies the resolved target ref before any
  run-once mutation.
- Preserve explicit config semantics: if `git.baseBranch` is set, Patchmill uses
  that value and does not auto-rewrite it.
- Improve failure messages so users can distinguish a stale fetch from an
  incorrect base-branch setting.

## Non-goals

- Do not run `git fetch` implicitly.
- Do not change remote-host provider behavior.
- Do not migrate existing `patchmill.config.json` files automatically.
- Do not add CLI flags for base-branch overrides in this change.

## Behavior

When assembling run-once config, Patchmill resolves the effective base branch as
follows:

1. If user config contains `git.baseBranch`, use it exactly.
2. Otherwise, detect the branch pointed to by the configured remote's symbolic
   HEAD, for example `refs/remotes/origin/HEAD -> refs/remotes/origin/master`.
3. If the remote HEAD is unavailable, inspect the current branch's upstream; use
   it only when the upstream remote matches `git.remote`.
4. If detection cannot determine a branch, fall back to the existing default
   `main`.

For `agibase`, this means Patchmill detects `origin/master`, sets the effective
`baseBranch` to `master`, and the existing safety guard checks
`refs/remotes/origin/master`.

## Architecture

Add a small run-once git helper dedicated to base-branch detection. It should
use the existing injected `CommandRunner` rather than calling git directly, so
tests can cover command behavior without touching real repos.

The helper returns a structured result, for example:

```ts
type DetectedBaseBranch =
  | { status: "detected"; branch: string; source: "remote-head" | "upstream" }
  | { status: "fallback"; branch: string; reason: string };
```

`loadCliConfig` or the run-once config assembly layer should call the helper
only when the parsed config file omitted `git.baseBranch`. The normalized
`AgentIssueConfig` should continue to contain a concrete `baseBranch` string so
the rest of the pipeline remains unchanged.

Because `loadPatchmillConfigState()` currently merges defaults before returning
config, the loader must expose whether `git.baseBranch` was explicitly provided.
A narrow metadata field is preferred over broad schema churn, such as returning
a set of explicit config paths or a run-once-specific flag.

## Detection commands

The remote-HEAD path should prefer local-only commands, such as:

```sh
git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD
```

If that returns `origin/master`, strip the `<remote>/` prefix and validate that
a branch name remains.

The upstream fallback can use local config, such as:

```sh
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
```

If the result is `<remote>/<branch>`, strip the matching remote prefix and use
the branch. If the current branch has no upstream or tracks a different remote,
ignore it and continue to the final fallback.

## Error handling and UX

The existing `assertIssueBaseContainedInPrBase()` safety check should remain the
single place that verifies the target ref resolves to a commit and that
`git.baseRef` is contained in it.

If target-ref resolution fails, the error should include:

- the target ref that failed;
- the configured remote and effective base branch;
- remediation to run `git fetch <remote>` when the ref may be stale;
- remediation to set `git.baseBranch` when the detected/default branch is wrong;
- when available, a detected remote default branch that differs from the
  effective branch.

This keeps failures actionable without hiding unsafe state.

## Testing

Add automated tests for the new behavior because it changes reusable git/config
logic and prevents a regression in run-once startup.

Required coverage:

- Missing `git.baseBranch` plus `refs/remotes/origin/HEAD -> origin/master`
  resolves the effective branch to `master`.
- Missing `git.baseBranch` plus current branch upstream `origin/master` resolves
  to `master` when remote HEAD is unavailable.
- Explicit `git.baseBranch: "main"` remains `main`, even if detection would find
  `master`.
- Detection failure preserves the existing default `main` and still fails
  through the safety guard if `origin/main` cannot be resolved.
- Custom remote names are handled, for example `upstream/release/1.2` resolves
  to `release/1.2` for `git.remote: "upstream"`.

Run the relevant run-once/config tests first, then the full test suite.

## Rollout

This is backward compatible for configured repos because explicit
`git.baseBranch` remains authoritative. Unconfigured repos improve from failing
on `origin/main` to using the locally known remote default branch when
available.
