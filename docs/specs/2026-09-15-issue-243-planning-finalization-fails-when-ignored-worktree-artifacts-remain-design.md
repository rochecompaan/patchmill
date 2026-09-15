# Recoverable cleanup-pending finalization for ignored phase-workspace artifacts

- **Issue:** #243
- **Status:** Proposed design

## Summary

When an owned phase workspace is clean in ordinary Git status but still contains
ignored files, Patchmill will preserve the workspace and record an explicit
`cleanup-pending` checkpoint instead of throwing `dirty-worktree`. The Run
attempt will return an exit-zero, warning-level `cleanup-pending` result that
identifies the pull request, worktree, and every blocking ignored path. It will
also move the issue to `needs-info` so unattended selection does not repeatedly
retry a cleanup that requires operator action.

The destructive boundary remains fail-closed. Patchmill will not force-remove,
clean, reset, copy, interpret, or silently delete ignored content. Tracked,
staged, and ordinary untracked changes remain unsafe conflicts. After an
operator preserves or removes the reported ignored paths and acknowledges the
retry with the ready label, the next Run attempt resumes from the durable
checkpoint, skips the already completed cleanup hook and handoff effects, and
finishes worktree, branch, and label cleanup.

## Context

The `planning-pr-v1` finish path checkpoints each external effect. For an
implementation pull request it records `cleanupHookCompleted: true` before
calling `PlanningWorkspaceCleanupGit.removeWorktree()`. Issue #241 correctly
made destructive removal inspect ignored content in addition to ordinary Git
status, but the low-level boolean check maps expected ignored agent,
environment, and build state to the generic `dirty-worktree` exception.

That exception bypasses the planning outcome model. The Issue run remains at
`pull-request-open`, workspace cleanup remains `ready`, and each later Run
attempt skips the checkpointed hook before failing at the same removal call. The
implementation and pull request are valid, but the Run attempt is reported as an
unexpected failure without the paths an operator must handle.

Issue #211 established the governing safety rule: ignored content may remain for
a verified in-place resume, but an operation that removes or replaces the phase
workspace must preserve it or refuse. This design keeps that rule and gives the
refusal a durable, recoverable workflow representation.

## Goals

- Preserve unknown ignored content whenever Patchmill cannot prove it is safe to
  delete.
- Give every phase-workspace removal a typed, actionable `cleanup-pending`
  outcome rather than a generic dirty-worktree failure caused only by ignored
  entries.
- Keep ordinary tracked, staged, and untracked changes as hard blockers to
  destructive cleanup.
- Preserve validated implementation and pull-request evidence while cleanup is
  pending.
- Make retry from both `cleanupHookCompleted: true` plus `ready` cleanup and an
  existing `cleanup-pending` checkpoint deterministic and idempotent.
- Prevent unattended Run attempts from looping while operator cleanup is still
  required.
- Complete through the existing `pr-created` result once the workspace and
  branch are safely removed.

## Non-goals

This issue will not:

- force-remove a worktree or run `git clean`, reset, stash, or filesystem
  deletion;
- classify ignored paths as disposable by name, including `.pi/`, `.env`, build,
  or test-output paths;
- add a configurable deletion allowlist;
- read, hash, archive, copy, or upload ignored file contents;
- change the cleanup hook's command, working directory, success contract, or
  idempotence requirements;
- rerun a successfully checkpointed cleanup hook merely because Git cleanup is
  pending;
- relax workspace ownership, head-OID, remote-head, or branch-deletion checks;
  or
- mark an implementation phase complete or apply the done label while its local
  workspace cleanup is pending.

## Approaches considered

### Durable cleanup-pending state (chosen)

Separate ordinary cleanliness from ignored-path inventory. If only ignored
entries prevent removal, persist them as a recoverable workspace cleanup state
and return a dedicated nonfailure result. A retry re-inspects the same owned
workspace and either refreshes the diagnostic or continues cleanup when the
blockers are gone.

This approach preserves every unknown byte, fits the existing checkpointed
finish model, and makes operator action explicit without inventing a second
artifact-storage protocol.

### Delete recognized generated paths

Patchmill could allowlist agent directories, environment files, and common build
outputs. This is rejected because ignored names do not prove disposability.
`.env`, tool state, and repository-specific output may contain unique or
sensitive data, and an allowlist would weaken the invariant established by
issues #240 and #241.

### Quarantine or copy the entire workspace

Patchmill could move or copy the worktree before detaching it. This is rejected
for this issue because it requires a new durable storage lifecycle, capacity and
expiry policy, special-file behavior, race handling, and an operator command to
finish disposal. An explicit pending state provides the required safe terminal
Run-attempt path without taking ownership of arbitrary ignored data.

## Proposed design

### Removal assessment and ignored-path inventory

Replace the cleanup layer's `contentSafeToRemove(): boolean` decision with a
typed removal result. `PlanningWorkspaceRepositoryGit` will continue to read
ordinary status without ignored entries for normal workspace inspection. Before
removal, it will separately run the existing complete status command with
`--ignored=matching` and parse its NUL-delimited porcelain output into
repository-relative ignored paths.

`PlanningWorkspaceCleanupGit.removeWorktree()` will still verify saved
ownership, registration, path, and head OID before considering deletion. Its
outcome will distinguish:

- `removed`, carrying the existing branch-only or missing snapshot; and
- `cleanup-pending`, carrying `reason: "ignored-worktree-content"` and the
  ignored path inventory.

An ordinary-dirty snapshot continues to throw
`PlanningWorkspaceConflictError("dirty-worktree")`. A non-empty ignored
inventory returns `cleanup-pending` before `git worktree remove` is invoked. All
other command, registration, identity, and OID failures retain their current
fail-closed behavior.

The parser will preserve Git path spelling, deduplicate deterministically, and
handle whitespace and newline characters through the `-z` format. Diagnostics
must escape control characters when rendered. Patchmill records path names only;
it does not inspect file contents.

### Durable workspace cleanup state

Extend `PlanningWorkspaceCleanup` with:

```ts
{
  state: "cleanup-pending";
  reason: "ignored-worktree-content";
  ignoredPaths: readonly string[];
}
```

The legal cleanup transitions become:

```text
ready -> cleanup-pending
cleanup-pending -> cleanup-pending
ready -> worktree-removed -> removed
cleanup-pending -> worktree-removed -> removed
```

A same-state replacement may update the path inventory after a fresh inspection,
but it may not change workspace identity, head evidence, or the reason. Cleanup
never regresses from `worktree-removed` or `removed`, and phase completion still
requires `removed`.

The state codec and validator will accept the new discriminator and reject an
empty, duplicate, malformed, or non-string ignored-path inventory. Existing
`ready`, `worktree-removed`, and `removed` state remains valid without migration
or a workflow-version change.

The state is generic to phase workspaces so spec, plan, and implementation
cleanup share one safety model. Implementation finalization is the required
regression path; planning pull-request cleanup will use the same typed outcome
rather than reintroducing a generic exception at another caller.

### Finish and retry flow

For an implementation phase, finalization remains ordered as follows:

1. Validate and durably retain the implementation pull request.
2. Complete and checkpoint cost publication handling, visual-evidence
   validation, and handoff publication.
3. Run the configured cleanup hook once and checkpoint
   `cleanupHookCompleted: true`.
4. Assess owned worktree removal.
5. If ignored paths remain, checkpoint `cleanup-pending` and stop before
   worktree removal, branch removal, or done-label effects.
6. Otherwise checkpoint `worktree-removed`, remove the verified local branch,
   checkpoint `removed`, apply done labels, and complete with `pr-created` as
   today.

A Run attempt starting from `cleanupHookCompleted: true` and cleanup `ready`
performs step 4 directly. A Run attempt starting from `cleanup-pending` also
performs a fresh assessment directly. It does not repeat cost, visual evidence,
handoff, or cleanup-hook effects.

If the ignored inventory is unchanged, the existing durable checkpoint is
returned without an unnecessary state revision. If it changed, the checkpoint is
replaced with the new complete inventory. If no ignored paths remain, cleanup
advances directly to `worktree-removed`; no intermediate regression to `ready`
is needed. Existing idempotence also permits recovery when an operator has
already removed the exact worktree or branch.

The spec/plan cleanup helper will propagate the same `cleanup-pending` outcome
to the phase runner. A planning pull request remains valid and reviewable while
its local cleanup awaits operator action.

### Public result and lifecycle behavior

Add a pipeline-owned result status with this redirected JSON shape:

```ts
{
  status: "cleanup-pending";
  issueNumber: number;
  phase: "spec" | "plan" | "implementation";
  prUrl: string;
  branch: string;
  worktreePath: string;
  reason: "ignored-worktree-content";
  ignoredPaths: string[];
  remediation: string[];
  specPath?: string;
  planPath?: string;
  commits?: string[];
  validation?: string[];
}
```

Implementation results retain the validated pull-request URL, commits, and
validation evidence so the output does not imply that implementation failed. The
remediation tells the operator to inspect and preserve or remove the listed
paths, apply the configured ready label, and rerun `run-once` for the same
issue. It must not suggest force removal.

`cleanup-pending` is a warning-level, exit-zero result, analogous to
`review-pending`: the Run attempt reached an expected resumable boundary rather
than failing, but the Issue run is not complete. Interactive output gets a
“Cleanup pending” section with the worktree, safely escaped ignored paths, and
remediation. Redirected JSON and the final run-log event carry the same data.

The planning pipeline will post an idempotent cleanup-pending issue comment,
apply `needs-info`, and remove `ready` and `in-progress`. This prevents
automatic selection from spinning on unchanged local state. After the operator
handles the paths and applies `ready`, existing active-planning eligibility
reclaims the Issue run and resumes its durable phase. Completion removes the
blocker label through the existing done-label transition.

### Failure semantics

Only the specific “ordinary-clean with ignored inventory” result becomes
`cleanup-pending`. In particular:

- tracked, staged, or ordinary untracked status remains `dirty-worktree` and no
  destructive command runs;
- changed ownership, registration, local head, remote head, or path state keeps
  its existing conflict or error;
- failure to persist `cleanup-pending` is an error, but the worktree remains
  untouched;
- failure to publish the cleanup-pending comment or labels occurs after the
  durable checkpoint and is safe to retry; and
- no pending outcome permits local branch deletion or phase completion.

## Affected components

- `src/git/planning-workspace-inspection.ts` — expose a structured ignored-path
  inventory from NUL-delimited porcelain instead of a removal-safety boolean.
- `src/git/planning-workspace-cleanup.ts`, `src/git/planning-workspace-git.ts`,
  and `src/git/planning-workspaces.ts` — model typed removal and pending
  outcomes while retaining strict destructive guards.
- `src/workflow/planning-state-types.ts`, codecs, validation, transitions, and
  state tests — persist and constrain the new cleanup discriminator.
- `src/cli/commands/run-once/planning-finish.ts` and `planning-phase-cleanup.ts`
  — checkpoint pending cleanup and resume it without replaying completed
  effects.
- Planning phase runner, coordinator, pipeline, lifecycle-label, and comment
  modules — propagate the pending outcome and apply the recoverable operator
  boundary.
- Run-once pipeline result types, summary, exit-code, and terminal rendering
  modules — expose the warning-level public result.
- `site/src/content/docs/using-patchmill/run-once.md` and
  lifecycle/configuration guidance — document the hook/workspace boundary,
  pending output, and safe retry procedure.

No dependency or configuration-schema change is planned.

## Verification strategy

These automated tests pass the Testing Value Gate because they protect a
regression in durable retry behavior and a destructive data-loss boundary.

### Git cleanup tests

Using a real repository and owned worktree, verify that:

- ordinary-clean ignored files and directories produce `cleanup-pending` with
  exact representative `.pi/`, `.env`, build, and test-output paths;
- the files remain byte-identical and no worktree-removal command runs;
- an unknown ignored path receives the same treatment as familiar workflow
  paths;
- tracked, staged, and ordinary untracked changes still produce `dirty-worktree`
  and no removal;
- clearing the ignored paths lets the same pending ownership remove the
  worktree; and
- already-removed worktree and branch states remain idempotent.

### State and finish tests

Cover codec round trips and legal transitions for `ready -> cleanup-pending`,
pending inventory refresh, and `cleanup-pending -> worktree-removed -> removed`.
Reject skipped cleanup, empty inventories, evidence changes, and completion from
pending state.

Add a focused implementation-finish regression where the cleanup hook succeeds,
its checkpoint is persisted, and ignored content makes removal pending. Assert
that the result retains PR evidence, no done-label effect runs, and the durable
phase remains `pull-request-open/cleanup-pending`. Resume from both the reported
intermediate checkpoint (`cleanupHookCompleted: true` with cleanup `ready`) and
the new pending checkpoint. After the blockers are cleared, assert that the hook
and earlier finish effects are not repeated and the result becomes `pr-created`.

Also cover a spec or plan planning-pull-request cleanup so the generic workspace
contract cannot regress at that caller.

### Pipeline and output tests

Exercise a successful implementation pull request with all required validation,
a successful cleanup hook, and representative ignored artifacts. Verify:

- `cleanup-pending` is returned with exit code `0` and warning severity;
- JSON, terminal output, run log, and issue comment identify the exact worktree
  and ignored paths without unsafe remediation;
- the issue moves to `needs-info` and is not automatically selected again;
- ready-label acknowledgment permits retry;
- a retry after removing the blockers completes as `pr-created`, applies done
  labels, and invokes the cleanup hook only once; and
- ordinary dirty state still takes the existing failure path.

Implementation verification should run the focused Git, state, finish, pipeline,
result, and terminal tests, followed by:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run site:build
```

No Nix build is required unless implementation unexpectedly changes
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.

## Acceptance mapping

| Acceptance criterion                                        | Design response                                                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Successful implementation has a supported finalization path | `cleanup-pending` is an exit-zero resumable result that retains the validated PR and can later complete as `pr-created`.            |
| Unknown ignored content is not silently deleted             | Any ignored inventory stops before worktree removal; policy is path-agnostic and never force-cleans.                                |
| Ordinary changes still block cleanup                        | Ordinary status remains the existing hard `dirty-worktree` conflict.                                                                |
| Hook/removal checkpoints are retry-safe                     | Pending state is durable; retries skip the checkpointed hook, re-inspect, and advance after blockers are cleared.                   |
| Operator diagnostics are actionable                         | Result, terminal output, run log, and issue comment include the exact worktree, ignored paths, and safe remediation.                |
| Regression and intermediate-checkpoint coverage             | Real-Git, state-transition, finish, and pipeline tests cover initial detection and retries from both `ready` and `cleanup-pending`. |
