# Run-once recovery and reset design

- **Issue:** #183
- **Status:** Proposed design

## Summary

Patchmill will recover a blocked Issue run after explicit human acknowledgment.
The `agent-ready` label is this acknowledgment. Patchmill will not parse
free-form comments as a control signal.

An explicit `patchmill run-once --issue N` command will inspect blocked Run
recovery state. Patchmill will resume a verified clean workspace, including a
workspace with committed partial work. It will refresh only a clean,
zero-ahead branch with no ignored content. The refresh will pin the base commit
and preserve the old checkout in a quarantine.

A new `patchmill run reset --issue N` command will support safe reset for any
saved Run recovery state. The command will archive diagnostics, evacuate the
old workspace into a quarantine, and immediately start a normal Run attempt.

Dirty or ignored worktree content will block recovery. Unique issue commits
will block destructive reset, but retry will preserve and resume them.
Patchmill will not provide a force option that bypasses these protections.

## Context

A blocked Issue run moves the issue to `needs-info` and keeps its Run recovery
state. A human can answer the questions and restore `agent-ready`.

The current explicit retry still stops when local blocked state exists. The
pipeline accepts only the `recoverable-clean` recovery classification.

`inspectBlockedRunRecovery()` also classifies every ancestor branch as
`already-merged`. This result includes a stale branch with `ahead = 0` and no
issue commits. The report can therefore describe empty workspace state as
landed work.

Patchmill has no supported reset command. Current guidance tells the operator
to clean or finalize state manually under `.patchmill/runs`.

## Domain terms

This design uses the domain terms in `CONTEXT.md`:

- An **Issue run** is one issue-processing lifecycle across resumptions.
- A **Run attempt** is one process entry into the run-once workflow.
- **Run recovery state** is the durable checkpoint for one run-once workflow.

A retry starts a new Run attempt for the same Issue run. A reset archives old
Run recovery state before the normal pipeline writes fresh Run recovery state.

## Goals

- Use `agent-ready` as the explicit human acknowledgment for blocked recovery.
- Require `patchmill run-once --issue N` for explicit blocked retry.
- Resume a verified clean workspace and preserve its unique issue commits.
- Refresh a clean, stale issue branch to one pinned current-base commit.
- Preserve the old checkout before a refresh or reset detaches its branch.
- Inventory ignored content before any refresh or reset cleanup.
- Use current-base content only after a safe zero-ahead refresh.
- Resume commit-bearing branches at their existing commit without an automatic base update.
- Clear the old blocker reason and obsolete blocker questions.
- Preserve valid checkpoints and artifact references during retry.
- Prevent duplicate start and blocker comments.
- Support safe reset for every valid saved Run recovery status.
- Archive diagnostic state before reset quarantine and ref updates.
- Evacuate the expected checkout and retain it as a detached quarantine.
- Delete only the expected zero-unique-commit branch OID.
- Continue into the normal run-once pipeline after reset.
- Fence active state that predates the Issue run lease protocol.
- Provide an operator-assisted repair path for abandoned remote leases.
- Refuse recovery when Patchmill cannot prove that recovery is safe.

## Non-goals

This issue will not:

- parse issue comments as control input
- add a retry command or retry flag
- add a force option for destructive cleanup
- clean, stash, commit, or archive dirty workspace changes
- remove or rewrite unmerged issue commits
- automatically erase a quarantined recovery workspace
- infer remote process death from elapsed time or local process information
- change issue labels during reset preflight or reset cleanup
- add a new persisted Run recovery status
- add selectable reset depths
- create an Event ledger or a new coordinator state machine
- change host workflow approval policy

## Approaches considered

### Central recovery decision module (chosen)

One recovery module will assess saved state and return a typed recovery action.
Both retry and reset will use this interface.

The module will contain focused internal modules for policy, Git inspection,
lease ownership, archival, and mutation. CLI and pipeline callers will not
reimplement recovery safety rules.

This approach gives one safety policy with a small caller interface. It also
keeps recovery changes out of the already large pipeline module.

### Extend the existing blocked-recovery path

This approach would add more classifications to `recovery.ts` and add a
separate reset implementation. It has a smaller initial diff.

The existing interfaces are specific to blocked state. General reset would
spread policy across the CLI, recovery code, and pipeline. This approach is
rejected because it duplicates destructive safety decisions.

### Add a formal Run-attempt state machine

This approach would add Run attempt identifiers, generations, and conditional
state writes. It gives a stronger general concurrency model.

The approach changes the persisted schema and most state writers. Issue #183
does not require that larger lifecycle change, so this approach is rejected.

## Architecture

Recovery is an orchestration layer before pipeline execution:

```text
CLI intent
  -> normal issue eligibility preflight
  -> acquire Issue run lease
  -> assess saved state and workspace
  -> execute the permitted recovery action
  -> enter the existing run-once pipeline
```

The external recovery interface accepts a retry or reset intent. It returns one
of these typed decisions:

- resume in the existing workspace
- refresh a zero-ahead checkout and resume
- recreate a worktree around a preserved branch and resume
- archive, reset, and start normally
- refuse with repair guidance

The assessment records these facts:

- the saved status and blocker details
- the branch and worktree identity
- worktree existence, registration, and cleanliness
- ignored files and directories in the worktree
- divergence from the current base
- unique commits from `baseRef..issueBranch`
- valid specification and plan references
- live Issue run lease ownership
- lease-protocol or legacy-fence evidence for active saved state

The decision policy consumes this assessment. CLI formatting consumes the same
assessment and decision. Git mutation does not occur during assessment.

## Issue run lease

Every real Run attempt will use one lease for each issue. The lease will live
under the configured run-state directory:

```text
locks/issue-N.lock
```

The lease record will contain a format version, issue number, process ID, host
name, owner token, and acquisition time. Creation will use an exclusive
filesystem operation.

Every lease acquisition, stale takeover, and release will first acquire this
short-lived transaction guard:

```text
locks/issue-N.lease-guard
```

The guard will use exclusive creation and an owner token. Patchmill will hold it
from before the first lease observation until the lease transition is complete.
A competing process cannot observe and rename the canonical lease while
another transition is in progress.

A guard conflict will refuse the transition. Patchmill will not automatically
replace a guard, even when its recorded local process is dead. This rule avoids
recursive stale-lock takeover races. Operator-assisted repair can quarantine an
abandoned guard by exact fingerprint.

A process on the same host is active when its process ID is alive. A dead
process ID makes the lease stale. While it owns the transaction guard,
Patchmill can archive the observed stale lease and create a replacement.

Patchmill will treat a lease from another host as active. It cannot prove
remote process death from local process information. Age alone will never make
a lease stale.

Only the process with the matching owner token can remove a lease or guard.
Patchmill will hold the Issue run lease through recovery and the complete Run
attempt. It will use the transaction guard again when it releases that lease.

An explicit issue command knows the lease key before selection. Automatic
selection will acquire the lease after selection and re-read state before
mutation.

Each state write from a leased Run attempt will set `leaseProtocolVersion = 1`.
This marker proves that the writer participates in the lease protocol. It is
not a persisted status or a substitute for the live lease.

Saved `claimed`, `planning`, or `implementing` state without this marker is
legacy active state. Automatic retry, resume, and reset will refuse that state
as `legacy-active-unfenced`. This rule prevents a new process from racing an
older Patchmill process that does not create leases.

After exact-fence validation, an ordinary resume will atomically add the marker
before any pipeline effect. This adoption write will compare the exact state
bytes and preserve all other fields. Reset will keep the exact legacy bytes
until the normal fresh claim replaces them.

### Operator-assisted lease repair

Patchmill will provide this inspection command:

```text
patchmill run lease repair --issue N
```

The command will not repair anything without a confirmation fingerprint. It
will print one of these commands after it reads the exact lease or state bytes:

```text
patchmill run lease repair --issue N --expect-lease-sha256 HASH --confirm-owner-stopped
patchmill run lease repair --issue N --expect-guard-sha256 HASH --confirm-all-runners-stopped
patchmill run lease repair --issue N --expect-state-sha256 HASH --confirm-all-runners-stopped
```

The operator must stop the recorded remote owner before the first command. The
operator must stop every Patchmill process that can use the run-state directory
before guard repair. The same requirement applies to legacy-state repair.

The confirmed command will acquire `locks/issue-N.repair.lock` with exclusive
creation. Normal lease acquisition will refuse while this repair lock exists.
Lease repair will then acquire the transaction guard. Guard repair targets the
guard itself, so it requires every runner to be stopped. The command will
re-read the source bytes and compare their SHA-256 value with the supplied
fingerprint.

For an abandoned lease or guard, Patchmill will atomically move the exact file
to a lease archive. Remote lease repair will also hold the transaction guard.
For legacy active state, Patchmill will write a migration fence that contains
the exact state hash and status. The fence is valid only while the active state
bytes remain unchanged.

A changed fingerprint will stop repair without changing the lease or fence.
Repair will not inspect or mutate the worktree, issue labels, comments, or Run
recovery state. It will not automatically take ownership from another host.

## Recovery assessment

Patchmill will resolve and record the exact `baseOid` and `branchOid` before it
makes a decision. It will use those object IDs, Git divergence, and the actual
commit list. A later mutation will not dereference a moving base name.

A branch has unique issue commits when `baseRef..issueBranch` is non-empty. A
saved `commits` list is loss evidence only when the branch no longer exists.

Patchmill will gather ordinary status and ignored-content status separately. It
will use these commands in the registered worktree:

```text
git status --porcelain=v1 --untracked-files=all
git status --porcelain=v1 --untracked-files=all --ignored=matching
```

The second result will inventory every `!!` file or directory. Configured
status exclusions will not hide ignored content from recovery safety checks.

The main classifications are:

| Classification | Evidence | Retry policy | Reset policy |
| --- | --- | --- | --- |
| `resumable-current` | Clean worktree, no ignored content, `ahead = 0`, `behind = 0` | Resume | Reset |
| `resumable-stale-base` | Clean worktree, no ignored content, `ahead = 0`, `behind > 0` | Refresh to pinned base and resume | Reset |
| `resumable-with-commits` | Clean verified branch with actual unique commits | Resume without rewriting commits | Refuse deletion |
| `recreatable-clean` | Expected path is absent and an existing branch can be preserved, or a missing branch has no loss evidence | Recreate and resume | Reset only with zero unique commits |
| `dirty-worktree` | Blocking tracked or untracked Git status exists | Refuse | Refuse |
| `ignored-worktree-content` | One or more ignored files or directories exist | Refuse | Refuse |
| `unmerged-commits` | The branch is missing and saved state records commits | Refuse | Refuse |
| `workspace-unverifiable` | Workspace identity or safety cannot be proved | Refuse | Refuse |
| `legacy-active-unfenced` | Active state predates the lease protocol and has no matching migration fence | Refuse | Refuse |
| `active-run` | Another live or unverifiable owner holds the lease | Refuse | Refuse |

A branch with `ahead = 0` is stale or empty when it is an ancestor of the base.
Reports must not call this branch landed issue work.

Retry will not fast-forward a branch that has unique commits. It will resume the
verified branch at its current commit, even when the current base has advanced.
This rule preserves committed partial work without a merge or rewrite.

A physical path that exists without valid worktree registration is
unverifiable. Patchmill will not remove or reuse that path automatically.

If the expected path is absent, retry can recreate a worktree around an
existing verified branch, including a branch with unique commits. Patchmill can
create a missing branch from the base only when saved state has no loss
evidence.

Reset will continue to refuse every branch with actual unique commits. It will
also refuse a missing branch when saved state records commits.

## Recovery mutation safety

A status check cannot prevent a human or tool from creating content after the
check. Recovery mutations will therefore preserve the old checkout before any
operation can overwrite or remove its files.

Each mutation decision will contain an explicit plan. The plan will include the
expected branch OID, pinned base OID, recreation mode, and unique quarantine
path. The mutation module will not infer these values from mutable state.

Patchmill will not use `git merge` or `git worktree remove` for recovery. For a
stale registered checkout, it will use this sequence:

1. Create a clean detached staging worktree at the pinned base OID.
2. Recheck identity, ordinary status, ignored content, and both pinned OIDs.
3. Move the complete registered checkout to its quarantine path.
4. Recheck the moved checkout and refuse or restore it when new content exists.
5. Detach the quarantined worktree with a compare-and-swap update of its `HEAD`.
6. Advance the issue branch with `git update-ref` and the expected old OID.
7. Recheck the staging worktree for ordinary or ignored content.
8. Attach the staging worktree to that branch without changing its files.
9. Move the staging worktree to the expected path.

The worktree move preserves tracked, untracked, and ignored content that arrives
before or during the move. If the expected path reappears, the final move will
refuse rather than replace a non-empty path. A failed refresh will report every
quarantine and staging path.

Reset will move the complete registered checkout to quarantine, recheck it,
detach its `HEAD` with compare-and-swap, and delete the zero-unique-commit branch
with `git update-ref -d` plus the expected branch OID. It will retain the
detached quarantined worktree. Reset will never recursively erase it.

If the expected path is absent, recreation will update a zero-ahead branch by
OID before it creates the worktree. It will never fast-forward after worktree
creation. A target-path race will refuse without deleting the target content.
Patchmill will recheck the recreated worktree before pipeline effects begin.

These sequences can leave preserved quarantine or staging state after a later
failure. Repair guidance will identify each path. No failure path will trade
human data for automatic rollback.

## Explicit blocked retry

Blocked retry accepts both current and legacy blocked state. Current state has
`status = blocked`. Legacy state has `status = finished`, `blockedAt`, and
`lastError`.

Blocked retry requires all of these conditions:

- the operator invoked `patchmill run-once --issue N`
- the issue is open and has `agent-ready`
- the saved state represents a blocked Issue run
- no live process owns the Issue run lease
- any active legacy state has a matching operator-created migration fence
- the recovery assessment permits resumption

A bare `patchmill run-once` command will not select blocked recovery state.
Free-form comments will not affect this decision.

For `resumable-current`, Patchmill will reuse the saved workspace. For
`resumable-stale-base`, Patchmill will use the quarantine-and-refresh sequence
to advance the branch to the pinned base OID.

For `resumable-with-commits`, Patchmill will reuse the branch without a merge,
reset, or rewrite. For `recreatable-clean`, Patchmill will recreate the
expected worktree around an existing branch when one exists. Patchmill will
not recreate a missing branch when saved state contains loss evidence.

Before execution, Patchmill will clear `lastError` and `blockerQuestions`. The
historical `blockedAt` timestamp can remain for diagnostics.

The normal claim transition will change `agent-ready` to `in-progress` when
execution starts. A refreshed zero-ahead branch will use pinned current-base
content. A commit-bearing retry will use its existing branch content without an
automatic base update. Both modes will use current Patchmill configuration.

### Retry checkpoint rules

Retry preserves monotonic checkpoints because it continues the same Issue run.
Existing artifact resolution will make sure that saved specification and plan
references remain valid.

Effect receipts have an explicit scope. The start-comment receipt applies to
the issue. Failure-comment and blocker-comment receipts apply only to one Issue
run. Retry preserves both scopes because it continues the same Issue run.

`blockerCommentKeys` will contain `blocker-comment:v1:<sha256-hex>` keys for the
exact canonical blocker-comment body. `blockIssue()` will check the key before
it posts. It will persist the key only after the host accepts the comment.

Legacy blocked state has no blocker-comment receipt. Before retry changes
state, Patchmill will compare the canonical comment for the saved reason and
questions with the issue's existing comment bodies. An exact match will create
the corresponding receipt. If no exact match exists, Patchmill will not create
a receipt.

Comment text remains effect evidence only. It will not acknowledge recovery or
change eligibility.

A repaired worktree will complete `worktreeReady` only after repair succeeds.
No comment or label effect will repeat while a valid same-scope receipt exists.

## Reset and immediate Run attempt

The reset command is:

```text
patchmill run reset --issue N
```

The issue number is required. The command will accept normal pipeline options
that apply to the immediate Run attempt. It will reject `--dry-run` because the
design defines no mutation-free reset preview.

Reset can operate on `claimed`, `planning`, `implementing`, `blocked`, or
`finished` Run recovery state. Status does not determine destructive safety.
Workspace, ignored-content, commit, lease, and migration-fence evidence
determine safety. Legacy active state requires a matching migration fence.

Reset will use a reset-aware eligibility helper before and after lease
acquisition. The helper will always require an open issue, normal triage policy,
and required approvals. It will accept these saved-state label combinations:

- `claimed`, `planning`, or `implementing` with `in-progress`
- current or legacy blocked state with `agent-ready`, with `needs-info` allowed
- `finished` with `agent-ready` or `in-progress`

The helper will not call fresh-only `selectIssue()` for these recovery states.
During the later normal claim, Patchmill will remove `agent-ready` and
`needs-info` and add `in-progress` exactly once. Existing `in-progress` is an
idempotent claim, not an eligibility failure.

The command will use this sequence:

1. Reject `--dry-run` before provider, state, lease, or workspace mutation.
2. Load the exact open issue.
3. Apply reset-aware issue eligibility and normal approval rules.
4. Acquire the Issue run lease when no repair lock exists.
5. Re-read the issue and exact Run recovery state bytes.
6. Reapply reset eligibility, lease-protocol, and recovery safety rules.
7. Write the diagnostic archive.
8. Recheck exact state bytes, pinned OIDs, and all workspace evidence.
9. Move the registered checkout to quarantine and detach its `HEAD` by OID.
10. Delete the zero-unique-commit branch with an expected-OID update.
11. Enter the normal issue-specific run-once pipeline.
12. Replace old state during the normal fresh claim write.

Reset will leave issue labels unchanged before normal pipeline execution. The
normal claim transition owns the change from `agent-ready` to `in-progress`.

If normal issue selection cannot start, reset will not archive or clean local
state. This rule prevents a destructive reset before a workflow rejection.

A successful reset does not need a second command. The pipeline will create
fresh `claimed` Run recovery state through its existing lifecycle transition.

## Reset field preservation

The fresh state will retain only validated durable inputs and the issue-scoped
start-comment receipt. An artifact reference is valid only when it resolves
from the pinned current base or an authoritative external source after the
expected workspace path is evacuated.

- `issueNumber` and `title`
- valid `specPath` and `specCommit`
- valid `planPath` and `planCommit`
- `startedCommentPosted`

Reset starts a new Issue run. It will not copy `failureCommentKeys` or
`blockerCommentKeys` from the archived Issue run. A new failure or blocker at
the same stage can therefore post a legitimate comment.

Reset will clear these Issue-run or Run-attempt values:

- branch and worktree references
- ordinary lifecycle checkpoints
- blocker reason and blocker questions
- failure-comment and blocker-comment receipts
- implementation status, commits, validation, and review data
- pull request, merge, landing, cost, and visual-evidence data
- old lifecycle timestamps from the active state
- old lease-protocol ownership data

The fresh claim will set `leaseProtocolVersion = 1` for the new leased Run
attempt. The archive will retain every original field.

## Archive format and transaction order

Reset archives will use this layout under the configured run-state directory:

```text
archive/issue-N/<sortable-timestamp>/
├── run-state.json
└── recovery-assessment.json
```

The timestamp will use an ISO-derived, filesystem-safe UTC form. The archive
will preserve the exact original bytes in `run-state.json`.

The assessment file will record:

- the format version and archive time
- the command and issue number
- the configured base reference
- the recovery classification
- branch divergence and unique commits
- ordinary and ignored-content worktree status
- lease-protocol and migration-fence evidence
- the fields selected for preservation
- the pinned base and branch OIDs
- planned quarantine, detach, ref-update, and recreation actions
- all resulting quarantine and staging paths

Reset will write and finalize the archive before workspace quarantine. Existing
run logs, Pi session logs, and artifacts will remain in their current paths.

The old active state will remain until the normal pipeline writes fresh state.
This order prevents a crash window without active or archived diagnostics.

If a later mutation fails, Patchmill will retain old active state, the archive,
and each quarantine or staging path.

## CLI behavior

`src/cli/main.ts` will add the `run` command family. This issue adds `reset`
and the focused `lease repair` operator command.

The command help will show:

```text
patchmill run reset --issue <number>
patchmill run lease repair --issue <number>
```

`--issue` must contain a positive integer. Reset will not support a force
option. Reset will reject `--dry-run` with a direct no-preview message before
it acquires a lease or mutates state.

If no saved state exists, the command will report that there is nothing to
reset. It will suggest this command:

```text
patchmill run-once --issue N
```

The command will show the archive path, recovery action, and each retained
quarantine path. Redirected output will follow the existing run-once result
contract after execution starts.

## Failure and repair behavior

Patchmill will refuse retry and reset without mutation for these conditions:

- the issue is not open or actionable
- required approvals are absent
- another live or unverifiable process owns the lease
- a lease transaction or lease repair is active
- active legacy state has no matching migration fence
- the worktree is dirty or contains ignored content
- a missing branch has saved commit-loss evidence
- workspace identity cannot be proved

Reset will also refuse when the existing branch has unique issue commits.
Retry will preserve and resume those commits.

Dirty-worktree guidance will identify ordinary and ignored status separately.
The operator must preserve or remove preexisting content before another
recovery command. Content that appears during mutation will remain at a
reported quarantine, staging, or target path.

Unmerged-commit guidance will list the commits. The operator must preserve or
land that work before reset.

Remote lease guidance will show the owner and the inspection form of
`patchmill run lease repair --issue N`. It will not suggest that elapsed time
proves that the owner is dead. Malformed lease records remain unverifiable and
cannot use automatic repair.

An archive error will stop reset before quarantine. A later mutation error will
keep old active state and report completed actions plus every preserved path.

A pipeline error after reset will use normal Run attempt error handling. Its
diagnostics will include reset archive and quarantine paths.

Recovery guidance will recommend reset only when reset can pass. Other unsafe
states will receive a specific repair command or action.

## Affected modules

### CLI dispatch and parsing

- `src/cli/main.ts` will dispatch the `patchmill run` command family.
- A focused `src/cli/commands/run/reset/` module will own reset parsing and output.
- A focused `src/cli/commands/run/lease/` module will own repair inspection and confirmation.
- A filesystem-only run-state configuration loader will avoid Git and provider access for lease repair.
- The reset command will delegate normal execution to the run-once pipeline.

### Recovery facade and policy

- `src/cli/commands/run-once/recovery.ts` will become a narrow recovery facade.
- Focused internal modules will own assessment, policy, lease, and archive work.
- Existing blocked-specific names will become general recovery names where
  callers use general behavior.

### Pipeline integration

- `src/cli/commands/run-once/pipeline.ts` will consume typed recovery decisions.
- `src/cli/commands/run-once/pipeline-selection.ts` will enforce explicit
  blocked selection and expose reset-aware saved-state eligibility.
- `src/cli/commands/run-once/pipeline-workspace.ts` will provide expected
  workspace identity and configured ordinary-status exclusions.
- `src/cli/commands/run-once/pipeline-lifecycle.ts` will preserve valid effects
  and clear obsolete blocker data.
- `src/cli/commands/run-once/pipeline-failures.ts` will persist
  blocker-comment receipts.
- `src/cli/commands/run-once/run-state.ts` will support exact reset replacement,
  lease-protocol markers, blocker receipts, and seed preservation.
- `src/cli/commands/run-once/types.ts` will define recovery decisions and reset
  seed data without adding a new status.

### Tests and fixtures

- `src/cli/commands/run-once/recovery.test.ts` will cover the decision table.
- `src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts` will cover
  retry and reset integration.
- Focused lease, repair, and reset-command tests will cover ownership and CLI behavior.
- `test-support/run-once/pipeline-fixtures.ts` will expose the required fixtures.

The implementation can add focused files when one listed module would exceed
one clear responsibility. It will not add an npm dependency for the lease.

## Verification strategy

These tests pass the Testing Value Gate. They protect destructive behavior,
persisted state, Git operations, workflow transitions, and CLI contracts.

### Recovery assessment tests

Cover these cases:

- clean and current branch
- clean branch that only trails a pinned base OID
- base or branch ref changes after assessment
- zero-ahead ancestor reported as stale or empty
- dirty worktree
- ignored file and ignored directory inventory
- clean branch with unique issue commits
- saved commit loss evidence when the branch is missing
- missing worktree with a preserved commit-bearing branch
- unregistered physical path
- unverifiable workspace identity
- active legacy state with and without an exact migration fence

### Lease tests

Cover these cases:

- one owner acquires and releases the lease
- a second live owner is refused
- a dead same-host owner is replaced while one transaction guard is held
- three competing acquirers cannot rename or replace each other's lease
- an abandoned transaction guard refuses automatic takeover
- another host is refused automatically
- a non-owner cannot release the lease
- a repair lock blocks ordinary lease acquisition
- inspection prints an exact lease or state fingerprint
- confirmed repair refuses a changed fingerprint
- confirmed remote repair quarantines only the expected lease
- confirmed guard repair quarantines only the expected abandoned guard
- confirmed legacy repair writes an exact-state migration fence

### Retry pipeline tests

Prove that explicit blocked retry with `agent-ready`:

- changes `agent-ready` to `in-progress`
- clears the old reason and questions
- preserves valid checkpoints and artifacts
- bootstraps an exact legacy blocker-comment receipt
- prevents duplicate start and same-body blocker comments
- posts a new blocker comment when the body changes
- preserves and resumes clean unique commits without rewriting them
- refreshes a zero-ahead stale branch to the pinned base through quarantine
- preserves ignored content injected after reassessment and before movement
- refuses content injected into staging or the recreated target path
- leaves a commit-bearing branch at its existing base and head OIDs
- uses current-base content only after a safe zero-ahead refresh

Also prove that bare selection and blocked state without `agent-ready` do not
recover.

### Reset tests

Run safe reset from every existing saved status. Prove these results:

- reset-aware eligibility occurs before mutation for each saved-status label matrix
- an existing `in-progress` claim remains idempotent
- archive files exist before quarantine or ref updates
- original state bytes remain exact
- the expected worktree path is evacuated and the branch is deleted by expected OID
- ignored content injected before movement survives in the detached quarantine
- reset never calls recursive worktree removal
- normal pipeline execution starts immediately
- valid artifact references and the start-comment receipt survive
- failure-comment and blocker-comment receipts do not survive
- ordinary checkpoints and attempt data do not survive
- dirty, ignored, or unmerged work blocks all mutation
- active legacy state requires an exact migration fence
- `--dry-run` stops before every mutation
- archive and later mutation errors preserve active diagnostics and all moved paths
- absent state returns the ordinary run-once guidance

### CLI tests

Cover positive issue parsing, nested dispatch, reset `--dry-run` rejection,
lease-repair fingerprints, execution delegation, exit status, and structured
output. Run a real repair command with Git and provider access unavailable. Do
not add tests that only restate help text.

Implementation verification will use focused tests first. It will then use the
complete run-once tests, project tests, lint, and build.

No dependency change is planned. Nix dependency verification is not required
unless implementation changes an npm dependency file.

## Acceptance mapping

| Acceptance criterion | Design response |
| --- | --- |
| Human acknowledgment is explicit | Blocked retry requires `agent-ready` and explicit `run-once --issue N`. |
| Comments are not control input | Comment bodies can prove a posted effect, but they never acknowledge recovery. |
| Clean blocked state resumes | The shared assessment permits current, stale-base, and commit-bearing recovery. |
| Committed partial work survives retry | Retry resumes a verified unique-commit branch without merge, reset, or deletion. |
| Stale empty branch uses current base | Patchmill refreshes only a zero-ahead branch to one pinned base OID. |
| Commit-bearing retry keeps its base | Retry does not promise current-base content without a safe zero-ahead refresh. |
| Ignored work remains protected | Preexisting ignored content refuses mutation. Late content moves into quarantine or blocks publication. |
| Blocker data becomes obsolete | Retry clears `lastError` and `blockerQuestions`. |
| Lifecycle transition is correct | The normal claim path changes `agent-ready` to `in-progress`. |
| Valid progress survives retry | Retry retains valid checkpoints, artifacts, and same-Issue-run receipts. |
| Blocker comments do not duplicate | Exact legacy comments bootstrap versioned body receipts. Future posts persist receipts. |
| Fresh reset comments remain valid | Reset clears Issue-run-scoped failure and blocker receipts. |
| Reset is supported | `patchmill run reset --issue N` archives, cleans, and runs normally. |
| Reset dry-run is unambiguous | `patchmill run reset --dry-run` is rejected before mutation. |
| Reset applies to all saved statuses | Reset-aware label matrices support active, blocked, and finished state. Legacy active state also requires a fence. |
| Diagnostic state survives reset | Exact state bytes and the assessment enter a timestamped archive. |
| Dirty work remains protected | Dirty status refuses retry and reset without force cleanup. |
| Unmerged commits remain protected from deletion | Actual or saved unique commit evidence refuses reset. |
| Empty branches are not called landed | `ahead = 0` ancestor branches are stale or empty. |
| Crashed local runs can recover | A transaction guard serializes dead same-host lease replacement. Abandoned guards require fingerprinted repair. |
| Pre-lease active runs cannot race recovery | Unmarked active state refuses until an exact-state migration fence exists. |
| Abandoned remote leases can recover | Fingerprinted repair quarantines an owner-stopped lease under an exclusive repair lock. |
| Live runs cannot race reset | A live lease owner, lease transaction guard, or active repair lock blocks retry and reset. |
| Recovery never recursively deletes a checkout | Refresh and reset detach a preserved quarantine, then update refs by expected OID. |
| Lease repair is filesystem-only | A focused configuration loader avoids Git and provider initialization. |
