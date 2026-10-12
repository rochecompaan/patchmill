# Ignored Content Policy Implementation Plan

> **For agentic workers:** Use Native execution through
> `.patchmill/skills/inline-dev-with-validation-and-pr-checks/SKILL.md` and its
> sibling `.patchmill/skills/executing-plans/SKILL.md`. The implementation
> session is the sole writer. Steps use checkbox syntax for tracking.

**Goal:** Stop ignored content from blocking Patchmill operations, without
weakening ordinary-change guards or losing preserved workspace data.

**Architecture:** Use ordinary Git status for verification and recovery.
Preserve replaced checkouts at retained quarantine paths. Recover one proven,
unrecorded artifact before saved-HEAD resume or implementation HEAD adoption.

**Tech Stack:** TypeScript, Node.js 22.19.0 or later, `node:test`, real Git
linked worktrees, npm, and Markdown.

**Spec:**
`docs/specs/2026-10-11-issue-307-planning-artifact-verification-rejects-patchmill-owned-ignored-todos-design.md`

**Issue:** #307. The widened spec replaces the earlier todo-only proposal in the
issue comments.

**Review context:** Carry this plan with implementation code. Do not create a
planning pull request for this artifact. Preserve existing planning review
gates. The configured execution method does not authorize implementation before
approval.

## Global Constraints

- Workspace cleanliness uses ordinary Git status: staged changes, tracked
  changes, and non-ignored untracked files.
- Every ignored path receives the same treatment. Add no path exception,
  allowlist, todo-root proof, or ignored inventory.
- Read-only verification preserves HEAD, index bytes, artifact bytes, and
  ignored bytes. Use `--no-optional-locks` for status.
- Force-added ignored content remains staged or committed content. Existing
  status and artifact-diff guards still apply.
- Refresh and reset move the old checkout to a retained quarantine path.
  Patchmill never removes quarantine paths.
- Recreate requires an absent expected path. Retain ownership, registration,
  branch, lease, and compare-and-swap guards.
- Final phase cleanup keeps the #262 policy and normal `git worktree remove`.
  Add no deletion command or force flag.
- Legacy `cleanup-pending` records and their ignored paths remain readable. Do
  not change durable schemas or codecs.
- Existing needs-info state still blocks selection until the configured ready
  state acknowledges it.
- Artifact retry supports one unrecorded artifact delta, not arbitrary committed
  progress with missing artifact evidence.
- Preserve the original artifact path, todo root, todos, gate snapshot,
  verified-merge proofs, and implementation-PR requirements.
- Keep current users of `cleanStatusIgnorePrefixes` and `ignoredPaths`. Do not
  add these exclusions to publication verification.
- Change no npm dependency, skill pack, or config. If npm dependency files
  change, run `nix build .#patchmill --print-build-logs`.
- Keep `.pi/todos` local and uncommitted. Close implementation todos only after
  their task commands pass.

## Review Focus

These conditions need explicit regression coverage in the tasks that own them:

1. A force-added ignored file remains a blocker, unlike an ordinary ignored file
   (Task 1).
2. A late ignored write at each mutation boundary passes, but a late ordinary
   write preserves the workspace and stops mutation (Task 2).
3. Custom labels and comment-backed needs-info state retain their selection
   safeguards without a cleanup-specific ready gate (Task 3).
4. A configured artifact directory with spaces or an issue-number prefix
   collision does not select the wrong committed artifact (Task 4).
5. A HEAD change or checkpoint error during artifact reconciliation cannot reach
   an artifact agent, publication, or implementation (Task 4).

## File Structure and Task Boundaries

Paths in each task are repository-relative. Each task has its own behavioral or
direct-verification gate.

| Task | Responsibility                                             | Main files                                                        |
| ---- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| 1    | Read-only publication cleanliness                          | `src/git/planning-publication-git.ts` and its tests               |
| 2    | Recovery decisions, preservation, and quarantine output    | Recovery modules, legacy pipeline, result output, reset tests     |
| 3    | Legacy cleanup resume and obsolete public contract removal | Planning selection/pipeline modules and result diagnostics        |
| 4    | Bounded committed-artifact reconciliation                  | New focused Git-tree and artifact-recovery modules, phase runners |
| 5    | Operator documentation and delivery validation             | Two site documents and command evidence                           |
| 6    | Independent review and implementation PR handoff           | Review package, progress ledger, and PR check evidence            |

Keep the existing large pipeline files as wiring modules. Put artifact proof in
a focused helper, not another phase-runner branch collection. Extract the
committed-tree parser from `planning-remote-base.ts` rather than copying it.

## Testing Value Gate

Tasks 1–4 pass all four questions. They prove behavior, catch meaningful
regressions, benefit future maintainers, and protect risky reusable operations.
Use automated tests for Git safety, byte preservation, selection, output, and
durable retry. Use real Git where ignore collapsing, index writes, committed
trees, or worktree moves matter.

Tasks 5–6 add no automated tests for documentation text or review records. Use
formatter and Markdown lint commands, source-reference inspection, and existing
behavior suites instead. Do not add tests for dependency versions, static
config, or workflow YAML.

## Execution Setup

- [ ] Read this plan, its spec, `AGENTS.md`, and the configured implementation
      skill.
- [ ] Verify the existing issue worktree with `git status --short` and
      `git branch --show-current`. Expected: no ordinary changes and the issue
      implementation branch, not `main`.
- [ ] If local dependencies are absent, run `npm ci` in this worktree. Expected:
      exit code 0 with no tracked dependency-file changes.
- [ ] Start the plan workspace with
      `.patchmill/skills/subagent-driven-development/scripts/sdd-workspace docs/plans/2026-10-11-issue-307-planning-artifact-verification-rejects-patchmill-owned-ignored-todos.md`.
      Expected: this plan's scratch directory and progress ledger location.
- [ ] Reuse the issue-307 task todos under `.pi/todos`.
- [ ] Record shared interfaces in the progress ledger before Task 1.

For each task, use the sibling `task-start` and `task-done` scripts from
`executing-plans`. Record RED and GREEN evidence, commit OIDs, deviations, and
the exact task command. Do not dispatch task implementers or per-task reviewers.

---

### Task 1: Make Publication Verification Ignore Ignored Content

**Files:**

- Modify: `src/git/planning-publication-git.ts` (`assertClean`).
- Test: `src/git/planning-publication-git.test.ts`.
- Test: `src/git/planning-publication-git.real.test.ts`.

**Interfaces:**

- Consumes: `PlanningArtifactCommitInput` and
  `PlanningWorkspaceVerificationInput` unchanged.
- Produces: unchanged `verifyArtifactCommit(input): Promise<void>` and
  `verifyWorkspace(input): Promise<void>` methods.
- Later tasks reuse these methods without todo ownership input.

- [ ] **Step 1: Add real-Git regression cases.**

Name the positive test
`verifies committed artifacts with ignored content without writing`. Name the
negative test `rejects ordinary changes and force-added ignored content`.

Create a linked worktree with ignore rules committed before the artifact. Commit
`docs/plans/2026-10-11-issue-307-example.md`. Add binary sentinels under
`.pi/todos/`, `node_modules/`, and an ignored file inside `docs/plans/`. First
verify the todo-only case. Then add `.pi/` to the common `.git/info/exclude` and
verify the collapsed-directory case.

Run both methods twice in each case. Snapshot raw HEAD, artifact bytes, ignored
bytes, and the linked-worktree index from `git rev-parse --git-path index`.
Leave stale index stat data before the snapshot so optional status refreshes are
observable.

The tests must assert these results through the existing real-Git runner:

```ts
assert.equal(ordinaryStatus, "");
assert.match(ignoredStatus, /!! \.pi\/\0/u);
assert.deepEqual(after.index, before.index);
assert.equal(after.headOid, before.headOid);
assert.deepEqual(after.artifact, before.artifact);
assert.deepEqual(after.ignoredFiles, before.ignoredFiles);
```

Add a negative matrix for both applicable methods. Include staged artifact
edits, tracked edits, ordinary untracked files, and `git add -f` of ignored
content. A separately committed force-added file must fail
`verifyArtifactCommit()` with `diff/unexpected-changes`. Do not impose a new
whole-workspace committed-diff rule on `verifyWorkspace()`.

- [ ] **Step 2: Run the RED gate.**

Run:
`node --test src/git/planning-publication-git.test.ts src/git/planning-publication-git.real.test.ts`

Expected: the new ignored-content cases fail with `status/dirty-workspace`
before the change.

- [ ] **Step 3: Change only the cleanliness command.**

Remove `--ignored=matching`. Add `--no-optional-locks` as a global Git option
before `-C`. Keep NUL-delimited ordinary status and the existing error mapping.
Update the old real-Git assertion that expects ignored residue to fail.

Keep HEAD, ancestry, regular-file, symlink, gitlink, missing-artifact, and
single-artifact-delta proofs unchanged. Keep verification free of mutation
commands.

- [ ] **Step 4: Run the GREEN gate.**

Run:
`node --test src/git/planning-publication-git.test.ts src/git/planning-publication-git.real.test.ts`

Expected: exit code 0. New preservation cases and existing negative cases pass.

- [ ] **Step 5: Commit the task files.**

Commit message: `fix(git): verify planning artifacts with ordinary status`

Expected: the commit contains only Task 1 code and tests.

### Task 2: Remove Recovery Blockers and Report Preserved Paths

**Files:**

- Modify: `src/cli/commands/run-once/recovery-policy.ts`,
  `recovery-assessment.ts`, `recovery-mutation-helpers.ts`, `recovery.ts`, and
  `types.ts`.
- Modify: `src/cli/commands/run-once/pipeline-recovery.ts`,
  `pipeline-legacy.ts`, and `pipeline-error-diagnostics.ts`.
- Modify: `src/cli/commands/run-once/result-summary.ts` and
  `terminal-result.ts`.
- Test: `src/cli/commands/run-once/recovery-ignored-content.test.ts`,
  `recovery-mutation-ignored-content.test.ts`, and
  `pipeline-recovery-ignored-content.test.ts`.
- Test: `src/cli/commands/run/reset/reset.test.ts` and `main.test.ts`.
- Test/update fixtures: `src/cli/commands/run-once/recovery.test.ts`,
  `recovery-mutation.test.ts`, `recovery-archive.test.ts`, and
  `pipeline-error-diagnostics.test.ts`.
- Modify fixture: `test-support/run-once/pipeline-fixtures.ts`.
- Test: `src/cli/commands/run-once/result-output.test.ts` and
  `terminal-result.test.ts`.

**Interfaces:**

- Consumes: existing `RunRecoveryDecision`, `RunRecoveryMutationResult`,
  `planRunRecovery(input)`, and `recoverBlockedWorkspace(input)`.
- Produces: `RunRecoveryAssessment.worktree` without `ignoredEntries` or
  `ignoredStatus`.
- Produces: `RunRecoveryRefusalReason` and refusal variants without
  `ignored-worktree-content` or its `blockedAction`.
- Produces: optional `quarantinePaths?: string[]` on the common pipeline-result
  metadata and `RunOnceResultLog` summary metadata.
- Mutation results retain their existing `quarantinePaths: string[]`. Reset
  keeps its current result contract.

- [ ] **Step 1: Add preservation and boundary regressions.**

Name the new cases `refresh preserves ignored bytes and reports quarantine` and
`reset preserves ignored bytes before pipeline entry`. Name boundary cases
`late ignored writes pass at recovery boundaries` and
`late ordinary writes preserve and stop recovery`.

Replace ignored-content refusal cases with refresh, reset, and in-place resume
expectations. Configure a runner to fail any ignored-status command. Ordinary
recovery must still succeed because it never requests that command.

Use real Git for a stale, empty registered branch with ignored binary files.
Refresh must move its old checkout to quarantine. Reset must archive state,
preserve the old checkout, and enter the normal pipeline with its borrowed
lease. Verify the reported path against the actual quarantine directory.

Invert `late ignored quarantine content prevents refresh ref update`. Add late
ignored writes at staging and published-workspace boundaries. Include reset's
quarantine boundary. Retain late ordinary-change cases and compare-and-swap
failures.

```ts
assert.equal(decision.action, "refresh-and-resume");
assert.deepEqual(await readFile(quarantinedFile), originalBytes);
assert.deepEqual(result.quarantinePaths, [quarantinePath]);
assert.equal(git(repo, "rev-parse", branch), baseOid);
assert.equal(await pathExists(oldIgnoredFileInNewWorkspace), false);
```

Add output cases for redirected JSON, final JSONL data, TTY output, and recovery
progress. All must name the same quarantine path. Include a path with spaces and
terminal controls in formatter coverage. In-place resume must preserve bytes
without an ignored-path inventory.

- [ ] **Step 2: Run the RED gate.**

Run:
`node --test src/cli/commands/run-once/recovery-ignored-content.test.ts src/cli/commands/run-once/recovery-mutation-ignored-content.test.ts src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts src/cli/commands/run/reset/*.test.ts src/cli/commands/run-once/result-output.test.ts src/cli/commands/run-once/terminal-result.test.ts`

Expected: refresh/reset and late ignored-write cases fail under the old
ignored-content guards.

- [ ] **Step 3: Remove the ignored inventory and refusal.**

Remove the ignored-status command and parser from `assessRunRecovery()`.
Preserve ordinary status, current configured exclusions, divergence, artifact,
ownership, and lease evidence. Remove `ignoredRefusal()` and return the
candidate action after remaining safety checks.

Make `assertRecoveryWorkspaceUnchanged(runner, path, label): Promise<void>` read
ordinary status only. Use `--no-optional-locks`. Keep ordinary command errors
and nonempty ordinary status fail-closed.

Remove inventory messages, progress data, and the ignored-refusal diagnostic
adapter. Update assessment fixtures and archive expectations. Keep old saved
archive files readable without a migration.

- [ ] **Step 4: Carry quarantine paths into Run-once output.**

Copy `mutation.quarantinePaths` into the legacy pipeline result metadata after a
refresh. Preserve that metadata on every normal return after recovery, including
a later blocked result. Emit recovery progress with the actual retained paths,
not only the planned paths.

Copy this optional field through `summarizeResult()`. Add a `Quarantine paths`
section through the existing terminal layout. Do not change stdout/stderr
routing. Keep mutation-error preservation diagnostics and reset reporting
unchanged.

- [ ] **Step 5: Run the GREEN gate.**

Run:
`node --test src/cli/commands/run-once/recovery*.test.ts src/cli/commands/run-once/pipeline-recovery*.test.ts src/cli/commands/run-once/pipeline-error-diagnostics.test.ts src/cli/commands/run/reset/*.test.ts src/cli/commands/run-once/result-output.test.ts src/cli/commands/run-once/terminal-result.test.ts`

Expected: exit code 0. Ignored writes pass, ordinary writes still stop, and
retained bytes and output agree.

- [ ] **Step 6: Commit the task files.**

Commit message:
`fix(recovery): preserve ignored content without blocking recovery`

Expected: no new quarantine deletion, worktree-force removal, or destructive
cleanup command.

### Task 3: Resume Legacy Cleanup Without Republished Blockers

**Files:**

- Modify: `src/cli/commands/run-once/planning-selection.ts`,
  `planning-pipeline.ts`, `planning-pipeline-issue.ts`,
  `planning-phase-coordinator.ts`, `planning-phase-runner-shared.ts`, and
  `planning-lifecycle-labels.ts`.
- Remove: `src/cli/commands/run-once/planning-cleanup-pending.ts` and
  `planning-cleanup-pending-reconciliation.ts` after removing their consumers.
- Modify: `src/cli/commands/run-once/types.ts`, `result-summary.ts`,
  `result-output.ts`, `terminal-result.ts`, `terminal-diagnostic-sections.ts`,
  `result-diagnostic-types.ts`, and `result-diagnostic-general.ts`.
- Test/replace: `src/cli/commands/run-once/planning-selection.test.ts`,
  `planning-cleanup-pending-reconciliation.test.ts`,
  `planning-pipeline-ignored-cleanup.test.ts`, and
  `planning-lifecycle-labels.test.ts`.
- Update/remove obsolete result tests: `planning-cleanup-pending.test.ts`,
  `planning-cleanup-pending-output.test.ts`, `result-output.test.ts`,
  `result-diagnostics.test.ts`, and `terminal-diagnostics.test.ts` in the same
  directory.
- Preserve existing suites:
  `src/workflow/planning-state-cleanup-pending.test.ts`,
  `src/cli/commands/run-once/planning-phase-cleanup-legacy-pending.test.ts`, and
  `planning-finish-publication.real.test.ts`.

**Interfaces:**

- Consumes: Task 2's recovery refusal removal and existing saved
  `PlanningWorkspaceCleanupPending` records.
- Produces: `planningIssueEligible(input): boolean` without a cleanup-specific
  ready requirement.
- Produces: pipeline and coordinator unions without the public `cleanup-pending`
  result/outcome.
- Produces: reason catalogs without the public `ignored-worktree-content`
  diagnostic.
- Durable `cleanup-pending` state, its reason literal, and transition rules
  remain unchanged.

- [ ] **Step 1: Add selection-to-cleanup regressions.**

Name the regression `legacy pending cleanup resumes without ready state`.

Use saved spec, plan, and implementation records with `cleanup-pending` and no
ready label. Exercise actual eligibility, pipeline entry, normal cleanup, and
result mapping. Existing publication and ownership safeguards must pass before
cleanup.

```ts
assert.equal(selection.kind, "planning");
assert.deepEqual(cleanupCheckpoints, ["worktree-removed", "removed"]);
assert.equal(needsInfoPublications.length, 0);
assert.notEqual(result.status, "cleanup-pending");
```

Repeat selection with custom labels and comment-backed roles. An existing
needs-info role without ready remains ineligible. Ready plus needs-info remains
eligible. Keep existing cleanup-hook idempotence and ordinary-dirty refusals.

- [ ] **Step 2: Run the RED gate.**

Run:
`node --test src/cli/commands/run-once/planning-selection.test.ts src/cli/commands/run-once/planning-cleanup-pending-reconciliation.test.ts src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts`

Expected: no-ready legacy cleanup hits the old eligibility or needs-info
publication path.

- [ ] **Step 3: Remove the cleanup-specific selection and publication paths.**

Remove `cleanupPending()` and the extra ready condition from ordinary
eligibility. Remove `needsPlanningCleanupPendingPublication()` from selection.
Remove the pre-eligibility reconciliation callback from `PlanningIssueInput` and
production wiring.

Remove pending-publication functions, labels, outcome mapping, and coordinator
union members. Keep the normal blocked-result needs-info behavior. Do not modify
`planning-state-workspace-codec.ts`, `planning-state-transitions.ts`, or #262
cleanup operations.

- [ ] **Step 4: Remove obsolete public output and diagnostics.**

Remove `AgentIssueCleanupPendingResult`, its summary variant, exit-code case,
terminal status, and diagnostic catalog entry. Preserve Task 2's quarantine
metadata.

`formatPlanningCleanupPath()` also formats general diagnostic paths. Move this
retained quoting helper to `terminal-diagnostic-sections.ts` before removing its
old module. Keep path-sanitization tests for the retained behavior. Replace
obsolete publication/result tests with legacy-resume behavior tests.

- [ ] **Step 5: Run the GREEN gate.**

Run:
`node --test src/cli/commands/run-once/planning-selection.test.ts src/cli/commands/run-once/planning-pipeline*.test.ts src/cli/commands/run-once/planning-lifecycle-labels.test.ts src/cli/commands/run-once/planning-phase-cleanup*.test.ts src/cli/commands/run-once/planning-finish*.test.ts src/cli/commands/run-once/result*.test.ts src/cli/commands/run-once/terminal*.test.ts src/workflow/planning-state*.test.ts`

Expected: exit code 0. Legacy records still decode and complete normal cleanup
without a pending result or new needs-info effect.

- [ ] **Step 6: Commit the task files.**

Commit message:
`fix(run-once): resume legacy pending cleanup without ignored blockers`

Expected: remaining production references to the old literals serve only
saved-state compatibility and cleanup transitions.

### Task 4: Reconcile One Unrecorded Committed Artifact Before Resume

**Files:**

- Create: `src/git/planning-artifact-tree.ts` and
  `planning-artifact-tree.test.ts`.
- Modify: `src/git/planning-remote-base.ts` and `planning-remote-base.test.ts`.
- Modify: `src/git/planning-publication-git.ts` and its unit/real-Git tests.
- Create: `src/cli/commands/run-once/planning-artifact-recovery.ts` and
  `planning-artifact-recovery.test.ts`.
- Modify: `src/cli/commands/run-once/planning-phase-artifacts.ts`,
  `planning-phase-runner-shared.ts`, and
  `planning-phase-runner-implementation.ts`.
- Test: `src/cli/commands/run-once/planning-phase-runner.real.test.ts`,
  `planning-phase-runner.test.ts`, and `planning-phase-artifacts.test.ts`.
- Update: typed `PlanningPublicationOperations` test doubles in existing
  callers.

**Interfaces:**

- Consumes: Task 1 verification, `PlanningArtifactWorkspacePhase`,
  `PlanningArtifactCheckpoint`, `PlanningWorkspaceLifecycle.inspect/resume`, and
  `PlannedPhase.artifactKinds`.
- Produces:
  `PlanningPublicationOperations.inspectArtifactCandidates(input: { commitOid: string; issueNumber: number; specsDir: string; plansDir: string }): Promise<PlanningArtifactCandidates>`.
- Produces:
  `parsePlanningArtifactCandidates(input: { stdout: string; issueNumber: number; specsDir: string; plansDir: string }): PlanningArtifactCandidates`
  in the focused Git-tree module.
- Produces:
  `reconcilePlanningWorkspaceArtifact(input): Promise<PlanningArtifactWorkspacePhase>`
  in the recovery module.
- Its scalar input fields are `runId: string`, `issueNumber: number`,
  `specsDir: string`, and `plansDir: string`.
- Its phase fields are `phase: PlannedPhase` and
  `current: PlanningArtifactWorkspacePhase`.
- Its `checkpoint` has type `PlanningArtifactCheckpoint`.
- Its `git` is a
  `Pick<PlanningPublicationOperations, "inspectArtifactCandidates" | "assertAncestor" | "verifyArtifactCommit">`.
- Its `workspaces` is a
  `Pick<PlanningWorkspaceLifecycle, "inspect" | "resume">`.
- Produces:
  `appendPlanningArtifactEvidence(current: PlanningArtifactWorkspacePhase, phase: PlannedPhase, evidence: PlanningArtifactEvidence): PlanningArtifactWorkspacePhase`
  in `planning-phase-artifacts.ts`.
- Produces:
  `reconcileWorkspaceArtifact(input: PlanningPhaseRunnerInput, state: PlanningStateV1): Promise<PlanningStateV1>`
  in runner-shared wiring.

- [ ] **Step 1: Add the interrupted-artifact regression with real Git.**

Name the regression
`recovers the original committed plan before implementation without another plan agent`.
Name negative cases `refuses unsafe unrecorded artifact recovery` with
condition-specific subtests.

Start from saved `workspace-ready` at the pre-agent HEAD with missing plan
evidence. Commit `docs/plans/2026-10-11-issue-307-original.md`. Preserve ignored
todo sentinels, other ignored files, and a collapsed `.pi/` record. Use real
artifact operations, not the existing mocked `runArtifacts` shortcut.

Retry with a later artifact date. Observe the checkpoint and the next
implementation-agent boundary. Stop before finish cleanup. Repeat from the
updated checkpoint to prove idempotence.

```ts
assert.equal(planAgentCalls, 0);
assert.equal(recoveredPlan.path, "docs/plans/2026-10-11-issue-307-original.md");
assert.equal(recoveredPlan.commitOid, originalPlanOid);
assert.equal(implementationHeadOid, originalPlanOid);
assert.deepEqual(observedTodos, originalTodos);
assert.equal(artifactRecoveryMutationCalls.length, 0);
```

Add refusal cases for these conditions:

- Zero or ambiguous candidates.
- Unrelated committed paths or ordinary dirty status.
- Invalid ancestry or unsafe registration.
- Saved ownership mismatch.
- Late HEAD movement or checkpoint error.

Each refusal preserves workspace and index bytes. None starts another artifact
agent, publication, or implementation.

Add fresh saved-HEAD generation and already-recorded skip cases. If assigned
artifact evidence is complete, retain generic implementation HEAD adoption. Keep
`plan-only`, open review, and verified-merge tests.

- [ ] **Step 2: Add committed-tree discovery cases.**

Name the discovery test
`discovers current-issue artifacts from the committed tree only`.

Cover custom directories with spaces, nested artifacts, issue 307 versus issue
3070, and ignored uncommitted lookalikes. Discovery uses the committed tree
only. Include malformed NUL output, duplicate records, invalid paths, symlinks,
and gitlinks.

- [ ] **Step 3: Run the RED gate.**

Run:
`node --test src/cli/commands/run-once/planning-phase-runner.real.test.ts src/cli/commands/run-once/planning-phase-runner.test.ts src/cli/commands/run-once/planning-phase-artifacts.test.ts`

Expected: the interrupted case fails at saved HEAD or empty artifact diff. The
original plan cannot reach implementation without another artifact operation.

- [ ] **Step 4: Add read-only committed-tree discovery.**

Extract the existing NUL tree-record validation and issue-marker matching from
`PlanningRemoteBaseGit.fetch()` into `planning-artifact-tree.ts`. Preserve
`PlanningWorkspaceResponseError` mapping and regular-blob candidate rules. Keep
Git adapter directory normalization inside the repository root.

Implement `inspectArtifactCandidates()` with
`git ls-tree -r -z --full-tree <commitOid> -- <specsDir> <plansDir>`. Validate
the full OID, positive issue number, and directories. Use the same
`-issue-<number>-` basename rule as remote-base discovery. Do not derive paths
from the retry date or inspect filesystem candidates.

- [ ] **Step 5: Implement bounded artifact proof and checkpoint.**

If artifact evidence is complete or live HEAD equals saved HEAD, return the
current phase unchanged. For incomplete evidence at a different HEAD, retain the
earlier saved HEAD until proof succeeds.

Use existing resume ownership checks. On the expected HEAD mismatch, inspect the
registered workspace. Require ready state and ordinary cleanliness. Resume
against an in-memory ownership copy with only the observed HEAD changed. Retain
the saved run, phase, base, branch, and path proofs.

Prove ancestry from the earlier saved HEAD. Select exactly one candidate for the
next missing kind in `phase.artifactKinds`. Verify that candidate with
`verifyArtifactCommit()` against the earlier saved HEAD. Zero or multiple
candidates stop recovery. The single-path delta proof rejects unrelated commits
and multiple unrecorded artifact kinds.

Recheck observed HEAD and ordinary cleanliness before the checkpoint. Append
`source: "workspace"` evidence in assigned-kind order. Advance workspace HEAD
through the existing checkpoint callback. Keep `todoRoot` and all prior evidence
unchanged. Propagate proof or checkpoint errors before later effects.

Keep artifact-agent execution separate from this helper. Extract
`appendPlanningArtifactEvidence()` from the existing artifact update. Use this
function for both normal generation and recovery.

- [ ] **Step 6: Wire proof before both competing resume paths.**

Call `reconcileWorkspaceArtifact()` before strict resume in
`runWorkspaceArtifacts()`. Update its local state through `replacePhase()` and
the existing lock-protected state store.

In `runPlanningImplementationPhase()`, reconcile before
`adoptResumedImplementationHead()`. Never use generic adoption to advance HEAD
while assigned artifact evidence remains incomplete. The shared reconciliation
call then becomes an idempotent no-op. Fresh phases at saved HEAD still use
normal generation for missing artifacts.

Do not bypass `fetchVerifiedBase()`, planning publication, review
reconciliation, or implementation PR validation.

- [ ] **Step 7: Run the GREEN gate.**

Run:
`node --test src/git/planning-artifact-tree.test.ts src/git/planning-remote-base.test.ts src/git/planning-publication-git*.test.ts src/cli/commands/run-once/planning-artifact-recovery.test.ts src/cli/commands/run-once/planning-phase-artifacts.test.ts src/cli/commands/run-once/planning-phase-runner*.test.ts src/cli/commands/run-once/planning-phase-coordinator*.test.ts src/cli/commands/run-once/planning-implementation*.test.ts`

Expected: exit code 0. Retry records the original artifact once, preserves
todos, and retains normal workflow gates.

- [ ] **Step 8: Commit the task files.**

Commit message:
`fix(run-once): reconcile interrupted artifact commits before resume`

Expected: no durable schema change, worktree replacement, cleanup command, or
agent call inside artifact reconciliation.

### Task 5: Document the Policy and Validate the Delivery

**Files:**

- Modify: `site/src/content/docs/using-patchmill/run-once.md`.
- Modify: `site/src/content/docs/reference/agent-workflow-lifecycle.md`.
- Record command and review evidence in this plan's ignored progress ledger.

**Interfaces:**

- Consumes: Tasks 1–4, optional Run-once `quarantinePaths`, and unchanged legacy
  reset output.
- Produces: operator documentation that matches the delivered policy and public
  result statuses.

- [ ] **Step 1: Update the operator documentation.**

State that ignored content never blocks verification, recovery, or cleanup.
Describe ordinary-change blockers and force-added content. Describe
refresh/reset quarantine preservation and the output field that names retained
paths.

Remove the public `cleanup-pending` result and cleanup-specific ready-label
instructions. Explain saved-record compatibility and the unchanged needs-info
acknowledgement rule. Describe the bounded committed-artifact retry and its
normal review gates.

Keep the #262 warning: final phase cleanup permanently removes ignored content
under existing safeguards. Keep reset's legacy-only scope and planning-state
refusal. Use the simple-english skill.

- [ ] **Step 2: Run direct documentation verification.**

Run:
`npx --no-install prettier --check site/src/content/docs/using-patchmill/run-once.md site/src/content/docs/reference/agent-workflow-lifecycle.md`

Expected: both files pass format checks.

Run:
`npx --no-install markdownlint-cli2 site/src/content/docs/using-patchmill/run-once.md site/src/content/docs/reference/agent-workflow-lifecycle.md`

Expected: exit code 0.

Run:
`rg -n -- '--ignored=matching|ignoredEntries|ignoredStatus|ignored-worktree-content|cleanup-pending' src site/src/content/docs/using-patchmill/run-once.md site/src/content/docs/reference/agent-workflow-lifecycle.md`

Expected: only test diagnostics, saved-state compatibility, legacy cleanup
transitions, and compatibility documentation remain. No production
ignored-status read or public ignored-content refusal remains. Current
ordinary-status exclusion helpers are outside this removal.

- [ ] **Step 3: Run full validation from the issue worktree.**

```sh
npm run test:run-once
npm test
npm run lint
npm run build
git diff --check
```

Expected: every command returns exit code 0. Keep the #262 real-Git cleanup
tests unchanged and passing through `npm test`. Record any pre-existing error as
a validation blocker, not a speculative source fix.

If npm dependency files change, run `nix build .#patchmill --print-build-logs`.

Expected: exit code 0. This conditional command implements the `AGENTS.md`
requirement. No dependency change is planned.

- [ ] **Step 4: Commit the documentation files.**

Commit message:
`docs(run-once): explain ignored content and quarantine preservation`

Expected: only the two documentation files enter this commit.

### Task 6: Complete Independent Review and PR Handoff

**Files:** This plan's ignored progress ledger, review package, and
implementation PR description. No production change is planned.

**Interfaces:**

- Consumes: completed Tasks 1–5, their command evidence, the approved spec, and
  this plan's Review Focus.
- Produces: one independent review reference, final-HEAD validation evidence,
  and an implementation PR handoff through the configured skill.

- [ ] Complete task records and required command evidence before the final
      review.
- [ ] Prepare one whole-branch review package through the configured
      implementation skill. Include the plan, spec, Review Focus, progress
      ledger, immutable base/head, and all workflow-materialized files.
- [ ] Request one independent read-only reviewer on the most capable permitted
      model. Expected: a completed review reference. No task implementers,
      per-task reviews, or automatic second review.
- [ ] Record findings and rulings before the one ordered fix pass. Use
      RED-to-GREEN tests for accepted correctness findings. Use direct
      verification for documentation. Defer Minor findings.
- [ ] Rerun every task gate and full validation command against the final state.
      Run:
      `npm run test:run-once && npm test && npm run lint && npm run build && git diff --check`
      Expected: all required commands pass with evidence tied to the final HEAD.
      If dependency files changed, rerun the Nix command from Task 5.
- [ ] Handle implementation PR checks through
      `.patchmill/skills/inline-dev-with-validation-and-pr-checks/SKILL.md`.
      Require passing checks or evidence that no required checks exist. Preserve
      existing publication authorization and terminal JSON requirements.
- [ ] Keep the plan and spec with implementation code. Do not merge directly or
      alter planning review gates.

## Planning Self-Review

The task map covers publication verification, recovery preservation/output,
legacy cleanup, bounded artifact retry, operator documentation, and final
review. Each behavior task includes meaningful regression assertions and an
exact command. The five Review Focus conditions map to task tests. New
interfaces use existing workspace and artifact types. No dependency, schema,
final-cleanup policy, or implementation-method change is planned.
