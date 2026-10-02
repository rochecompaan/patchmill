# Reject unexpected outcomes and incomplete phase advancement

- **Issue:** #280
- **Status:** Proposed design

## Purpose and scope

The phase loop in `coordinatePlanningPhases()` must reject unexpected runner
outcomes and advancement without current-phase completion. Each runner response
must either end the call or complete the selected phase before another runner
call occurs.

This change protects the Run-once workflow. It does not change the long-lived
Coordinator, runner deadlines, or planning review gates.

Recovery of the preserved #262 implementation belongs to #262. Deadline changes
and implementation checkpoints belong to #263 and #265. This issue requires no
changes to those workflows or the preserved worktree.

CAUTION: Do not reset, clean, or remove the preserved #262 worktree. These
operations can erase unfinished work.

## Current behavior

`src/cli/commands/run-once/planning-phase-coordinator.ts` selects the first
incomplete phase and calls the injected `runPlanningPhase()` operation. It
returns supported terminal outcomes, then assigns `outcome.state`. No guard
verifies the remaining outcome kind or selected phase status.

An unknown kind with unchanged state repeats the phase. An `advanced` result
with unchanged incomplete state does the same. TypeScript declarations do not
prevent malformed injected results or test fixtures at runtime.

The current checkout still supports `cleanup-pending` as a terminal runner
outcome. The reported #262 hang concerns a partial implementation that removed
its handler. This design does not treat the unchanged checkout as that partial
implementation.

## Approach

The selected approach combines explicit, exhaustive outcome handling with a
completion guard. An exhaustive switch with a `never` check must expose an
unhandled declared result variant during type checking. Its default branch must
still throw at runtime for an unknown kind. It must not cast an unhandled result
to `never` to bypass the compiler.

Runtime guards without exhaustive handling stop malformed results but do not
expose future union changes during type checking. An iteration limit or longer
deadline only delays detection and can reject valid work. Neither alternative
replaces the selected contract checks.

## Required behavior

### Supported terminal outcomes

All supported terminal outcomes end the call without another runner call:

- `cleanup-pending`, `blocked`, and `complete` retain their existing
  pass-through results.
- `review-pending` retains its state, pull-request URL, and selected planning
  phase. An implementation phase still rejects this outcome.
- `stopped` retains its state and reason, with `nextPhase: "implementation"`.

This issue does not change `PlanningPhaseRunnerOutcome` or
`PlanningCoordinatorOutcome`. It retains `cleanup-pending` under the current
runner contract. A separate contract change must update exhaustive handling
without restoring obsolete live-result branches. Legacy recovery remains
supported.

### Advancement

Only `advanced` can continue the loop. Before the loop accepts its state, it
must require:

```ts
outcome.state.phases[phaseIndex]?.status === "complete";
```

`phaseIndex` is the index selected before the runner call. Completion of another
phase does not satisfy this requirement. A missing entry or any other status
must throw `Error("Phase reported advancement without completion")`.

After this requirement passes, the loop assigns the returned state and selects
the next incomplete phase through the existing phase plan. A revision change,
new state object, or intermediate checkpoint alone does not permit advancement.

### Unexpected outcomes and errors

An unrecognized outcome kind must throw
`Error("Unexpected phase-runner outcome")` before it accepts the returned state
or calls the runner again.

Both errors propagate through existing workflow error handling. The loop must
not retry, manufacture completion, or convert these errors into review stops.
The guards do not undo checkpoints that the runner already saved.

The state store retains responsibility for full state validation and ordered
transitions. No schema migration, new public result, or general result validator
is required. Artifact verification, cleanup authorization, completion
checkpoints, and required review gates remain unchanged.

## Affected components

- `src/cli/commands/run-once/planning-phase-coordinator.ts`: exhaustive dispatch
  and the current-phase completion guard.
- `src/cli/commands/run-once/planning-phase-coordinator.test.ts`: bounded
  regression coverage and terminal-outcome coverage.
- Existing phase-runner, reconciler, publisher, pipeline, and legacy recovery
  tests: compatibility verification, not unrelated behavior changes.

No dependency or configuration change is planned.

## Verification strategy

These automated tests pass the Testing Value Gate. They protect production
control flow and expose meaningful regressions without time-based assertions.

### Regression coverage

- An unknown outcome kind rejects with the expected error after one runner call.
- An `advanced` result with the selected phase still pending rejects after one
  runner call.
- An `advanced` result with a missing selected entry also rejects after one
  call.
- Completion of a different phase does not permit advancement.
- A valid `advanced` result passes its returned state to the next phase in
  order.
- Every supported terminal outcome preserves its result and ends after one call.
- Existing gate combinations, implementation review rejection, and plan-only
  behavior retain their contracts.

Invalid-result fakes must throw a distinct sentinel error on their second call.
Assertions must require the coordinator error and exactly one call. A sentinel
rejection cannot satisfy the expected error assertion. A regression therefore
fails promptly without an external timeout.

The valid-advancement fake must end with a supported terminal result and reject
unexpected calls. It must verify the selected phase index and returned state.

### Validation sequence

1. Run the focused coordinator tests with a short process-level safety limit.
2. Run the relevant phase-runner, reconciler, publisher, and pipeline tests.
3. Run legacy pending-state and cleanup compatibility tests.
4. Run the required project validation:

   ```sh
   npm run test:run-once
   npm test
   npm run lint
   npm run build
   ```

5. Run `npm run check:types` to verify exhaustive handling. Compare its
   diagnostics against the pre-implementation baseline. Require no new
   diagnostics in changed components.
6. Run `git diff --check`.

Short limits apply only to focused tests that normally finish in seconds. Full
suites and builds require adequate explicit deadlines. Existing CI validation
and review gates remain required.

## Acceptance

Invalid outcomes and false advancement fail after one runner call. Regression
tests terminate promptly without timeout enforcement. Valid advancement and
supported terminal behavior remain unchanged. Existing planning workflow and
legacy compatibility tests pass without weaker cleanup or review safeguards.
