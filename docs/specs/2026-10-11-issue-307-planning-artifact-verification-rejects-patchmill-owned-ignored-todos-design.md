# Ignored content never blocks Patchmill operations

- **Issue:** #307
- **Status:** Proposed design
- **Review context:** Current planning pull request
- **Scope note:** During planning review, the operator widened this issue.
  Ignored content must not block any Patchmill operation. The first version of
  this spec covered only todo metadata during artifact verification.

## Purpose and evidence

A planning agent can commit a plan and create ignored task todos in the same
phase workspace. Patchmill then stops with `status/dirty-workspace`, although
ordinary Git status is empty. `PlanningPublicationGit.assertClean()` reads
status with `--ignored=matching` and rejects every record.

A todo-only exception would not fix the general problem:

- Patchmill's own repository lists `.pi/` in `.git/info/exclude`. Git then
  reports one collapsed `!! .pi/` record instead of `!! .pi/todos/`. A todo-root
  exception cannot prove that this record holds only todos. The issue #262 run
  output already shows this collapsed record.
- Agents, tools and operators create other ignored content before verification.
  Examples: `node_modules/` and `.husky/_/` from `npm ci`, `dist/` and
  `coverage/` from builds and tests, `.devenv/` from direnv,
  `.superpowers/brainstorm/` from skill helpers, and `*.log` from a global
  ignore file.
- Issues #240, #243 and #262 each removed one ignored-content blocker. Others
  remain.

Patchmill already uses only ordinary status for planning workspace cleanliness
(`PlanningWorkspaceRepositoryGit.clean()`) and for final phase cleanup (#262).
These places still treat ignored content as a blocker:

| Place                                                                                              | Current behavior                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/git/planning-publication-git.ts`, `assertClean()`                                             | `verifyArtifactCommit()` and `verifyWorkspace()` reject any ignored record.                                                                                          |
| `src/cli/commands/run-once/recovery-policy.ts`, `decideRunRecovery()`                              | Refresh, recreate and reset refuse with `ignored-worktree-content` when the worktree holds ignored entries. This refusal also applies to `patchmill run reset`.      |
| `src/cli/commands/run-once/recovery-assessment.ts`, `assessRunRecovery()`                          | A failed ignored-status read stops recovery with "cannot inspect ignored worktree status".                                                                           |
| `src/cli/commands/run-once/recovery-mutation-helpers.ts`, `assertRecoveryWorkspaceUnchanged()`     | A late ignored file in a quarantine, staging or published worktree aborts the mutation.                                                                              |
| `src/cli/commands/run-once/planning-selection.ts` and `planning-cleanup-pending-reconciliation.ts` | A legacy `cleanup-pending` record waits for the ready label. Reconciliation can still publish the needs-info label and a `cleanup-pending` result for such a record. |

A retry also needs artifact reconciliation. Verification fails before Patchmill
records the artifact and its HEAD. The implementation phase can adopt the newer
HEAD before artifact generation resumes. Reusing that commit then produces an
empty artifact diff, which `verifyArtifactCommit()` rejects.

## Policy

Patchmill judges workspace cleanliness from ordinary Git status: staged changes,
tracked changes, and untracked files that Git does not ignore. Ignored content
never fails a check, refuses an action, pauses a run, or requires an operator
label or retry.

The policy adds no way to delete ignored content:

- Read-only checks never change files.
- Refresh and reset move the old checkout, with its ignored content, to a
  retained quarantine path. Nothing in Patchmill deletes quarantine paths.
- Recreate runs only when the expected worktree path is absent, so there is no
  old ignored content to lose.
- Final phase cleanup keeps the #262 policy. After the existing publication and
  ownership safeguards pass, normal `git worktree remove` deletes ignored
  content.

The issue asks for a separate preservation decision before removal or
replacement of unknown ignored content. Under this design, quarantine is that
decision for replacement, and #262 is that decision for final removal. The
change does not permit any new removal of ignored content.

This policy matches the rule from #211, #243 and #262: every ignored path gets
the same treatment, and a path name does not prove that content is disposable.
The policy therefore has no path-based exceptions.

## Requirements and scope

### Publication verification

- `verifyArtifactCommit()` and `verifyWorkspace()` pass whatever ignored content
  the workspace holds, including collapsed directory records.
- Both methods still reject staged changes, tracked changes and ordinary
  untracked files with `status/dirty-workspace`.
- HEAD mismatch, invalid ancestry, invalid artifact files, symlinks, gitlinks
  and unrelated committed changes keep their existing rejection rules.
- A force-added ignored file is staged or committed content. The status check or
  the artifact-diff check still rejects it.
- Verification preserves the plan commit, index, worktree files and ignored
  bytes.
- Verification needs no todo root or other ownership input.

### Recovery

- Retry recovery and `patchmill run reset` never refuse because of ignored
  content. They choose an action from the remaining evidence.
- Refresh and reset keep ignored content byte-identical in the quarantine
  checkout. The new workspace starts without the old ignored content.
- Run-once output names the quarantine path after a refresh, as
  `patchmill run reset` already reports `quarantinePaths`.
- A late ignored change in a quarantine, staging or published worktree does not
  abort a mutation. A late ordinary change still aborts it and preserves the
  workspace.
- In-place resume keeps its current behavior.

### Legacy pending cleanup

- A saved `cleanup-pending` record from an older release resumes like `ready`
  cleanup. It does not need the ready label.
- Patchmill no longer publishes the needs-info label or a `cleanup-pending`
  result for these records.
- Saved records stay readable. The codec still decodes the `cleanup-pending`
  state and its ignored paths.
- An older release may already have applied the lifecycle needs-info label. That
  label still blocks selection, as any needs-info label does, because Patchmill
  cannot tell its own old label from one that a person added. The ready label
  still acknowledges it, as it does today.

### Supported in-place retry

- A supported retry reuses the committed artifact and the existing todos, then
  continues through the normal workflow gates.

### Out of scope

- Paths that Git does not ignore. A todo root that the repository does not
  ignore appears in ordinary status and still fails verification. The
  `.gitignore` entries that `patchmill init` adds include `.pi/todos/`.
  `cleanStatusIgnorePrefixes` keeps its current users and is not added to
  verification.
- Changes to final cleanup policy, cleanup hooks, force flags, backups or todo
  content validation.
- Dependency, configuration and durable schema changes.

## Approaches considered

**Ordinary status everywhere, selected.** Remove the ignored-content blockers
listed above. Behavior is the same for every repository, tool and ignore setup,
and no list of paths needs upkeep.

**Recorded todo-root exception, rejected.** The first version of this spec used
this approach. It fails on collapsed records such as `!! .pi/`, and every other
ignored path still blocks. It is a one-entry allowlist, which #243 and #262
rejected.

**Configurable ignored-path allowlist, rejected.** Each repository and tool
would need its own list, and any missed path would still block a run.

**Remove todos before verification, rejected.** This deletes required task
state.

## Proposed behavior

### Publication verification

`assertClean()` runs
`git --no-optional-locks status --porcelain=v1 -z --untracked-files=all` without
`--ignored`. Any output produces `status/dirty-workspace`. `--no-optional-locks`
stops status from refreshing the index, so verification writes nothing. Git
failures keep their existing error mapping.

The HEAD, ancestry, tree and artifact-diff proofs do not change. The verifier
does not remove files, change refs, reset the index or run worktree mutation
commands.

### Recovery

`decideRunRecovery()` drops the `ignored-worktree-content` refusal.
`assessRunRecovery()` stops reading ignored status, so the "cannot inspect
ignored worktree status" failure goes away. The assessment loses its
`ignoredEntries` and `ignoredStatus` fields. Messages, progress events and
refusal diagnostics stop reporting ignored entries.

`assertRecoveryWorkspaceUnchanged()` runs only the ordinary status read.

Refresh and reset already move the old checkout with `git worktree move`, which
keeps ignored files. The run-once refresh result and progress output report the
quarantine path from the mutation result.

### Legacy pending cleanup

`planningIssueEligible()` stops requiring the ready label for a
`cleanup-pending` record. No code path returns a `cleanup-pending` outcome or
result or publishes its labels. That includes
`reconcilePlanningCleanupPendingPublication()`.

Finish and phase cleanup already treat `cleanup-pending` like `ready`, and state
transitions already permit `cleanup-pending` to `worktree-removed`. The next run
removes the worktree under the #262 rules and records `worktree-removed` and
`removed`.

After this change, nothing produces the `cleanup-pending` result status or the
`ignored-worktree-content` diagnostic. This change removes both, along with
their output helpers. The run-once docs list `cleanup-pending` as an exit-zero
result, so scripts that read run-once results will no longer see that status.

### Supported in-place retry

Reconciliation applies only to `workspace-ready` phases with incomplete artifact
evidence and a live HEAD that differs from the saved HEAD. It runs before strict
saved-HEAD resume or generic implementation HEAD adoption. Fresh workspaces at
the saved HEAD continue through normal artifact generation.

Recovery must prove all of these conditions:

- The Issue run, phase, saved base, branch, path and worktree registration match
  the existing ownership rules.
- Ordinary status is clean, and the observed HEAD descends from the saved HEAD.
- The committed tree contains one unambiguous candidate for the next missing
  artifact kind and the current issue, inside the configured artifact directory.
- `verifyArtifactCommit()` accepts that candidate against the earlier saved
  HEAD. The delta contains only that artifact path.

Candidate discovery inspects the committed tree and uses the existing
`-issue-<number>-` naming rule. It keeps the original path and does not derive a
new filename from the retry date.

After proof, recovery appends the artifact evidence and advances workspace HEAD
through the existing checkpoint operation. Strict resume then uses this
checkpoint. The artifact agent does not recreate the recovered document or its
todos. Remaining artifact work and publication use the normal phase flow.

This bounded retry supports one unrecorded artifact delta, which matches the
reported interruption. Ambiguous candidates, unrelated changes, invalid ancestry
and unsafe workspace evidence stop the retry without changing files. A failed
checkpoint stops before publication or implementation. Ignored content never
causes a stop.

Already recorded artifacts keep their skip behavior. Planning pull requests
still require verified merge where the saved planning review gate requires it.
Retry keeps `plan-only` behavior and implementation PR requirements.

## Affected components

- `src/git/planning-publication-git.ts`: Read ordinary status only in
  `assertClean()`.
- `src/cli/commands/run-once/recovery-policy.ts`, `recovery-assessment.ts`,
  `recovery.ts`, `recovery-mutation-helpers.ts`, `pipeline-legacy.ts`,
  `pipeline-recovery.ts`, `pipeline-error-diagnostics.ts` and `types.ts`: Remove
  the ignored inventory and refusal, and report quarantine paths.
- `src/cli/commands/run-once/planning-selection.ts`,
  `planning-cleanup-pending.ts`, `planning-cleanup-pending-reconciliation.ts`,
  `planning-pipeline.ts`, and the result and diagnostic modules: Resume legacy
  pending cleanup without a label. Remove the `cleanup-pending` result and the
  `ignored-worktree-content` diagnostic.
- `src/cli/commands/run-once/planning-phase-artifacts.ts`,
  `planning-phase-runner-shared.ts` and
  `planning-phase-runner-implementation.ts`, plus a focused artifact-recovery
  helper with committed-tree discovery: Reconcile an unrecorded artifact before
  saved-HEAD resume or generic HEAD adoption. Keep retry proof separate from
  agent execution and reuse the artifact naming rules.
- `src/workflow/planning-state-workspace-codec.ts` and
  `planning-state-transitions.ts`: No change. Legacy records still decode.
- `site/src/content/docs/using-patchmill/run-once.md` and
  `site/src/content/docs/reference/agent-workflow-lifecycle.md`: State the
  policy, describe quarantine preservation, and remove the ready-label and
  `cleanup-pending` result text.

## Verification strategy

These automated tests pass the Testing Value Gate. They protect production Git
validation, recovery data preservation and a durable retry regression.

### Real-Git publication verification

Extend `src/git/planning-publication-git.real.test.ts` with a linked phase
workspace and a committed artifact. Add these ignored items: files under
`.pi/todos/`, `.pi/` collapsed through `.git/info/exclude`, `node_modules/`, and
an ignored file inside the artifact directory. Both verification methods must
pass. Artifact bytes, ignored bytes, index state and HEAD must stay unchanged
across repeated calls.

Keep negative coverage for staged changes, tracked changes, ordinary untracked
files, HEAD mismatch, invalid ancestry, missing artifacts, symlinks, gitlinks
and extra committed paths. Add a force-added ignored file, both staged and
committed, which must still fail.

### Recovery

Invert the test "late ignored quarantine content prevents refresh ref update" in
`recovery-mutation-ignored-content.test.ts`. Late ignored content must not stop
refresh, and its bytes must remain at the quarantine path.

Add real-Git refresh and `patchmill run reset` cases where the old worktree
holds ignored files. The mutation must complete. The quarantine path must hold
byte-identical ignored files, and the output must name that path.

Keep the tests where a late ordinary change aborts the mutation and preserves
the workspace. Remove tests that expect the `ignored-worktree-content` refusal.

### Legacy pending cleanup

A `cleanup-pending` record without the ready label must be eligible for
selection. A rerun must remove the worktree with normal cleanup and record
`worktree-removed` and `removed`. It must not apply the needs-info label or
return a `cleanup-pending` result. Keep the test where an existing needs-info
label plus the ready label resumes the run.

### Workflow retry

Extend the real-Git phase-runner coverage beyond the existing mocked artifact
operation. Start from saved `workspace-ready` state at the pre-agent HEAD.
Include a committed plan, missing plan evidence, ignored todos and a collapsed
`.pi/` record.

A supported retry must checkpoint the original plan path and commit without
another plan-agent invocation. The next implementation-agent boundary must
observe the same plan commit and byte-identical todos. Stop this scenario before
final cleanup. Repeat from the updated checkpoint to prove idempotence.

Keep the planning review gate, verified-merge and `plan-only` tests. Add retry
refusals for ambiguous candidates, unrelated commits, dirty ordinary status,
invalid ancestry and checkpoint failure. Each refusal must preserve the
workspace. Command observations must show no cleanup or replacement during
verification or artifact reconciliation.

Final cleanup tests under #262 stay as they are.

Implementation verification will run the focused Git, recovery and workflow
suites, then `npm run test:run-once`, `npm test`, `npm run lint`,
`npm run build` and `git diff --check`. If npm dependency files change, a Nix
build is required.

## Planning handoff

This artifact receives review in the current planning pull request. The next
Patchmill workflow step creates the implementation plan. This spec-creation step
does not implement code or create implementation task todos.
