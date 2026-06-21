# Recover Blocked Runs with Saved Branch/Worktree State Design

## Summary

Patchmill should provide a safe, guided recovery path when a `run-once`
execution stops with `status: "blocked"` after creating useful work on a saved
branch/worktree. A later `patchmill run-once --issue <n>` should not dead-end
with the generic stale branch/worktree safety error. Instead, Patchmill should
inspect the saved state and Git repository, explain what was preserved, and
either resume a safe blocked run or report exact non-destructive recovery
options.

## Goals

- Preserve the existing safety invariant: never delete or overwrite unmerged or
  dirty work automatically.
- Treat blocked implementation runs with saved branch/worktree state as
  recoverable when the saved workspace is still usable.
- Make `run-once --issue <n>` the primary retry path after an external
  prerequisite is fixed.
- Replace the generic stale-state error for blocked runs with a recovery report
  that includes the blocker reason, saved branch, saved worktree, and safe next
  actions.
- Distinguish clean, dirty, merged, diverged, partially missing, and fully
  missing saved workspace states.
- Cover recovery behavior with tests for an external verification prerequisite
  blocker.

## Non-goals

- Do not implement destructive cleanup as an implicit side effect of `run-once`.
- Do not require a new primary command before `run-once` can recover the common
  clean blocked case.
- Do not infer that all blocked runs are automatically safe to continue.
  Recovery is limited to blocked states with saved implementation workspace
  metadata and a safe Git inspection result.
- Do not change triage-level blocked issue semantics; this design applies to
  `run-once` run state where an automation run returned `status: "blocked"`.

## Current behavior

`src/cli/commands/run-once/run-state.ts` currently marks only `claimed`,
`planning`, and `implementing` states as resumable.
`src/cli/commands/run-once/pipeline.ts` then treats every non-resumable state
that still records a `branch` or `worktreePath` as stale and throws:

```text
Non-resumable run state for issue #<n> has stale branch/worktree; clean up before starting a fresh run
```

That guard is safe for terminal or obsolete states, but it is too blunt for
blocked implementation runs. A blocked implementation can contain unmerged
commits recorded in `commits` and preserved on `branch`, with validation paused
only because an external prerequisite was unavailable.

## Proposed behavior

### 1. Add a blocked-run recovery inspection

Introduce a focused recovery inspection helper in the `run-once` command area,
for example `src/cli/commands/run-once/recovery.ts`. It should accept the saved
`AgentIssueRunState`, repository root, configured base ref/branch/worktree
strategy, and command runner, then return a typed recovery report.

The report should include:

- run state path,
- issue number and title,
- saved status,
- blocker reason from `lastError`,
- saved branch and whether it exists,
- saved worktree and whether it exists/registered,
- worktree clean/dirty status when present,
- branch merged/unmerged status relative to the configured base branch,
- branch divergence from the configured base ref,
- saved commits from run state and/or `git log <baseRef>..<branch>`, and
- recommended safe actions.

Use Git commands behind small helpers so tests can simulate each case:

- `git show-ref --verify --quiet refs/heads/<branch>` for branch existence,
- `git worktree list --porcelain` for registered worktrees,
- `git -C <worktree> status --porcelain` for dirtiness,
- `git merge-base --is-ancestor <branch> <baseRef>` or equivalent to detect
  already-merged work,
- `git rev-list --left-right --count <baseRef>...<branch>` for ahead/behind
  divergence,
- `git log --oneline <baseRef>..<branch>` for visible unmerged commits.

### 2. Classify blocked recovery states

Add a classification type such as:

```ts
type BlockedRunRecoveryKind =
  | "recoverable-clean"
  | "dirty-worktree"
  | "already-merged"
  | "diverged"
  | "missing-worktree-existing-branch"
  | "missing-branch-or-worktree"
  | "not-blocked-recovery";
```

Required classifications:

- **clean unmerged branch/worktree**: saved branch and registered worktree
  exist, worktree is clean, branch is unmerged, and branch is not
  behind/diverged in a way that requires user intervention.
  `run-once --issue <n>` may continue using the existing branch/worktree.
- **dirty worktree**: stop before running agents; report dirty status and
  instruct the operator to commit, stash, or clean changes before retrying.
- **branch already merged**: do not retry implementation; report that work
  appears merged and suggest run-state cleanup/state finalization in a follow-up
  command or manual cleanup path.
- **branch diverged from current base**: warn before continuing. The default
  `run-once` path should stop with a clear message unless the implementation
  adds an explicit opt-in flag later; suggest rebase/cherry-pick onto current
  base.
- **missing worktree but existing branch**: report that the branch can be
  reattached with `git worktree add <path> <branch>` or recovered by a future
  explicit recover command. Do not recreate automatically unless the target path
  is absent and the branch matches the saved state exactly.
- **missing branch/worktree with stale run state**: report that the saved
  workspace is gone and suggest archiving/removing stale run state before
  starting fresh.

### 3. Make safe blocked states resumable by `run-once`

Update the resumability decision so blocked states are considered resumable only
after recovery inspection confirms `recoverable-clean`. This should not be a
broad change to `isResumableRunState(state)` alone unless that function can also
account for the Git recovery report. The safer design is:

1. Keep basic state resumability for ordinary in-flight states.
2. Before the stale branch/worktree guard, detect
   `existingState.status === "blocked"` with saved `branch` or `worktreePath`.
3. Build the blocked recovery report.
4. If the report is `recoverable-clean`, set the pipeline's resumed/resumable
   path for this issue and continue from the saved workspace.
5. Otherwise throw an `AgentIssueSafetyError` whose message is the formatted
   recovery report, not the generic stale-state error.

When continuing a clean blocked implementation run, preserve existing
checkpoints, branch, worktree path, spec/plan metadata, commits, validation, and
failure comment keys. The next run may re-enter the
implementation/development-environment verification stages as appropriate and
must not duplicate already-posted comments or recreate the branch.

### 4. Improve recovery output

Format non-recoverable blocked reports as operator-facing text, for example:

```text
Issue #45 has a blocked run with preserved workspace state.
Run state: .patchmill/runs/issue-45.json
Blocked reason: Required verification environment is unavailable.
Saved branch: agent/issue-45-example (exists, unmerged, ahead 4, behind 0)
Saved worktree: .worktrees/patchmill-issue-45-example (registered, clean)
Commits:
- abc1234 implement feature
- def5678 add tests

Recommended action: retry after the external prerequisite is fixed with:
  patchmill run-once --issue 45
```

For dirty, merged, diverged, or missing cases, replace the recommendation with
safe instructions. The message must never tell users to delete an unmerged
branch/worktree as the first option. Prefer archiving or preserving commands
when a fresh start is necessary.

### 5. Optional future `recover` command

This design does not require a new command for the first implementation. The
recovery report and clean blocked retry through `run-once --issue <n>` satisfy
the immediate issue. A later `patchmill recover --issue <n>` command can reuse
the same recovery inspection and formatting helpers to add explicit flags such
as `--retry`, `--retry-verification`, `--rebase-current-main`,
`--archive-and-rerun`, and `--abandon`.

## Affected components

- `src/cli/commands/run-once/pipeline.ts`
  - Detect blocked saved workspace state before the stale branch/worktree guard.
  - Use recovery inspection to decide whether to resume or throw a recovery
    report.
  - Ensure clean blocked retries preserve saved branch/worktree metadata.

- `src/cli/commands/run-once/run-state.ts`
  - Keep ordinary resumability clear, or add a separate helper name for blocked
    recovery so `blocked` is not blindly treated like `implementing`.

- `src/cli/commands/run-once/git.ts`
  - Reuse existing branch/worktree helpers where possible.
  - Add small Git status/divergence helpers if they are shared by worktree
    creation and recovery.

- `src/cli/commands/run-once/recovery.ts` (new)
  - Own blocked recovery inspection, classification, and human-readable report
    formatting.

- `src/cli/commands/run-once/pipeline.test.ts`
  - Add end-to-end pipeline tests for blocked retry and safety report behavior.

- `src/cli/commands/run-once/run-state.test.ts` or new `recovery.test.ts`
  - Add focused unit tests for classification and formatting.

## Safety requirements

- Never auto-delete saved branches or worktrees.
- Never overwrite dirty worktree changes.
- Never start a fresh branch when saved blocked state points at an existing
  unmerged branch/worktree.
- Stop with a warning when the saved branch is behind/diverged from configured
  base.
- Treat already-merged branches as cleanup/finalization candidates, not
  implementation retry candidates.
- Include exact saved paths in recovery output so operators can inspect the
  state manually.

## Verification strategy

Add tests that cover:

1. A blocked run caused by an external verification prerequisite writes blocked
   state with branch/worktree and, after the prerequisite is fixed,
   `runOneIssue` resumes the saved clean workspace instead of throwing the
   stale-state error.
2. A blocked run with a dirty saved worktree stops before Pi execution and
   prints dirty worktree recovery guidance.
3. A blocked run whose branch is already merged reports cleanup/finalization
   guidance instead of retrying implementation.
4. A blocked run whose branch is behind/diverged from base reports a
   rebase/cherry-pick warning.
5. A blocked run with a missing worktree but existing branch reports
   reattachment/recovery guidance.
6. A blocked run with missing branch and missing worktree reports stale
   run-state guidance.
7. Existing finished-state stale branch/worktree tests continue to reject fresh
   starts without destructive cleanup.

Run the relevant targeted tests, then the existing full test command used by the
project.

## Acceptance criteria

- A blocked run with a saved clean unmerged branch/worktree can be retried with
  `patchmill run-once --issue <n>` without manual deletion.
- `run-once` no longer emits only the generic stale branch/worktree error for
  blocked saved workspace states.
- Recovery output includes blocker reason, run-state path, saved branch, saved
  worktree, and commit information when available.
- Recovery distinguishes clean unmerged, dirty, already merged, diverged,
  missing-worktree/existing-branch, and missing-branch/worktree cases.
- Tests prove an external verification prerequisite blocker suggests
  retry/recover behavior rather than destructive cleanup.
