# Ignored Phase-Worktree Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove a verified phase worktree when ordinary Git status is clean,
even when the worktree contains ignored content.

**Architecture:** Keep `PlanningWorkspaceCleanupGit` as the shared removal
boundary for all phase workspaces. Read ordinary status twice, then use normal
non-force Git removal as the final race guard. Keep legacy `cleanup-pending`
state readable as retry input, but remove it from live cleanup results.

**Tech Stack:** TypeScript, Node.js test runner, real Git fixtures, Patchmill
planning state, Astro documentation

**Spec:**
`docs/specs/2026-10-01-issue-262-implementation-cleanup-blocks-on-ignored-worktree-content-regression-of-the-243-policy-design.md`

## Global Constraints

- Apply one cleanup rule to spec, plan, and implementation phase workspaces.
- Treat empty `git status --porcelain=v1 --untracked-files=all` output as clean.
- Keep staged, tracked, and non-ignored untracked content as cleanup blockers.
- Do not inspect or classify ignored paths during live phase cleanup.
- Use `git worktree remove -- <worktree-path>` without `--force`.
- Do not run `git clean` before worktree removal.
- Keep ownership, path, registration, local-HEAD, publication, remote-HEAD, and
  branch-deletion safeguards.
- Keep the second ordinary-status read before worktree removal.
- Keep the in-place recovery policy from issue #211 unchanged.
- Continue to decode and resume durable legacy `cleanup-pending` records.
- Do not add a setting, allowlist, dependency, or schema change.
- Do not change legacy recovery uses of `ignored-worktree-content`.

## Testing Value Gate

The new tests pass the Testing Value Gate. They protect destructive behavior, a
critical regression, race handling, phase consistency, and durable-state
compatibility. Each test can fail when Patchmill deletes ordinary work or
restores ignored-content blocking.

Do not add tests that compare documentation text. Use formatting, Markdown lint,
and the site build for documentation verification.

## File Structure

### Shared Git cleanup

- `src/git/planning-workspace-inspection.ts` owns ordinary status assessment and
  Git inspection commands.
- `src/git/planning-workspace-cleanup.ts` owns verified worktree and branch
  removal.
- `src/git/planning-workspaces.ts` owns the durable cleanup-state types and the
  live removal result.
- `src/git/planning-workspace-cleanup.test.ts` will own focused status and
  pre-removal guard tests.
- `src/git/planning-workspace-cleanup.real.test.ts` will own destructive
  behavior and late-race tests against real Git.

Keep the real cleanup tests separate from head-adoption tests. Cleanup and head
adoption have different destructive boundaries.

### Live phase flow and legacy compatibility

- `planning-phase-cleanup.ts` owns spec and plan cleanup checkpoints.
- `planning-finish.ts` owns implementation finish checkpoints.
- The planning publisher, reconciler, runners, and coordinator expose live phase
  outcomes.
- Existing cleanup-pending codecs, transitions, diagnostics, output, and
  publication helpers remain for legacy records.

This change removes branches from the production modules. No production-module
split is necessary.

### Pipeline and documentation

- `planning-pipeline-ignored-cleanup.test.ts` will prove normal implementation
  completion with representative ignored content.
- `planning-cleanup-pending-reconciliation.test.ts` will protect publication of
  legacy pending state.
- The Run-once, lifecycle, and cleanup-hook documentation will describe
  automatic ignored-content removal.

## Review Focus

1. An ignored file with an unknown name must be removed for each phase. Task 1
   adds a real-Git phase matrix.
2. A staged, tracked, or ordinary untracked file must block removal and remain
   on disk. Task 1 adds real-Git blocker cases.
3. An ordinary file created after the final status read must make Git refuse
   removal. Task 1 adds a race-injection test.
4. A legacy pending checkpoint must resume without replaying completed finish
   effects. Task 2 adds spec, plan, and implementation retry tests.
5. A successful implementation with ignored artifacts must not publish pending
   cleanup or apply `needs-info`. Task 1 adds a provider scenario.

---

### Task 1: Change the shared Git cleanup policy

**Files:**

- Rename: `src/git/planning-workspace-cleanup-pending.test.ts` to
  `src/git/planning-workspace-cleanup.test.ts`
- Create: `src/git/planning-workspace-cleanup.real.test.ts`
- Rename: `src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts`
  to `src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts`
- Modify: `src/git/planning-workspace-inspection.ts:19-47,165-180`
- Modify: `src/git/planning-workspace-cleanup.ts:18-69`
- Modify: `src/git/planning-workspace-git.test.ts:628-705`
- Test: `src/git/planning-workspace-cleanup.test.ts`
- Test: `src/git/planning-workspace-cleanup.real.test.ts`
- Test: `src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts`

**Interfaces:**

- Consumes:
  `PlanningWorkspaceOwnership<{ state: "ready" } | PlanningWorkspaceCleanupPending>`.
- Produces:
  `parsePlanningWorkspaceRemovalStatus(stdout): { ordinaryDirty: boolean }`.
- Produces: a `removeWorktree()` path that never returns ignored-content
  pending.
- Preserves: the broad live result type until Task 2 narrows its contract.

- [ ] **Step 1: Rename the tests for their new responsibilities**

```bash
git mv src/git/planning-workspace-cleanup-pending.test.ts \
  src/git/planning-workspace-cleanup.test.ts
git mv src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts
```

- [ ] **Step 2: Replace ignored-inventory parser tests with ordinary-status
      tests**

In `src/git/planning-workspace-cleanup.test.ts`, add these assertions:

```ts
assert.deepEqual(parsePlanningWorkspaceRemovalStatus(""), {
  ordinaryDirty: false,
});
assert.deepEqual(
  parsePlanningWorkspaceRemovalStatus(" M tracked.txt\0?? ordinary.txt\0"),
  { ordinaryDirty: true },
);
```

Keep a malformed NUL-record assertion. Update the late-status mock to return
only `{ ordinaryDirty: true }`.

- [ ] **Step 3: Add real-Git cleanup tests**

Create `src/git/planning-workspace-cleanup.real.test.ts` with an isolated
repository fixture. The fixture must record each Git argument list and support a
callback immediately before `git worktree remove`.

Add `normal removal deletes ignored-only worktrees for every phase`. Loop over
`spec`, `plan`, and `implementation`. Create `.env`, `build/output.bin`, and
`.unknown/operator.txt` as ignored files. Verify that ordinary porcelain status
is empty.

For the implementation case, pass a durable legacy cleanup input:

```ts
cleanup: {
  state: "cleanup-pending",
  reason: "ignored-worktree-content",
  ignoredPaths: [".env", "build/", ".unknown/"],
}
```

Assert these results:

```ts
assert.equal(result.kind, "removed");
await assert.rejects(access(worktreePath), { code: "ENOENT" });
assert.deepEqual(removeArgs, ["worktree", "remove", "--", worktreePath]);
assert.equal(
  calls.some((args) => args.includes("--ignored=matching")),
  false,
);
```

Add `ordinary changes remain on disk and block removal`. Cover tracked, staged,
and ordinary untracked files. Assert
`PlanningWorkspaceConflictError.reason === "dirty-worktree"` and verify that the
worktree still exists.

Add `normal Git removal preserves an ordinary file created after status`. Inject
`late.txt` immediately before the remove command. Assert a
`PlanningWorkspaceCommandError` for `worktree-remove`, no `--force` argument,
and the continued presence of `late.txt`.

In `planning-workspace-git.test.ts`, keep the existing tracked, staged, and
ordinary untracked cases. Remove the old ignored-content pending case because
the focused real-Git test now owns that behavior.

- [ ] **Step 4: Replace the old pipeline pending scenarios with normal
      completion coverage**

In `planning-pipeline-ignored-cleanup.test.ts`, retain representative paths such
as `.env`, `.pi/`, build output, test output, and an unknown directory. Run the
GitHub provider scenario with no planning review gates.

Assert these results:

```ts
assert.equal(result.status, "pr-created");
assert.deepEqual(scenario.issueSnapshot().labels, ["agent-done"]);
assert.equal((await scenario.state())?.phases.at(-1)?.status, "complete");
assert.equal(hasCleanupPendingCheckpoint, false);
assert.equal(hasCleanupPendingComment, false);
assert.equal(cleanupHookCalls, 1);
assert.equal(workspaceRemoveCalls, 1);
assert.equal(branchRemoveCalls, 1);
```

Do not inspect ignored bytes after completion. The removed worktree is the
deletion proof.

- [ ] **Step 5: Run the new tests and verify the old policy fails**

Run:

```bash
node --test \
  src/git/planning-workspace-cleanup.test.ts \
  src/git/planning-workspace-cleanup.real.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts
```

Expected: FAIL because ignored-only worktrees still return `cleanup-pending`.
The ordinary-content blocker cases must pass.

- [ ] **Step 6: Make removal status ordinary-only**

Change `PlanningWorkspaceRemovalStatus` to contain only `ordinaryDirty`. Keep
trailing-NUL validation for non-empty porcelain output.

Use this command in `removalStatus()`:

```ts
[
  "--no-optional-locks",
  "-C",
  path,
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
];
```

Remove `--ignored=matching`. Return `{ ordinaryDirty: stdout !== "" }` after
response validation.

- [ ] **Step 7: Remove ignored-content blocking from the shared cleanup layer**

Keep the second ordinary-status check in
`PlanningWorkspaceCleanupGit.removeWorktree()`. Remove the `ignoredPaths` result
branch. Then call:

```ts
await this.repository.run(
  ["worktree", "remove", "--", path],
  "worktree-remove",
);
```

Do not add `--force`. Do not clean the worktree first.

- [ ] **Step 8: Run focused behavior verification**

Run:

```bash
node --test \
  src/git/planning-workspace-cleanup.test.ts \
  src/git/planning-workspace-cleanup.real.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts
npm run check:contract-tests
```

Expected: PASS. The late-race test must leave `late.txt` until fixture teardown.

- [ ] **Step 9: Commit the shared cleanup change**

```bash
git add \
  src/git/planning-workspace-inspection.ts \
  src/git/planning-workspace-cleanup.ts \
  src/git/planning-workspace-cleanup.test.ts \
  src/git/planning-workspace-cleanup.real.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts
git commit -m "fix(git): remove ignored phase-worktree content"
```

### Task 2: Make live cleanup completion-only and retain legacy input

**Files:**

- Modify: `src/git/planning-workspaces.ts:21-84,209-222`
- Modify: `src/git/planning-workspaces.test.ts`
- Modify: `src/cli/commands/run-once/planning-finish.ts:1-31,129-181`
- Modify: `src/cli/commands/run-once/planning-finish.test.ts:9-65,243-340`
- Modify: `src/cli/commands/run-once/planning-phase-cleanup.ts:20-101`
- Modify: `src/cli/commands/run-once/planning-phase-cleanup.test.ts`
- Rename: `src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts` to
  `src/cli/commands/run-once/planning-phase-cleanup-legacy-pending.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.ts:30-49,245-270`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.test.ts`
- Modify:
  `src/cli/commands/run-once/planning-phase-reconciler.ts:40-57,151-173,233-259`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-shared.ts:38-67`
- Modify:
  `src/cli/commands/run-once/planning-phase-runner-planning.ts:55-85,260-276`
- Modify:
  `src/cli/commands/run-once/planning-phase-runner-implementation.ts:200-220`
- Modify: `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-coordinator.ts:9-32,52-75`
- Modify: `src/cli/commands/run-once/planning-phase-coordinator.test.ts`
- Create:
  `src/cli/commands/run-once/planning-cleanup-pending-reconciliation.test.ts`

**Interfaces:**

- Produces: `PlanningWorkspaceRemovalOutcome` with only
  `{ kind: "removed"; snapshot }`.
- Produces: implementation finish with only `kind: "complete"`.
- Produces: spec and plan cleanup with only `cleaned` or `remote-head-changed`.
- Preserves: `PlanningWorkspaceCleanupPending` as accepted durable input.
- Preserves: `PlanningCleanupPendingOutcome` for legacy publication
  reconciliation.

- [ ] **Step 1: Add a negative type contract for live removal**

Add this contract to `src/git/planning-workspaces.test.ts`:

```ts
const legacyPendingRemoval = {
  kind: "cleanup-pending",
  reason: "ignored-worktree-content",
  ignoredPaths: [".env"],
} as const;

// @ts-expect-error cleanup-pending is durable input, not live output
const invalidLiveRemoval: PlanningWorkspaceRemovalOutcome =
  legacyPendingRemoval;
void invalidLiveRemoval;
```

- [ ] **Step 2: Add legacy implementation retry coverage**

Extend the `state()` helper in `planning-finish.test.ts` to create a legacy
pending workspace. Set these finish checkpoints to `true`: cost publication,
visual evidence, handoff comment, and cleanup hook.

Add
`a legacy implementation cleanup-pending state completes without replaying finish effects`.
Assert:

```ts
assert.equal(result.kind, "complete");
assert.deepEqual(events, [
  "worktree",
  "branch",
  "ensureDoneLabel",
  "applyDoneLabels",
]);
assert.equal(finalPhase.status, "complete");
```

Keep the invalid-removal runtime test. Remove tests that ask a live fake
workspace to produce pending cleanup.

- [ ] **Step 3: Add legacy spec and plan retry coverage**

Rename the pending test file:

```bash
git mv \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-legacy-pending.test.ts
```

Replace its inventory-refresh scenario with
`spec and plan cleanup resume legacy pending state directly to removed`. Loop
over both planning phase kinds. Start each workspace in durable pending state.

Assert these values:

```ts
assert.equal(outcome.kind, "cleaned");
assert.deepEqual(events, ["worktree:cleanup-pending", "branch"]);
assert.deepEqual(checkpoints, ["worktree-removed", "removed"]);
assert.equal(current.workspace.cleanup.state, "removed");
```

Use the existing publication authorization shape. Verify the exact remote head
before removal.

- [ ] **Step 4: Add legacy publication-reconciliation coverage**

Create `planning-cleanup-pending-reconciliation.test.ts` with a minimal saved
implementation phase in pending cleanup. Call
`reconcilePlanningCleanupPendingPublication()` before coordinator execution.

Assert that the result retains the phase, reason, paths, and pull-request URL.
Also assert one cleanup-pending comment and one label change. This test protects
compatibility after live producers disappear.

- [ ] **Step 5: Run the type contract and verify that it fails**

Run:

```bash
npm run check:contract-tests
```

Expected: FAIL with an unused `@ts-expect-error`. The current live result still
accepts `cleanup-pending`.

- [ ] **Step 6: Narrow the live Git and finish results**

Change `PlanningWorkspaceRemovalOutcome` to:

```ts
export type PlanningWorkspaceRemovalOutcome = Readonly<{
  kind: "removed";
  snapshot: Extract<
    PlanningWorkspaceSnapshot,
    { state: "branch-only" | "missing" }
  >;
}>;
```

Keep the `removeWorktree()` input union unchanged. This preserves legacy pending
input in `PlanningWorkspaceLifecycle` and `PlanningWorkspaceGit`.

Change `PlanningImplementationFinishOutcome` to contain only `complete`. Replace
its removal switch with a runtime assertion for `removal.kind === "removed"`.
Keep the `worktree-removed` and `removed` checkpoints unchanged.

- [ ] **Step 7: Narrow spec and plan cleanup results**

Remove `cleanup-pending` from `PlanningPhaseCleanupOutcome`. Keep `ready` and
legacy `cleanup-pending` as accepted workspace states. After `removeWorktree()`,
require `kind === "removed"` and create the existing `worktree-removed`
checkpoint.

Remove impossible pending variants and branches from:

- `PlanningPhasePublicationResult` and `publishPlanningPhase()`;
- `PlanningPhaseReconciliation` and `reconcilePlanningPhase()`;
- `PlanningPhaseRunnerOutcome` and both phase runners; and
- the coordinator's phase-runner switch.

Keep `PlanningCleanupPendingOutcome` exported from
`planning-phase-runner-shared.ts`. Keep it in `PlanningCoordinatorOutcome`
because pre-coordinator legacy reconciliation can still return it.

Do not change these compatibility modules:

```text
planning-cleanup-pending.ts
planning-cleanup-pending-reconciliation.ts
result-output.ts
result-summary.ts
terminal-result.ts
result-diagnostic-*.ts
```

Do not change blocked-run recovery modules or their ignored-content policy.

- [ ] **Step 8: Update live-flow tests for the narrowed results**

Make these changes:

- In `planning-phase-publisher.test.ts`, make the saved pending-state case
  remove the worktree and branch, then return `published`.
- In `planning-phase-reconciler.test.ts`, start one open phase in legacy pending
  state. Assert `review-pending` after `worktree-removed` and `removed`
  checkpoints.
- Remove fake live pending outcomes from `planning-phase-runner.test.ts` and
  `planning-phase-coordinator.test.ts`.
- Keep invalid-removal tests in `planning-finish.test.ts` and
  `planning-phase-cleanup.test.ts`.
- Keep existing tests for changed remote HEAD, changed local HEAD, registration
  conflicts, missing worktrees, missing branches, and compare-and-swap deletion.

- [ ] **Step 9: Run focused compatibility and flow tests**

Run:

```bash
npm run check:contract-tests
node --test \
  src/git/planning-workspaces.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/git/planning-head-adoption-git.real.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-legacy-pending.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending-reconciliation.test.ts
npm run test:run-once
```

Expected: PASS. The negative type contract must compile only because pending
cleanup is not a live removal result.

- [ ] **Step 10: Inspect live producers and compatibility references**

Run:

```bash
rg -n 'cleanup-pending|ignored-worktree-content' \
  src/git/planning-workspaces.ts \
  src/cli/commands/run-once/planning-finish.ts \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-reconciler.ts \
  src/cli/commands/run-once/planning-phase-runner-shared.ts \
  src/cli/commands/run-once/planning-cleanup-pending-reconciliation.ts
```

Expected: pending cleanup remains as durable input and in legacy reconciliation.
No live removal, finish, publication, or reconciliation path creates it.

- [ ] **Step 11: Commit the live outcome and compatibility change**

```bash
git add \
  src/git/planning-workspaces.ts \
  src/git/planning-workspaces.test.ts \
  src/cli/commands/run-once/planning-finish.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-legacy-pending.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-runner-shared.ts \
  src/cli/commands/run-once/planning-phase-runner-planning.ts \
  src/cli/commands/run-once/planning-phase-runner-implementation.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending-reconciliation.test.ts
git commit -m "refactor(run-once): make phase cleanup completion-only"
```

### Task 3: Update operator documentation and run final verification

**Files:**

- Modify: `site/src/content/docs/using-patchmill/run-once.md:63-74,160-185`
- Modify: `site/src/content/docs/reference/agent-workflow-lifecycle.md:35-53`
- Modify: `site/src/content/docs/getting-started/configuration.md:169-190`

**Interfaces:**

- Consumes: the cleanup and compatibility contracts from Tasks 1 and 2.
- Produces: operator guidance for destructive phase cleanup and separate
  in-place recovery safety.

- [ ] **Step 1: Update the Run-once result and recovery guidance**

State that new ignored-only phase cleanup does not return `cleanup-pending`.
Explain that the result can still appear during reconciliation of state from an
older release.

State that Patchmill removes ignored content when ordinary status is clean. Keep
staged, tracked, and ordinary untracked content documented as blockers. Keep
non-destructive in-place recovery as a separate preservation policy.

Replace the current `Cleanup pending` operator row with a
`Legacy cleanup pending` row. Tell the operator to apply the configured ready
label and rerun. State that Patchmill rechecks ownership, HEAD, ordinary status,
and remote evidence.

- [ ] **Step 2: Update the lifecycle reference**

Document normal `git worktree remove` without `--force`. State that Git can
refuse an ordinary change that appears after the status check.

Document legacy pending-state resume. State that the retry does not replay a
completed cleanup hook or earlier finish effect.

- [ ] **Step 3: Update cleanup-hook guidance**

State that the hook owns external resources. State that phase cleanup owns
removal of worktree-local ignored files after ordinary status is clean.

Keep the hook checkpoint and idempotency guidance. Remove the instruction for an
operator cleanup round-trip after ignored-only content.

- [ ] **Step 4: Run documentation verification**

Run:

```bash
npx prettier --check \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/getting-started/configuration.md
npx markdownlint-cli2 \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/getting-started/configuration.md
npm run site:build
```

Expected: PASS with no format, Markdown, or site-build errors.

- [ ] **Step 5: Run focused behavior verification again**

Run:

```bash
node --test \
  src/git/planning-workspace-cleanup.test.ts \
  src/git/planning-workspace-cleanup.real.test.ts \
  src/git/planning-workspaces.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-legacy-pending.test.ts \
  src/cli/commands/run-once/planning-pipeline-ignored-cleanup.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending-reconciliation.test.ts
npm run test:run-once
```

Expected: PASS.

- [ ] **Step 6: Run repository-wide verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run site:build
git diff --check
if git diff --quiet origin/main...HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json; then
  echo "Nix build skipped: npm dependency metadata unchanged"
else
  nix build .#patchmill --print-build-logs
fi
```

Expected: PASS. If a command fails on the unchanged base, record the base
comparison and do not claim that the full suite passes.

The conditional Nix build implements the dependency gate from `AGENTS.md`. No
Nix build runs when npm dependency metadata is unchanged.

- [ ] **Step 7: Commit the documentation change**

```bash
git add \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/getting-started/configuration.md
git commit -m "docs(run-once): explain ignored worktree cleanup"
```

- [ ] **Step 8: Inspect the final implementation branch**

Run:

```bash
git status --short
git log --oneline --decorate -4
git diff --stat HEAD~3..HEAD
git diff --check HEAD~3..HEAD
```

Expected: the worktree is clean, the branch contains the three implementation
commits, and the complete range has no whitespace errors.
