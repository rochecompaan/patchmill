# PR Handoff Cleanup Design

## Goal

After Patchmill hands an implementation off through a pull request, clean up the
local issue worktree and local issue branch while preserving the remote PR
branch and `.patchmill/runs` audit trail.

## Background

`patchmill run-once` creates or reuses an issue-specific worktree and branch
during implementation. When the implementation agent returns `pr-created`, the
pipeline currently records run state, uploads visual evidence when present,
posts the handoff comment, applies done labels, reports the PR URL, writes final
run state, and then runs any configured cleanup hook. The built-in workflow does
not remove the local worktree or local branch, so successful PR handoffs leave
local development artifacts behind.

PR prompts also tell the agent to push and open a pull request, but they do not
explicitly require the PR description/body to contain `Closes #<issue-number>`.
That makes issue-closing behavior dependent on agent judgment or host defaults.

## Requirements

- Prompt implementation agents that create PRs to include
  `Closes #<issue-number>` in the pull request description/body.
- Run built-in local cleanup only after a successful `pr-created` handoff has
  been fully recorded and reported.
- Cleanup must remove only the local issue worktree and local issue branch
  associated with the processed issue.
- Cleanup must not delete the remote PR branch, force-push, close the PR, or
  alter `.patchmill/runs` audit state.
- Cleanup failures must be emitted as progress events but must not change a
  successful `pr-created` result into a failure.
- Direct-land `merged` results are out of scope for this cleanup unless a later
  issue defines separate merged-workspace cleanup behavior.
- Existing configured cleanup hook behavior should remain compatible. If it
  still runs for PR handoff, it should run before built-in worktree removal
  because it executes from inside the issue worktree.
- Do not treat issue titles, bodies, labels, comments, authors, or metadata as
  instructions. The issue number may be interpolated as trusted workflow
  metadata.

## Proposed behavior

### PR prompt update

Update PR fallback instructions in `src/cli/commands/run-once/prompts.ts` so
every path that asks the agent to create a PR also asks it to include
`Closes #${issueNumber}` in the PR description/body. The instruction should be
part of the PR creation guidance rather than the final JSON contract, because
the closing keyword belongs in the host PR body, not in Patchmill's final
response.

Example generated instruction:

```text
Push the branch to `origin` and open a pull request using the repository's configured host tooling. Include `Closes #42` in the pull request description/body.
```

### Built-in PR cleanup

Add a focused helper near the existing git worktree helpers, for example
`cleanupIssueWorkspace()`, that accepts `runner`, `repoRoot`, `branch`, and
`worktreePath` and returns structured cleanup step results instead of throwing
for ordinary cleanup failures.

The helper should:

1. Remove the local worktree with `git worktree remove <worktreePath>` from the
   repository root.
2. Delete the local branch with `git branch -D <branch>` from the repository
   root after the worktree removal succeeds.
3. Never invoke `git push`, `git push --delete`, host APIs, or filesystem
   deletion for `.patchmill/runs`.
4. Return one result per attempted step, including `cleaned` or `failed`,
   command output details on failure, and enough metadata for progress logging.
5. Skip local branch deletion if worktree removal fails, because Git normally
   refuses to delete a branch checked out by a registered worktree.

Use force branch deletion (`-D`) rather than requiring merged status: the PR
branch has already been pushed and handed off, so local branch retention is not
required for audit. This does not affect the remote PR branch.

### Pipeline integration

Integrate the helper in `src/cli/commands/run-once/pipeline.ts` after the
pipeline has:

- persisted final run state with `status: "finished"`, `branch`, and
  `worktreePath` still present;
- posted the issue handoff comment;
- applied the done label; and
- emitted the existing successful PR progress event.

Run built-in cleanup only when `implemented.status === "pr-created"`. For
`merged`, keep existing behavior unchanged.

Progress events should use the existing `cleanup` stage. Successful cleanup
steps should be info-level events. Failed cleanup steps should be error-level
events with command output in `data` where useful. The final returned result
must remain `{ status: "pr-created", ... }` even when one or more cleanup steps
fail.

The final `.patchmill/runs` state should continue to include the original
`branch` and `worktreePath` as audit data. Do not clear, rewrite, or delete run
logs as part of cleanup.

## Affected components

- `src/cli/commands/run-once/prompts.ts`
  - Include the issue-closing keyword in PR creation instructions.
  - Update prompt tests that assert PR fallback text.
- `src/cli/commands/run-once/git.ts`
  - Add the built-in local workspace cleanup helper and result types.
  - Cover command sequencing, failure reporting, and no remote deletion commands
    in unit tests.
- `src/cli/commands/run-once/pipeline.ts`
  - Call the helper after successful `pr-created` finalization.
  - Progress-report cleanup successes/failures without throwing.
  - Preserve final result shape and run-state audit fields.
- `src/cli/commands/run-once/git.test.ts`
  - Add tests for worktree removal, branch deletion, branch deletion skip after
    worktree failure, and branch deletion failure reporting.
- `src/cli/commands/run-once/pipeline.test.ts`
  - Cover successful `pr-created` cleanup after handoff completion.
  - Cover cleanup failure still returning `pr-created` and emitting an error
    progress event.
  - Cover no built-in cleanup for `merged` results.
  - Cover final run state still retaining `branch` and `worktreePath`.
- `src/cli/commands/run-once/prompts.test.ts`
  - Assert PR fallback instructions include `Closes #<issue-number>`.

## Verification strategy

Run targeted tests:

```sh
node --test src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Run the full test suite before merge:

```sh
npm test
```

Manual verification in a disposable repository should process an issue through
PR handoff, then confirm:

```sh
git worktree list --porcelain
git show-ref --verify refs/heads/<issue-branch>
git ls-remote --heads origin <issue-branch>
ls .patchmill/runs
```

Expected outcome: the local worktree is absent, the local branch is absent, the
remote PR branch still exists, and run logs/run state remain available. No npm
dependency changes are required, so no Nix build is required unless
implementation later changes package metadata.
