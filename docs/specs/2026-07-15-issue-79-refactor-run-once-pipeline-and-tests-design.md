# Issue 79: run-once pipeline and test-module refactor design

## Context

Issue [#79](https://github.com/rochecompaan/patchmill/issues/79) calls out two
oversized run-once files:

- `src/cli/commands/run-once/pipeline.ts` is currently about 1,897 lines. It
  exports only `RunOneIssueOptions` and `runOneIssue()`, but it also owns
  selection diagnostics, lifecycle label helpers, workspace path policy,
  progress/step accounting, comment body builders, failure handling,
  implementation orchestration, finish/handoff, and cleanup.
- `src/cli/commands/run-once/pipeline.test.ts` is currently about 9,990 lines.
  It mixes shared fixtures, mock runner setup, issue payload builders, pipeline
  smoke tests, blocked-run recovery scenarios, implementation scenarios,
  comments, progress assertions, and finish/cleanup behavior.

The run-once directory already contains focused modules for lower-level pieces,
including `selection.ts`, `git.ts`, `planning-artifacts.ts`,
`stage-advancement.ts`, `development-environment-stage.ts`, `run-state.ts`,
`recovery.ts`, `progress.ts`, and prompt helpers. The refactor should use those
modules as stable dependencies and extract only the pipeline-specific glue that
currently makes `pipeline.ts` and `pipeline.test.ts` hard to scan.

Recent mainline work added more run-once behavior around blocked implementation
resume, bundled skill handling, artifact source extraction, and visual evidence.
That increases the need for stage-oriented seams before the next behavior change
lands.

## Goals

- Keep `pipeline.ts` as a thin facade exporting `runOneIssue()` and
  `RunOneIssueOptions`.
- Split pipeline-specific behavior into cohesive modules named by
  responsibility, not by vague helper buckets.
- Split the large test file along the same behavior seams as production code.
- Extract reusable test support so scenario tests read as behavior, not fixture
  construction.
- Preserve all current `run-once` behavior, public CLI behavior, run-state
  compatibility, progress events, comments, labels, and cleanup semantics.
- Make future changes reviewable by keeping most production modules under about
  200-400 lines, with stage modules allowed to reach about 400-600 lines during
  the initial split.
- Keep the final `pipeline.test.ts` as a small facade/smoke suite that proves
  the stages still connect end-to-end.

## Non-goals

- Do not change the run-once workflow state machine, label policy, prompt
  contracts, run-state schema, or issue-selection semantics.
- Do not rename public CLI options or alter `runOneIssue()`'s external result
  contract.
- Do not redesign lower-level modules such as `git.ts`, `stage-advancement.ts`,
  `planning-artifacts.ts`, `selection.ts`, or `prompts.ts` except where imports
  must be updated after extraction.
- Do not use line count alone as the split rule; each module must have one clear
  reason to change.
- Do not add npm dependencies.
- Do not combine behavior changes with the mechanical extraction work.

## Considered approaches

### Approach A: facade plus pipeline stage modules

Extract pipeline-specific responsibilities into named modules while keeping
`pipeline.ts` as orchestration glue. Each extracted module gets focused tests,
and `pipeline.test.ts` keeps only broad end-to-end coverage.

**Trade-offs:** This creates several new files and requires careful interfaces,
but it best matches the existing run-once architecture and the module-size goal.
It allows safe, behavior-preserving commits that reviewers can validate one seam
at a time.

### Approach B: split tests first, then production later

Move `pipeline.test.ts` into smaller files immediately without changing
production code, then extract production modules in a later pass.

**Trade-offs:** This reduces test-file pain quickly, but it leaves production
cognitive load untouched and risks creating tests around an oversized facade
rather than the desired seams.

### Approach C: single stage object or class

Move most of `runOneIssue()` into a `RunOncePipeline` class with methods for
selection, implementation, finish, and failures.

**Trade-offs:** This reduces the top-level function size, but it can hide the
same breadth of responsibilities behind shared mutable object state. It would be
easier to introduce ordering bugs and harder to unit-test pure helpers.

**Decision:** Use Approach A. Extract test support first as safety
infrastructure, then refactor production by coherent pipeline responsibility and
move tests to match each seam.

## Target architecture

`src/cli/commands/run-once/pipeline.ts` remains the public facade. It should
perform high-level orchestration only:

1. select or resume an issue;
2. verify preflight safety;
3. claim and start the issue when needed;
4. resolve/advance planning stages;
5. run implementation;
6. finish handoff/cleanup; and
7. route safety or unexpected failures to the failure handlers.

The facade should import the following focused modules.

| Module                       | Responsibility                                                                                                                                                                                                                                | Notes                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pipeline-lifecycle.ts`      | Label transitions, checkpoint defaults, lifecycle labels, saved implementation reconstruction, and direct-land checks.                                                                                                                        | Pure or mostly pure helpers. No host or filesystem side effects.                                    |
| `pipeline-comments.ts`       | Started, handoff, blocker, rejection, and unexpected-failure comment body text plus deterministic comment keys.                                                                                                                               | Comment formatting belongs here; posting comments belongs in failure/finish stages.                 |
| `pipeline-failures.ts`       | `blockIssue()` and `unexpectedFailure()` orchestration: comments, labels, run-state updates, progress, and final results.                                                                                                                     | Consumes `pipeline-comments.ts` and run-state helpers.                                              |
| `pipeline-workspace.ts`      | Configured worktree strategy/path helpers, clean-status ignore policy, expected issue workspace checks, and resume artifact root policy.                                                                                                      | Consumes lower-level `git.ts` and `worktree-strategy.ts`; does not own Git command implementations. |
| `pipeline-selection.ts`      | Pipeline-specific issue loading, merge ordering, approval-required handling, no-issue diagnostics, dry-run result shaping, resumable selection, and blocked-run recovery selection safety.                                                    | Consumes existing `selection.ts` for generic issue eligibility.                                     |
| `pipeline-progress.ts`       | Pipeline-local progress wrappers, simple step emission, log-path wrapping, step start/complete accounting, and Pi observation accounting.                                                                                                     | Consumes existing `progress.ts` reporters.                                                          |
| `pipeline-implementation.ts` | Implementation-stage orchestration: development-environment handoff, implementation prompt invocation, plan-task labels, todo progress, task step switching, Pi final-result validation, blocked result routing, and direct-land enforcement. | Does not perform finish/handoff cleanup.                                                            |
| `pipeline-finish.ts`         | Post-implementation finish path: todo completion assertion, visual evidence upload, handoff comment, done-label ensure/apply, final progress, cleanup hook, and workspace cleanup.                                                            | Consumes `pipeline-comments.ts`, `visual-evidence.ts`, `issue-todos.ts`, and Git cleanup helpers.   |

This split intentionally keeps lower-level modules in place. For example,
`stage-advancement.ts` should continue to own spec/plan stage advancement,
`planning-artifacts.ts` should continue to own artifact policy, and `git.ts`
should continue to own concrete Git operations.

## Production module contracts

The extracted modules should expose narrow interfaces. They do not need to match
these exact type names, but the implementation should keep the same boundaries.

### Lifecycle

`pipeline-lifecycle.ts` should export pure helpers used across stages:

- `nextLabels(labels, remove, add)`;
- `workflowTransition(labels, from, to)`;
- `lifecycleLabels(config, stage)`;
- `effectiveCheckpoints(state)`;
- `successfulImplementationFromState(state)`; and
- `assertDirectLandAllowed(config, result)`.

These helpers should not call the host, filesystem, Git, or Pi.

### Selection and preflight

`pipeline-selection.ts` should convert host issue lists, saved run-state data,
blocked recovery reports, approval policy, dry-run mode, and explicit issue
numbers into a single selected pipeline issue or a no-selection result. It
should return structured data rather than mutating the host directly.
`pipeline.ts` should decide when to claim, comment, or continue.

### Workspace policy

`pipeline-workspace.ts` should own only pipeline-specific workspace decisions:
configured strategy values, configured path mirroring inside worktrees, expected
workspace identity, ignored status paths, and planning artifact root selection
for resume. Concrete Git operations remain in `git.ts`.

### Progress and observations

`pipeline-progress.ts` should provide small functions/classes that make
implementation-stage progress accounting explicit. Pi observation handling
should become a named collaborator rather than nested closures inside
`runOneIssue()`.

### Implementation stage

`pipeline-implementation.ts` should return one of these stage outcomes:

- implementation already completed from resumable state;
- implementation produced `pr-created`;
- implementation produced `merged`;
- implementation blocked and the issue was transitioned through failure
  handling; or
- implementation returned an invalid final status and should flow to unexpected
  failure handling.

It should preserve current prompt inputs, resume context, development
environment handoff behavior, plan-task progress events, blocked result
handling, and validation of PR-created/merged/direct-land constraints.

### Finish stage

`pipeline-finish.ts` should accept a successful implementation result and
perform the existing finalization steps in the same order as today: todo
completion checks, implementation run-state persistence, visual evidence upload,
handoff comment, done-label ensure/apply, final progress event, cleanup hook,
and issue workspace cleanup.

## Test architecture

Create shared test support under `test-support/run-once/`:

- `issue-fixtures.ts` for `issue()`, `teaIssuePayload()`, `issueListPayload()`,
  `issueViewPayload()`, and `labelListPayload()`.
- `mock-runner.ts` for `createMockRunner()`, workflow Pi-call helpers, prompt
  path helpers, Pi result normalization helpers, and session helpers.
- `pipeline-fixtures.ts` for `makeConfig()`, approval policies, spec/plan helper
  fixtures, blocked recovery run-state setup, and scenario runners that are
  shared by multiple suites.
- `assertions.ts` for comment-body extraction, progress collection, normalized
  Pi-call assertions, and common Git containment result fixtures.

Split behavior tests into files that mirror production modules:

- `pipeline-lifecycle.test.ts` for pure label/checkpoint/saved-result helpers.
- `pipeline-comments.test.ts` for comment text and deterministic comment keys.
- `pipeline-failures.test.ts` for blocked and unexpected-failure side effects.
- `pipeline-workspace.test.ts` for configured path/strategy and resume workspace
  policy.
- `pipeline-selection.test.ts` for selection diagnostics, dry-run behavior,
  explicit issue behavior, and blocked recovery selection safety.
- `pipeline-progress.test.ts` for simple step/progress/Pi observation
  accounting.
- `pipeline-implementation.test.ts` for development-environment handoff,
  implementation prompt invocation, plan-task progress, blocked results, invalid
  final results, and direct-land enforcement.
- `pipeline-finish.test.ts` for visual evidence, handoff comments, done labels,
  cleanup hooks, and workspace cleanup.
- `pipeline.test.ts` for smoke orchestration only.

The final `pipeline.test.ts` should keep broad coverage for:

- no eligible issue;
- dry-run selected issue;
- plan-created;
- pr-created;
- merged or direct-land success where currently covered;
- blocked result;
- unexpected failure; and
- resume from saved blocked implementation state.

## Refactor order

1. Extract shared test support from `pipeline.test.ts` without changing
   production behavior. Run the existing pipeline tests after the move.
2. Extract pure lifecycle helpers and tests.
3. Extract comment formatting and failure handling.
4. Extract selection/preflight and workspace policy.
5. Extract progress/step accounting.
6. Extract implementation-stage orchestration.
7. Extract finish/handoff/cleanup orchestration.
8. Slim `pipeline.ts` and `pipeline.test.ts` to facade responsibilities and run
   full verification.

Each step should be behavior-preserving. If an extraction requires behavior
change to become possible, stop and write a separate issue or follow-up spec.

## Compatibility and migration

No user migration is required. Existing `patchmill run-once` behavior, run-state
files, issue comments, labels, generated spec/plan paths, prompt contracts,
progress JSONL format, and final JSON result statuses must remain compatible.

Internal imports will change, but `runOneIssue()` and `RunOneIssueOptions`
should continue to be exported from `src/cli/commands/run-once/pipeline.ts`.
Call sites outside the run-once command should not need to import the new
internal modules.

## Verification strategy

Run verification after each extraction task:

- Focused test for the module being extracted.
- `node --test src/cli/commands/run-once/pipeline.test.ts` while the facade
  suite still owns broad coverage.
- `npm run test:run-once` after major stage extraction and after final test
  split.

Final verification before merge:

- `npm run test:run-once`.
- `npm test`.
- `npm run lint`.
- `npm run build`.

Because this refactor must not change npm dependencies, a Nix build is not
required unless `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`
changes. If any npm dependency file changes accidentally, revert it; if a
legitimate dependency change becomes necessary, run the Nix build required by
`AGENTS.md`.

## Risks and mitigations

- **Behavior drift during mechanical moves:** keep commits small, move one seam
  at a time, and run focused plus facade tests after every extraction.
- **Circular imports:** keep `pipeline.ts` as the only high-level orchestrator;
  extracted modules should depend on lower-level modules and shared types, not
  on each other indiscriminately.
- **God test-support module:** split fixtures by audience and keep helpers named
  for domain concepts instead of generic utilities.
- **Progress accounting regressions:** isolate progress/observation code behind
  explicit tests before extracting implementation orchestration.
- **Finish-stage ordering bugs:** preserve the current order of run-state
  writes, visual evidence, handoff comment, labels, final progress, cleanup
  hook, and workspace cleanup in tests.
- **Oversplitting:** do not create one-file wrappers for tiny private helpers
  unless they serve a named behavior seam. If a new module is under about 40
  lines and used by only one caller, keep it local until the seam is clearer.
