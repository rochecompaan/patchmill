# Restore cleanupHook and merged-issue cleanup

- **Issue:** #350
- **Status:** Proposed for the Interactive Issue run approval dialog.
- **Scope:** Restore the hook and apply safe post-merge cleanup in all run
  modes.

## Intent

Projects need a deterministic way to remove issue-scoped services, containers,
databases, and seeded data after a merge. Removing a worktree alone cannot
remove those resources. The skills-first refactor removed `cleanupHook` and made
existing project configuration invalid.

Cleanup also depends on an interactive Review wait today. A non-interactive run,
or an interactive run that quits before merge, leaves the workspace behind. An
issue normally closes after merge, so ordinary open-issue selection cannot
provide a later cleanup trigger.

## Evidence and constraints

- `src/config/config.ts` rejects the top-level hook key.
- `src/kernel/review-wait.ts` calls cleanup only after an interactive continue
  observes a merged implementation PR.
- `src/kernel/run-once.ts` guards both Review wait entries with `deps.human`.
- `src/kernel/merged-cleanup.ts` already removes implementation, spec, and plan
  worktrees and local branches. It preserves dirty worktrees.
- `src/kernel/pull-request.ts` selects PRs by the branch and push repository. An
  open replacement takes precedence over an older merged PR.
- `src/kernel/issue-selection.ts` excludes closed issues before claiming.
- `src/cli/commands/run-once/main.ts` also selects an open issue before it opens
  the interactive console. This entry needs the sweep before that selection.
- The cleanup skill incorrectly describes every stage as one workspace.

This design preserves the permanent OS lock contract in
[the lock revision](2026-10-16-issue-lock-design.md). It also preserves the
separate gated workspaces in
[the planning-gates revision](2026-10-19-planning-merge-gates-design.md).

Frontend design does not apply. This change affects kernel behavior, a manual
skill, and documentation. It introduces no browser interaction or visual layout.

## Goals and exclusions

The change restores string-valued hook configuration without weakening
unknown-key validation. It provides post-merge cleanup without a human Review
wait. Cleanup preserves the verified done outcome, dirty worktrees, and the
issue lock.

The change does not merge PRs, close issues independently, remove remote
branches, or clean up unfinished work automatically. It does not add a CLI
command, coordinator, background timer, or new dependency. It does not use logs
or `result.json` to derive a phase.

## Approaches

| Approach                                  | Benefit                                                                            | Cost                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Sweep local candidates at run start       | Covers unattended runs and abandoned Review waits without another operator action. | Each real run performs bounded local discovery and host checks.                    |
| Cleanup only for an explicit closed issue | Limits cleanup to the named issue.                                                 | The operator must remember another run. Automatic selection still leaks resources. |
| Add a dedicated cleanup command           | Makes the operation explicit and scriptable.                                       | Adds a command and still requires separate scheduling or operator action.          |

**Selected approach:** a run-start sweep, plus immediate cleanup after an
interactive merge confirmation. The issue delegates this trigger choice to the
specification. This selection is the planner's recommendation, pending approval
through the submit dialog.

## Configuration contract

`cleanupHook?: string` is an optional top-level key in `patchmill.config.json`.
Omission means no hook. New default configuration omits the key.

```json
{
  "cleanupHook": "./scripts/cleanup.sh"
}
```

Every non-string value fails with exactly `Invalid type for cleanupHook`. This
includes `null`, booleans, numbers, arrays, and objects. Other unknown keys
still fail with `Unknown config key: <name>`. A string is a script path, not a
shell command. An empty string remains a string and fails during hook execution.

Patchmill runs `bash <cleanupHook>` through `CommandRunner`, without a shell
command string. The path is one argument. The working directory is the issue's
implementation worktree. Relative paths resolve there. Absolute paths are valid.
The script does not need an executable bit. Patchmill supplies no additional
arguments or new environment variables.

## Trigger and candidate discovery

Every non-dry-run `runOneIssue` entry sweeps before workflow synchronization,
issue selection, or claiming. This includes interactive, non-interactive,
explicit-issue, automatic-selection, and `--plan-only` entries. The sweep cleans
only previously merged implementation work. It never treats a planning outcome
as permission to clean up.

The interactive CLI also calls the same sweep before its initial selection.
Otherwise, a closed issue or empty queue prevents entry into the console and
bypasses `runOneIssue`. Later console Issue runs still sweep at their own
`runOneIssue` entry. A matching receipt prevents duplicate hook execution.

A dry run skips the sweep entirely. It writes no cleanup log, receipt, or lock.
If the caller's abort signal is already set, the sweep starts no cleanup.

Discovery uses local branches and Git's registered worktrees, not remote branch
survival or the list of open issues. Group canonical `agent/issue-N...` local
branches by positive issue number. Exclude the exact `--spec` and `--plan`
branches when selecting the implementation branch. Several implementation
branches make that issue ambiguous. Report and skip it.

When only planning branches remain after partial cleanup, a valid cleanup
receipt can supply the implementation branch identity. A planning-only issue
without such a receipt is not a candidate. Discovery never creates a worktree,
fetches an issue branch to recreate it, or removes an arbitrary directory.

The sweep visits each issue once, in issue-number order. It acquires that
issue's existing permanent OS lock with `acquireLock`. Contention skips that
issue without waiting or mutation. Release occurs in `finally` before visiting
another issue. No operation holds two issue locks.

The sweep still runs when normal selection later returns no work or refuses an
explicit closed issue. That later result keeps its existing meaning. Cleanup
warnings do not prevent selection of unrelated work.

## Authorization under the lock

Both sweep cleanup and in-attempt cleanup use one routine. The latter receives
the already-held issue lock and never reacquires it.

Before hook execution or removal, the routine reads fresh host and local facts.
All of these conditions must hold:

1. The issue belongs to the configured repository and its host state is closed.
2. The selected branch is an implementation branch for that issue.
3. `findPullRequest` selects a PR from the configured push repository with that
   exact head branch. An open replacement blocks an older merged PR.
4. The selected PR state is `merged` and its target is the resolved base branch.
5. `closesIssue` finds a closing reference to this issue in that repository.
6. The local targets agree with Git registration and the configured worktree
   paths. No target is the primary checkout or an ancestor of the lock
   directory.

Base resolution uses the existing order: `git.baseBranch`, remote default
branch, then the host default branch. A merged PR with an open issue waits for
host closure. Patchmill does not add a separate issue-close operation.

An unmerged, closed-unmerged, wrong-target, wrong-head-repository, or
non-closing PR never authorizes cleanup. A merged planning PR never authorizes
cleanup. A receipt alone never authorizes cleanup. Missing host facts and
mismatched worktree registration preserve the affected workspace and produce a
warning.

## Hook, receipt, and removal order

The routine first discovers and verifies its targets without changing them. If
no local cleanup target remains, it returns without a hook.

For an eligible issue, the order is:

1. Open the issue cleanup log and record the attempt.
2. Read and validate the cleanup receipt, if present.
3. Unless a matching receipt proves prior hook success, run the configured hook.
4. After hook success, atomically write the success receipt before any removal.
   An absent hook also permits this receipt.
5. Reread Git registration and inspect each worktree's dirtiness after the hook.
6. Remove clean registered worktrees, then their local branches.
7. Record and report removals, retained targets, and errors.

The hook runs before **any** implementation or planning worktree or branch
removal. It runs even when the implementation worktree starts dirty. A worktree
that remains dirty after the hook stays registered, with its branch. Patchmill
reports its absolute path and the reason. The hook can remove its own generated
files, so the post-hook status determines whether removal is safe.

Cleanup covers the implementation workspace and the exact optional
`agent/issue-N--spec` and `agent/issue-N--plan` workspaces. Ungated documents
share the implementation workspace. Each dirty planning workspace stays,
independently of clean siblings. Git removal uses no force. Local branch
deletion retains the existing post-merge behavior, including squash merges.
Remote branches remain.

Git registration must match the expected path and branch. If a branch is checked
out elsewhere, cleanup keeps it and reports the mismatch. It never substitutes
that other checkout as a removal target. The routine must also preserve a target
that contains the current process working directory. Containment checks compare
filesystem real paths, including the lock parent, so symlinks cannot bypass
them. A target that contains another registered checkout also stays, even when
Git ignores the nested directory. Apply this guard before and after the hook.

## Repeat attempts and the success receipt

Store one versioned receipt at `<runsDir>/issue-N/cleanup.json`. It identifies
the issue repository, push repository, issue number, implementation branch, base
branch, and merged PR number. It records successful hook completion, or that no
hook was configured. It contains no deletion paths or workflow phase.

A matching receipt skips the hook on later cleanup attempts. This covers dirty
worktrees, failed Git removals, and remaining planning branches after the
implementation worktree disappears. A later configuration change does not rerun
an already successful hook for the same merge. Omission also completes the hook
step for that merge. Adding a hook later does not repeat that completed step. A
manual rerun remains an explicit operator action.

A corrupt, unsupported, or identity-mismatched receipt stops cleanup for that
issue and produces a warning. Patchmill does not guess, overwrite it, or rerun a
hook from uncertain state. A receipt write failure preserves all targets. An
implementation worktree that is absent without a matching receipt cannot supply
a configured hook's working directory. Keep the remaining targets and report
that manual inspection is required. Without a hook, branch-only cleanup can
proceed after the same merge checks.

A failed hook creates no success receipt. A later real run can retry it. There
is no exactly-once guarantee for external side effects if the process dies
between hook success and receipt publication. No successful cleanup occurred in
that window. Hook scripts must therefore be idempotent.

The receipt is a narrow exception to output-only local records. It prevents
repeated hook effects and supports partial cleanup. It never selects a workflow
phase, establishes lock ownership, or replaces fresh host verification. Keep it
with the run artifacts after cleanup. Fully removed issues have no local branch
candidates, so the sweep does not repeatedly visit completed cleanup.

## Failures, logs, and outcomes

A non-zero exit, command-start error, thrown runner error, or interrupted hook
stops removal for the whole issue. All worktrees and branches remain. Cleanup
errors never change a verified done outcome or relabel the issue as needs-info.
Planning, needs-info, failed, aborted, and retryable outcomes do not enter
in-attempt cleanup. A sweep concerns earlier completed merges, not those
outcomes.

Append hook stdout, stderr, exit status, identity, and cleanup diagnostics to
`<runsDir>/issue-N/cleanup.log`. Record immediate in-attempt diagnostics in the
current run's `pi.log` too. Show the operator a concise warning and the cleanup
log path through `deps.output.stderr`. Interactive output already routes to the
human channel. Never require `deps.human` in the cleanup routine.

If the cleanup log cannot be opened, preserve targets and report the error. If
logging or receipt publication fails before removal, preserve all targets. If
logging fails during removal, stop further removal and keep remaining targets.
Report any targets already removed. Patchmill cannot restore them automatically.
A filesystem error can prevent durable logging. The console must disclose that
error rather than claim that the failure was recorded.

Git errors preserve the failed target and its branch. Cleanup can continue with
independent sibling targets. A successful receipt remains valid for retries.
Cleanup never removes or replaces the permanent lock file or its parent,
including after failures or a crash. It never removes run logs or session files.

## Interactive compatibility

The ready implementation PR still receives done status before the Review wait.
Continue still refreshes PR facts. An open PR waits again. A changed or invalid
PR follows the existing needs-info behavior. Quit publishes no duplicate stop.

Move cleanup out of `reviewWait` into run finalization under the existing lock.
A successful interactive merge confirmation still cleans up before returning.
Non-interactive finalization can use the same path when it observes a merge. If
the operator quits before merge, the next real run's sweep provides cleanup.
Neither path runs the hook twice after a recorded success.

## Manual skill and documentation

Update `skills/patchmill-cleanup/SKILL.md` to distinguish the implementation
workspace from optional gated spec and plan workspaces. Inspect every proposed
target. Keep explicit confirmation, loss reporting, and lock ownership
requirements. Do not require or invent a separate workspace when ungated
documents share one.

Before manual removal, offer to run the configured hook from the implementation
worktree. Show its path and request explicit consent. Hold the same issue lock
through the hook, a fresh status inspection, and confirmed removal. A hook
failure keeps all targets. A missing implementation directory requires
inspection, not a substitute working directory. Declining the hook does not
imply consent to remove external resources. Automatic merge restrictions do not
replace the skill's existing confirmation rules for manual removal of unfinished
work.

Document the configuration and lifecycle in the site configuration, Run-once,
workflow lifecycle, Git safety, environment reference, and interactive skills
pages. All pages must describe the sweep, immediate interactive behavior,
receipt, dirty-worktree rule, failure preservation, and permanent lock boundary
where relevant.

Recommend hook scripts that:

- Are idempotent.
- Touch only resources scoped to the issue or its worktree.
- Tolerate resources that are already absent.
- Exit non-zero when resource cleanup is incomplete.
- Never remove Patchmill worktrees, branches, PRs, run state, or lock files.

## Verification and acceptance

| Requirement                                            | Evidence                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Configuration accepts the hook and rejects wrong types | Parser and file-loader tests with exact errors and unknown-key coverage.                     |
| Hook uses Bash and the implementation directory        | Real Git and Bash fixtures with a non-executable relative script and a path with spaces.     |
| Hook precedes every removal, including dirty targets   | Command ordering and post-hook status assertions.                                            |
| All modes find closed merged issues                    | Run-start integration tests, including no eligible issue and quit-before-merge.              |
| Wrong PRs never authorize cleanup                      | Merged/open/closed, target, repository, closing-reference, and planning-only negative cases. |
| Hook failure preserves done and every target           | Exit, thrown-error, and cancellation cases with console and log assertions.                  |
| Retries do not repeat a successful hook                | Dirty-worktree, partial-removal, and repeated-sweep tests with a side-effect counter.        |
| Lock ownership lasts through the hook and removal      | Real lock contention checks plus stable lock and parent inode assertions.                    |
| Documentation agrees with the code                     | Direct inspection, formatting, Markdown lint, and packed skill installation.                 |

Do not add tests that assert documentation sentences. Use behavior tests for the
kernel contracts. No frontend evidence or mockup is required.
