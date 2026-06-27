# Hard-Block Run-Once When Issue Base Has Unpushed Commits Design

## Goal

Prevent `patchmill run-once` from starting any issue workflow when the
configured issue branch base would cause local-only commits to leak into the
issue PR.

## Current behavior

- `git.baseRef` defaults to `HEAD` and is passed to issue worktree creation in
  `src/cli/commands/run-once/git.ts`.
- `git.baseBranch` and `git.remote` identify the intended landing branch and
  default to `main` and `origin`.
- `runOneIssue()` currently selects an issue, then checks the repository
  worktree is clean, claims the issue, comments, advances planning, and only
  later creates or reuses the issue worktree.
- A locally committed Patchmill setup commit on `HEAD` that has not been pushed
  to `origin/main` can therefore become part of every generated issue branch and
  PR.

## Desired behavior

Before `run-once` performs any mutating workflow step, it must validate that the
configured issue branch base is already contained in the configured upstream PR
base.

The upstream PR base is derived from existing git config fields:

```text
refs/remotes/<git.remote>/<git.baseBranch>
```

For the defaults, the target base is `refs/remotes/origin/main`.

If `git.baseRef` resolves to commits that are not contained in that target base,
`run-once` must exit non-zero with an actionable safety error. The error must
list the commits that would leak into the issue PR and must not offer a CLI or
configuration override in the initial implementation. `--dry-run` must report
the same safety failure because it previews whether the command is safe to
start.

## Proposed design

### Git safety helper

Add a focused helper in `src/cli/commands/run-once/git.ts`, for example
`assertIssueBaseContainedInPrBase()`, that accepts the injected `CommandRunner`,
`repoRoot`, `baseRef`, `remote`, and `baseBranch`.

The helper should:

1. Build the target ref as `refs/remotes/${remote}/${baseBranch}`.
2. Resolve `baseRef` with `git rev-parse --verify <baseRef>^{commit}` so bad
   local base refs fail with an explicit message.
3. Resolve the target ref with
   `git rev-parse --verify refs/remotes/<remote>/<baseBranch>^{commit}` so
   missing or stale remote-tracking refs fail before mutation with remediation
   to fetch or configure `git.remote`/`git.baseBranch` correctly.
4. Detect leaked commits with a command equivalent to:

   ```sh
   git log --oneline refs/remotes/<remote>/<baseBranch>..<baseRef>
   ```

5. Return successfully when the log output is empty.
6. Throw an error when output is non-empty. The message should include the
   configured base ref, target base ref, the leaked commit list, and
   remediation: push or merge the setup commits first, fetch the remote if it is
   stale, or set `git.baseRef` to an upstream ref already contained in the PR
   base.

Use the existing `formatCommandFailure()` style for git command failures so
stdout/stderr are preserved. The helper should not run `git fetch`; this feature
is a guardrail, not an implicit network mutation.

### Pipeline placement

Call the helper in `runOneIssue()` after issue selection has identified the
candidate issue and before any mutating operation:

- before `assertCleanWorktree()`;
- before label creation or application;
- before comments;
- before run-state writes;
- before worktree creation;
- before any Pi invocation.

The call should happen before the current dry-run return so `--dry-run` also
fails when the configured base is unsafe. It is acceptable that `run-once` still
queries the issue host to know whether there is an issue to preview; the hard
block requirement is about preventing mutating workflow steps.

When no eligible issue exists, `run-once` can continue returning `no-issue`
without running the safety check, because there is no issue branch to create.

### Error shape and user output

The existing `main()` error path already converts thrown errors into non-zero
JSON output:

```json
{ "status": "error", "error": "...", "logPath": "..." }
```

Keep that shape for this safety failure. The important contract is that the
error text is actionable and includes the leaking commits. Do not model this as
an issue-level `blocked` result, because the operator must fix repository git
state before any issue claim or issue comment is made.

Example error text:

```text
Configured git.baseRef HEAD is not contained in refs/remotes/origin/main.
These commits would be included in the issue PR:
abc1234 chore: initialize Patchmill

Push or merge these commits into origin/main, run git fetch if the remote ref is stale, or configure git.baseRef to a ref already contained in refs/remotes/origin/main.
```

### Documentation

Update `docs/issue-agent-workflows.md` to document the preflight ordering and
why the command blocks before claiming an issue. Update `docs/configuration.md`
near the `git` config section to explain:

- default target base derivation from `git.remote` and `git.baseBranch`;
- why the default `git.baseRef: "HEAD"` can be unsafe after local-only setup
  commits;
- how to fix the failure by pushing/merging setup commits, fetching stale remote
  refs, or setting `git.baseRef` to an upstream ref already contained in the
  target base.

## Affected components

- `src/cli/commands/run-once/git.ts`
  - Add the containment helper and tests for git command sequencing, clean
    containment, leaked commits, and missing target refs.
- `src/cli/commands/run-once/pipeline.ts`
  - Call the helper after selecting an issue and before dry-run success or any
    mutation.
- `src/cli/commands/run-once/pipeline.test.ts`
  - Add orchestration coverage proving clean bases proceed, unsafe bases stop
    before claim/comment/worktree/Pi calls, and dry-run reports the same safety
    failure.
- `src/cli/commands/run-once/types.ts`
  - No new config fields are expected; existing `remote`, `baseBranch`, and
    `baseRef` are sufficient.
- `docs/issue-agent-workflows.md` and `docs/configuration.md`
  - Document the guardrail and operator remediation.

## Verification strategy

Add focused automated tests for:

- clean case: `git.baseRef` is contained in `refs/remotes/<remote>/<baseBranch>`
  and `run-once` proceeds to the existing clean-worktree and workflow logic;
- dirty/ahead case: `git log <target>..<baseRef>` returns commits and `run-once`
  exits before claiming, commenting, creating a worktree, writing run state, or
  running Pi;
- dry-run unsafe case: `--dry-run` reports the same safety error rather than a
  successful preview;
- remote-ref failure case: resolving `refs/remotes/<remote>/<baseBranch>` fails
  and the error tells the operator to fetch or fix
  `git.remote`/`git.baseBranch`;
- configured target case: non-default `git.remote` and `git.baseBranch` produce
  `refs/remotes/<remote>/<baseBranch>` in git commands and error text.

Run targeted tests:

```sh
node --test src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Run the full suite before merge:

```sh
npm test
```

No npm dependency changes are required, so no Nix build is required for this
feature unless implementation later changes package metadata.
