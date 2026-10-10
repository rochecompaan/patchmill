# Planning Phase Outcome Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Run-once workflow after an unexpected runner outcome or
advancement without current-phase completion.

**Architecture:** `coordinatePlanningPhases()` uses an exhaustive switch over
the existing runner result union. Only `advanced` continues the loop after the
selected phase reaches `complete`. Bounded fake runners prove prompt rejection
and preserve terminal behavior.

**Tech Stack:** TypeScript, Node.js 24, `node:test`, `node:assert/strict`, npm,
ESLint, Prettier.

**Spec:**
`docs/specs/2026-10-02-issue-280-prevent-planning-coordinator-hangs-on-unexpected-outcomes-or-missing-progress-design.md`

## Global Constraints

- Use the active issue phase workspace. Do not create another worktree.
- Keep `PlanningPhaseRunnerOutcome` and `PlanningCoordinatorOutcome` unchanged.
- Retain `cleanup-pending` under the current runner contract, including legacy
  recovery.
- Preserve artifact verification, cleanup authorization, completion checkpoints,
  and required review gates.
- Keep the configured implementation workflow, agents, and required reviews.
- Add no dependency, configuration, schema, or general result-validator changes.
- Keep recovery for #262 and workflow changes for #263 and #265 outside this
  plan.
- CAUTION: Do not reset, clean, or remove the preserved #262 worktree. These
  operations can erase unfinished work.
- Propagate both coordinator errors through existing workflow error handling. Do
  not retry, manufacture completion, convert errors into review stops, or undo
  saved checkpoints.

## File Map

- Modify `src/cli/commands/run-once/planning-phase-coordinator.ts`: exhaustive
  outcome dispatch and the selected-phase completion guard.
- Modify `src/cli/commands/run-once/planning-phase-coordinator.test.ts`: bounded
  regression tests, advancement tests, and terminal compatibility tests.
- Read `src/cli/commands/run-once/planning-phase-runner-shared.ts`: the six
  supported result variants.
- Read `src/workflow/planning-state-types.ts` and
  `src/workflow/planning-pull-requests.ts`: phase statuses and ordered gate
  plans.
- Run existing phase-runner, reconciler, publisher, pipeline, and cleanup tests
  without unrelated edits.

## Review Focus

1. A missing selected entry in an `advanced` state must produce the completion
   error, not another loop error. Task 2 covers this input.
2. Completion of another phase must not permit advancement. Task 2 covers an
   earlier and a later completed phase.
3. A new state object, revision, or intermediate checkpoint must not count as
   completion. Task 2 covers these inputs.
4. A resumed completed prefix must use the selected index, not index zero. Task
   2 covers resumed advancement.
5. An implementation `review-pending` result must still reject. Task 1 covers
   this invalid terminal context.

## Testing Value Gate

The new tests prove production control flow, error handling, and state
propagation. Removing either guard causes a meaningful regression. These
reusable safety contracts justify test maintenance. No new test asserts
documentation, static configuration, or dependency versions.

Every invalid-result fake must throw `Error("Unexpected second runner call")` on
its second call. Require the exact coordinator error and `calls === 1`. The
sentinel error must not satisfy the error assertion. Terminal and
valid-advancement fakes must also reject calls beyond their expected count. Do
not use elapsed-time assertions or timeout-based test success.

## Planning Checkpoint

- [x] Prepare this plan for its plan-only commit.

Planning baseline at `900318f`: the three coordinator tests passed in about 0.12
seconds. Bounded probes reached a second call for an unknown kind, unchanged
advancement, and completion of another phase. `npm run check:types` exited zero
with no diagnostics. No implementation changes form part of this planning
checkpoint.

---

### Task 1: Reject unexpected outcomes with exhaustive terminal handling

**Files:** Modify the coordinator and its adjacent test file from the File Map.

**Interfaces:** Preserve
`coordinatePlanningPhases(input: PlanningPhaseCoordinatorInput): Promise<PlanningCoordinatorOutcome>`.
The injected `runPlanningPhase()` returns `Promise<PlanningPhaseRunnerOutcome>`.
This task handles all declared kinds without changing either union.

- [ ] **Step 1: Capture the pre-implementation type baseline.**

Run from the prepared issue worktree:

```sh
timeout --kill-after=30s 3600s npm run check:types > /tmp/patchmill-issue-280-types-before.log 2>&1
```

Record the exit status. Read the complete log. Expected from the planning
baseline: exit zero, no diagnostics. If baseline diagnostics exist, retain them
for comparison in Task 3.

- [ ] **Step 2: Add the bounded unknown-kind regression test.**

Name the test `rejects an unknown runner outcome after one call`. Use both
planning gates and an initial pending spec phase. Return
`{ kind: "unexpected", state: initial }` from the first call. Use a test-only
`unknown` cast to `PlanningPhaseRunnerOutcome` for this malformed result.

Use `run` as a zero-argument function that calls `coordinatePlanningPhases()`.
Assert:

```ts
await assert.rejects(run, {
  name: "Error",
  message: "Unexpected phase-runner outcome",
});
assert.equal(calls, 1);
```

- [ ] **Step 3: Extend terminal compatibility tests.**

Reuse the existing gate, cleanup, and plan-only tests. Add bounded cases for
missing coverage. Return a state distinct from the input state to expose
accidental state substitution. Assert the complete expected result, its state
identity, and exactly one call:

| Runner kind       | Required assertion                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `cleanup-pending` | `assert.strictEqual(actual, terminal)` preserves phase, URL, reason, and ignored paths.                                           |
| `blocked`         | `assert.strictEqual(actual, terminal)` preserves the blocked payload.                                                             |
| `complete`        | `assert.strictEqual(actual, terminal)` preserves the implementation result.                                                       |
| `review-pending`  | `assert.deepEqual(actual, { kind: "review-pending", state: returnedState, phase: selectedPhase, prUrl })` for both spec and plan. |
| `stopped`         | `assert.deepEqual(actual, { kind: "stopped", state: returnedState, reason: "plan-only", nextPhase: "implementation" })`.          |

For mapped results, also use `assert.strictEqual(actual.state, returnedState)`.
Keep `planOnly === true` propagation and all four gate combinations. Add
`rejects implementation review pending after one call` with this assertion:

```ts
await assert.rejects(run, {
  name: "Error",
  message: "Implementation pull request cannot be review-pending",
});
assert.equal(calls, 1);
```

- [ ] **Step 4: Run the coordinator tests before the code change.**

```sh
timeout --kill-after=5s 60s node --test src/cli/commands/run-once/planning-phase-coordinator.test.ts
```

Expected: the unknown-kind regression fails with the distinct sentinel error,
without a timeout. Terminal compatibility cases pass.

- [ ] **Step 5: Replace the outcome branches with an exhaustive switch.**

In `coordinatePlanningPhases()`, preserve the terminal mappings from Step 3.
Handle `advanced` explicitly. Keep the existing state assignment in that case
until Task 2 adds its guard. Use this default branch:

```ts
default: {
  const _exhaustive: never = outcome;
  throw new Error("Unexpected phase-runner outcome");
}
```

The local ESLint rules permit the `_exhaustive` name. Do not use `as never`,
suppression comments, or union changes to bypass exhaustiveness. Do not access
an unknown result's state before this error.

- [ ] **Step 6: Run the focused tests after the code change.**

Run the Step 4 command. Expected: all coordinator tests pass with no second call
in invalid or terminal cases.

- [ ] **Step 7: Verify exhaustive dispatch with strict type checking.**

```sh
timeout --kill-after=30s 3600s npm run check:types
```

Expected: exit zero for the current baseline, with no new diagnostics. An
unhandled declared variant must not pass the `never` assignment.

- [ ] **Step 8: Commit the exhaustive handling checkpoint.**

```sh
git add src/cli/commands/run-once/planning-phase-coordinator.ts src/cli/commands/run-once/planning-phase-coordinator.test.ts
git commit -m "fix(run-once): reject unexpected planning phase outcomes"
```

Record the commit and focused test result in
`issue-280-task-01-exhaustive-outcomes`.

### Task 2: Require selected-phase completion before advancement

**Files:** Modify the same coordinator and adjacent test file.

**Interfaces:** Consume Task 1's exhaustive dispatch. Preserve
`coordinatePlanningPhases(input: PlanningPhaseCoordinatorInput): Promise<PlanningCoordinatorOutcome>`.
Only `{ kind: "advanced"; state: PlanningStateV1 }` can continue the loop.

- [ ] **Step 1: Add bounded false-advancement regression cases.**

Name the test group `rejects advancement without selected-phase completion`.
Keep state fixtures local to the coordinator test file. Give the existing
`state(gates)` helper a `PlanningStateV1` return type through a test-only
`unknown` cast for its partial shape. Cast deliberately invalid phase shapes
only in tests.

Use these cases:

| Case                      | Initial selection                     | Returned state                                                                                      |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unchanged state           | Pending spec at index 0               | The same pending state.                                                                             |
| Revised state             | Pending spec at index 0               | A new object with a higher revision and the spec still pending.                                     |
| Intermediate checkpoints  | Spec at index 0                       | Selected status is `workspace-ready`, `branch-pushed`, or `pull-request-open`, one case per status. |
| Missing selected entry    | Plan at index 1 after a complete spec | Only the complete spec entry remains.                                                               |
| Different phase completes | Pending spec at index 0               | The plan at index 1 is complete, but the spec remains pending.                                      |
| Earlier phase complete    | Plan at index 1 after a complete spec | The spec remains complete, but the plan remains pending.                                            |

For each case, return `advanced` on the first call and throw the second-call
sentinel. Assert:

```ts
await assert.rejects(run, {
  name: "Error",
  message: "Phase reported advancement without completion",
});
assert.equal(calls, 1);
```

- [ ] **Step 2: Add valid-advancement coverage.**

Name the test `passes advanced state to the next phase in gate order`. Exercise
all four gate combinations. For each planning phase, return a new state with
that selected entry complete. End at an implementation `complete` result. Reject
any extra call.

Use these literal expected sequences, independent of `planningPhasePlan()`:

```ts
["implementation"];
["spec", "implementation"];
["plan", "implementation"];
["spec", "plan", "implementation"];
```

Assert each `phaseIndex`, `phase.kind`, and input state identity. Require each
next call to receive the exact state from the previous `advanced` result. Add a
resumed case with a complete spec prefix: indices `[1, 2]`, kinds
`["plan", "implementation"]`, and exactly two calls.

- [ ] **Step 3: Run the coordinator tests before the guard.**

Run Task 1's Step 4 command. Expected: false-advancement cases fail promptly.
Repeated selections reach the sentinel. The missing-entry case rejects with the
old loop error instead of the required completion error. Valid advancement
passes.

- [ ] **Step 4: Guard the selected entry in the `advanced` case.**

Before `state = outcome.state`, require the index selected before the runner
call:

```ts
if (outcome.state.phases[phaseIndex]?.status !== "complete") {
  throw new Error("Phase reported advancement without completion");
}
```

Keep selection of the next incomplete phase unchanged. Do not substitute
revision, object identity, another phase, or a loop counter for this
requirement.

- [ ] **Step 5: Run the tests without a process timeout.**

```sh
node --test src/cli/commands/run-once/planning-phase-coordinator.test.ts
```

Expected: all tests pass and terminate through their bounded runner logic. No
test depends on external timeout enforcement.

- [ ] **Step 6: Commit the completion guard checkpoint.**

```sh
git add src/cli/commands/run-once/planning-phase-coordinator.ts src/cli/commands/run-once/planning-phase-coordinator.test.ts
git commit -m "fix(run-once): require completion before phase advancement"
```

Record the commit and test results in `issue-280-task-02-completion-guard`.

### Task 3: Verify planning and legacy compatibility

**Files:** No new source files. Run the existing tests and validation commands.

**Interfaces:** Consume Tasks 1 and 2. Verify the unchanged runner and
coordinator contracts through the existing planning workflow. New automated
tests are not necessary for this validation-only task.

Run commands from the issue worktree root. Short limits apply only to focused
tests. The one-hour limits give full suites and builds explicit deadlines. Keep
tool deadlines sufficient for each command. A timeout is a validation error, not
evidence of correct rejection.

- [ ] **Step 1: Run the focused coordinator, runner, reconciliation,
      publication, and pipeline tests.**

```sh
timeout --kill-after=5s 60s node --test src/cli/commands/run-once/planning-phase-coordinator.test.ts
timeout --kill-after=5s 300s node --test \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-runner.real.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.real.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-pipeline.test.ts \
  src/cli/commands/run-once/planning-pipeline-scenarios.test.ts \
  src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
```

Expected: exit zero and no failed tests for each command. Run the second command
only after the first passes.

- [ ] **Step 2: Run saved pending-state and cleanup compatibility tests.**

```sh
timeout --kill-after=5s 300s node --test \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/workflow/planning-state-cleanup-pending.test.ts \
  src/git/planning-workspace-cleanup-pending.test.ts
```

Expected: exit zero and no failed tests. Preserve the existing legacy fixtures
and cleanup safeguards.

- [ ] **Step 3: Run the required Run-once suite.**

```sh
timeout --kill-after=30s 3600s npm run test:run-once
```

Expected: exit zero and no failed tests.

- [ ] **Step 4: Run the full project tests.**

```sh
timeout --kill-after=30s 3600s npm test
```

Expected: dependency checks, contract checks, and all tests pass with exit zero.

- [ ] **Step 5: Run project lint.**

```sh
timeout --kill-after=30s 3600s npm run lint
```

Expected: formatting, TypeScript lint, and Markdown lint pass with exit zero.

- [ ] **Step 6: Run the build.**

```sh
timeout --kill-after=30s 3600s npm run build
```

Expected: exit zero. The build uses `noCheck: true`, so it does not prove switch
exhaustiveness.

- [ ] **Step 7: Compare strict type diagnostics with Task 1's baseline.**

```sh
timeout --kill-after=30s 3600s npm run check:types > /tmp/patchmill-issue-280-types-after.log 2>&1
diff -u /tmp/patchmill-issue-280-types-before.log /tmp/patchmill-issue-280-types-after.log
```

Record the type-check exit status before the comparison. Read the complete log.
Require no new diagnostics, especially in changed components. The current
baseline requires exit zero. Do not weaken TypeScript checks or fix unrelated
baseline errors in this issue.

- [ ] **Step 8: Verify the final diff and record validation evidence.**

```sh
git diff --check
git diff 900318f -- src/cli/commands/run-once/planning-phase-coordinator.ts src/cli/commands/run-once/planning-phase-coordinator.test.ts
git status --short
```

Expected: no whitespace errors and no unrelated changes. Record command results,
checkpoint commits, and any remaining errors in
`issue-280-task-03-planning-compatibility-validation`. Close implementation
todos only after their work and validation finish. Keep `.pi/todos` out of
commits. Carry this plan and its source spec with implementation code, without a
separate planning pull request. Run-once owns publication and subsequent review
stops.
