# Run-once Pipeline Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the oversized run-once pipeline and test module into focused
production and test files without changing `patchmill run-once` behavior.

**Architecture:** Keep `src/cli/commands/run-once/pipeline.ts` as the public
facade for `runOneIssue()` and `RunOneIssueOptions`. Extract pipeline-specific
selection, lifecycle, workspace, progress, implementation, finish, comment, and
failure responsibilities into sibling modules, with tests split along the same
behavior seams and shared fixtures moved under run-once test support.

**Tech Stack:** TypeScript on Node.js 24, Node built-in test runner via
`npm test`, existing run-once host/runner fixtures, no npm dependency changes.

## Global Constraints

- Preserve the public exports `runOneIssue()` and `RunOneIssueOptions` from
  `src/cli/commands/run-once/pipeline.ts`.
- Preserve current `patchmill run-once` CLI behavior, run-state compatibility,
  issue comments, lifecycle labels, progress events, prompt inputs, cleanup
  behavior, and final result statuses.
- Do not change npm dependencies. If `package.json`, `package-lock.json`, or
  `npm-shrinkwrap.json` changes accidentally, revert it; if a legitimate npm
  dependency change becomes necessary, run the Nix build required by
  `AGENTS.md`.
- Keep extraction commits behavior-preserving. If a behavior change becomes
  necessary, stop and create a separate issue/spec for that change.
- Split by coherent responsibility, not by line count alone.
- Keep `pipeline.test.ts` as a small smoke/facade suite after behavior-specific
  tests move to focused files.

---

## File structure

- Create `test-support/run-once/issue-fixtures.ts`
  - Own issue payload builders currently embedded in `pipeline.test.ts`.
- Create `test-support/run-once/mock-runner.ts`
  - Own mock runner construction, Pi-call normalization, prompt path helpers,
    JSON status helpers, and Pi session helpers.
- Create `test-support/run-once/pipeline-fixtures.ts`
  - Own `makeConfig()`, approval policy helpers, shared scenario setup, and
    blocked recovery run-state setup.
- Create `test-support/run-once/assertions.ts`
  - Own comment extraction, progress collection, normalized Pi-call assertions,
    and Git containment result fixtures.
- Create `src/cli/commands/run-once/pipeline-lifecycle.ts`
  - Own label transitions, checkpoint defaults, lifecycle labels, saved
    implementation reconstruction, and direct-land checks.
- Create `src/cli/commands/run-once/pipeline-lifecycle.test.ts`
  - Unit-test lifecycle helpers.
- Create `src/cli/commands/run-once/pipeline-comments.ts`
  - Own started/handoff/blocker/rejection/unexpected-failure comment body text
    and deterministic failure comment keys.
- Create `src/cli/commands/run-once/pipeline-comments.test.ts`
  - Unit-test comment text and keys.
- Create `src/cli/commands/run-once/pipeline-failures.ts`
  - Own `blockIssue()` and `unexpectedFailure()` side-effect orchestration.
- Create `src/cli/commands/run-once/pipeline-failures.test.ts`
  - Cover blocked and unexpected-failure comments, labels, run state, progress,
    and final results.
- Create `src/cli/commands/run-once/pipeline-workspace.ts`
  - Own configured worktree strategy/path helpers, expected issue workspace
    checks, ignored status path policy, and resume artifact root policy.
- Create `src/cli/commands/run-once/pipeline-workspace.test.ts`
  - Unit-test configured path and workspace policy helpers.
- Create `src/cli/commands/run-once/pipeline-selection.ts`
  - Own pipeline-specific issue list loading, merge ordering, approval-required
    handling, dry-run result shaping, no-issue diagnostics, resumable selection,
    and blocked recovery selection safety.
- Create `src/cli/commands/run-once/pipeline-selection.test.ts`
  - Cover dry-run, explicit issue, no eligible issue, and recovery selection
    behavior.
- Create `src/cli/commands/run-once/pipeline-progress.ts`
  - Own simple step emission, log-path wrapping, step start/complete accounting,
    and Pi observation accounting.
- Create `src/cli/commands/run-once/pipeline-progress.test.ts`
  - Unit-test progress and observation accounting.
- Create `src/cli/commands/run-once/pipeline-implementation.ts`
  - Own development-environment handoff, implementation prompt invocation,
    plan-task labels, todo progress, implementation task step switching,
    blocked-result routing, final-result validation, and direct-land
    enforcement.
- Create `src/cli/commands/run-once/pipeline-implementation.test.ts`
  - Cover implementation-stage behavior moved out of the facade suite.
- Create `src/cli/commands/run-once/pipeline-finish.ts`
  - Own todo completion assertion, implementation run-state persistence, visual
    evidence upload, handoff comment, done labels, final progress, cleanup hook,
    and workspace cleanup.
- Create `src/cli/commands/run-once/pipeline-finish.test.ts`
  - Cover finish/handoff/cleanup behavior moved out of the facade suite.
- Modify `src/cli/commands/run-once/pipeline.ts`
  - Reduce to orchestration glue plus public exports.
- Modify `src/cli/commands/run-once/pipeline.test.ts`
  - Keep only broad smoke/facade scenarios.

---

### Task 1: Extract run-once pipeline test support

**Files:**

- Create: `test-support/run-once/issue-fixtures.ts`
- Create: `test-support/run-once/mock-runner.ts`
- Create: `test-support/run-once/pipeline-fixtures.ts`
- Create: `test-support/run-once/assertions.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Produces from `issue-fixtures.ts`: `issue()`, `teaIssuePayload()`,
  `issueListPayload()`, `issueViewPayload()`, and `labelListPayload()`.
- Produces from `mock-runner.ts`: `createMockRunner()`, `workflowPiCalls()`,
  `normalizeRecordedPiCall()`, `promptPath()`, `jsonStatus()`,
  `promptJsonPath()`, `defaultWorkflowPromptResult()`, `normalizePiResult()`,
  `fallbackPiResultForError()`, `writePiSessionMessage()`, `piSessionPath()`,
  `appendPiSessionEntry()`, `initializePiSession()`, `assistantToolCall()`,
  `delay()`, and `waitForCondition()`.
- Produces from `pipeline-fixtures.ts`: `specAndPlanApprovalPolicy()`,
  `approvalPolicy()`, `makeConfig()`, `runPlanApprovedImplementationScenario()`,
  `writeBlockedRecoveryRunState()`, and `blockedRecoveryRunner()`.
- Produces from `assertions.ts`: `commentBody()`, `collectProgressEvents()`,
  `gitBaseContainmentResult()`, and `gitBaseContainmentFailure()`.
- Consumes existing `pipeline.test.ts` helper bodies exactly; this task should
  not rewrite behavior.

- [ ] **Step 1: Snapshot the current facade test baseline**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS. If it fails, stop and inspect the pre-existing failure before
moving helpers.

- [ ] **Step 2: Move issue fixture helpers**

Move the exact current bodies of these functions from `pipeline.test.ts` into
`test-support/run-once/issue-fixtures.ts` and export them with the same
parameter and return types:

- `issue()`
- `teaIssuePayload()`
- `issueListPayload()`
- `issueViewPayload()`
- `labelListPayload()`

Do not change default field values, label arrays, timestamps, or payload shapes
while moving the code.

- [ ] **Step 3: Move mock runner and Pi session helpers**

Move the current mock runner and Pi session helper function bodies into
`test-support/run-once/mock-runner.ts`. Preserve the current names listed in the
Interfaces section so existing tests can import them without semantic changes.

- [ ] **Step 4: Move config/scenario fixtures**

Move approval policy helpers, `makeConfig()`, the plan-approved implementation
scenario helper, and blocked recovery helpers into
`test-support/run-once/pipeline-fixtures.ts`. Import lower-level helpers from
`issue-fixtures.ts`, `mock-runner.ts`, and existing run-once modules rather than
copying fixture code twice.

- [ ] **Step 5: Move assertion helpers**

Move comment/progress/Git containment helpers into
`test-support/run-once/assertions.ts`. Keep assertions deterministic and avoid
importing `pipeline.ts` from assertion helpers unless the current helper already
needs pipeline result types.

- [ ] **Step 6: Update `pipeline.test.ts` imports**

Replace local helper definitions with imports from the new support modules. The
remaining `pipeline.test.ts` test bodies should be textually close to the
original tests except for import paths and deleted helper definitions.

- [ ] **Step 7: Run the facade test**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit test-support extraction**

```bash
git add test-support/run-once src/cli/commands/run-once/pipeline.test.ts
git commit -m "test(run-once): extract pipeline test support"
```

---

### Task 2: Extract lifecycle helpers

**Files:**

- Create: `src/cli/commands/run-once/pipeline-lifecycle.ts`
- Create: `src/cli/commands/run-once/pipeline-lifecycle.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Produces: `nextLabels()`, `workflowTransition()`,
  `hasBlockedSavedWorkspaceState()`, `lifecycleLabels()`,
  `effectiveCheckpoints()`, `successfulImplementationFromState()`, and
  `assertDirectLandAllowed()`.
- Consumes existing types from `types.ts`, policy constants from
  `../../../policy/label-catalog.ts`, and run-state checkpoint types.

- [ ] **Step 1: Write lifecycle unit tests before moving helpers**

Create `pipeline-lifecycle.test.ts` with assertions that cover the current
helper behavior. Include at least these cases:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveCheckpoints,
  lifecycleLabels,
  nextLabels,
  workflowTransition,
} from "./pipeline-lifecycle.ts";

test("nextLabels removes old labels and appends new labels once", () => {
  assert.deepEqual(
    nextLabels(["agent:ready", "x"], ["agent:ready"], ["agent:done"]),
    ["x", "agent:done"],
  );
});

test("workflowTransition replaces one workflow state with another", () => {
  assert.deepEqual(
    workflowTransition(
      ["agent:planning", "area:cli"],
      "agent:planning",
      "agent:implementation",
    ),
    ["area:cli", "agent:implementation"],
  );
});

test("effectiveCheckpoints fills missing checkpoint flags with false", () => {
  assert.equal(effectiveCheckpoints({ claimed: true }).claimed, true);
  assert.equal(effectiveCheckpoints({}).startedCommentPosted, false);
});
```

Expected before implementation: FAIL because `pipeline-lifecycle.ts` does not
exist.

- [ ] **Step 2: Move pure lifecycle helpers**

Move `nextLabels`, `workflowTransition`, `hasBlockedSavedWorkspaceState`,
`lifecycleLabels`, `effectiveCheckpoints`, `successfulImplementationFromState`,
and `assertDirectLandAllowed` out of `pipeline.ts` into `pipeline-lifecycle.ts`.
Export each helper and update `pipeline.ts` imports.

- [ ] **Step 3: Add saved-result and direct-land tests**

Extend `pipeline-lifecycle.test.ts` to cover successful implementation
reconstruction from saved run state and direct-land rejection when the workflow
configuration does not allow a `merged` result.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-lifecycle.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit lifecycle extraction**

```bash
git add src/cli/commands/run-once/pipeline-lifecycle.ts src/cli/commands/run-once/pipeline-lifecycle.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "refactor(run-once): extract pipeline lifecycle helpers"
```

---

### Task 3: Extract comment formatting and failure handling

**Files:**

- Create: `src/cli/commands/run-once/pipeline-comments.ts`
- Create: `src/cli/commands/run-once/pipeline-comments.test.ts`
- Create: `src/cli/commands/run-once/pipeline-failures.ts`
- Create: `src/cli/commands/run-once/pipeline-failures.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- `pipeline-comments.ts` produces: `startedComment()`, `handoffComment()`,
  `questionText()`, `blockerComment()`, `errorMessage()`, `rejectionMessage()`,
  `unexpectedFailureComment()`, and `unexpectedFailureCommentKey()`.
- `pipeline-failures.ts` produces: `blockIssue()` and `unexpectedFailure()`.
- `pipeline-failures.ts` consumes host operations, progress reporters,
  `writeRunState()`, lifecycle labels, and comment helpers.

- [ ] **Step 1: Write comment tests**

Create `pipeline-comments.test.ts` by moving comment-body assertions out of
`pipeline.test.ts` or adding focused assertions for the exact current text.
Cover started comments, handoff comments, blocker questions, rejection messages,
and unexpected-failure comment keys.

Expected before implementation: FAIL because `pipeline-comments.ts` does not
exist.

- [ ] **Step 2: Move comment helpers**

Move the comment-formatting helpers from `pipeline.ts` into
`pipeline-comments.ts`. Update `pipeline.ts` to import them.

- [ ] **Step 3: Run comment tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-comments.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failure-handler tests**

Create `pipeline-failures.test.ts` using the extracted test-support fixtures.
Cover these existing behaviors:

- blocked results post the blocker comment, update labels, write blocked run
  state, and return a blocked pipeline result;
- unexpected failures post a deterministic failure comment, update failure
  state, and return an unexpected-failure result;
- safety errors still preserve actionable messages.

Expected before implementation: FAIL because `pipeline-failures.ts` does not
exist.

- [ ] **Step 5: Move failure orchestration**

Move `blockIssue()` and `unexpectedFailure()` from `pipeline.ts` into
`pipeline-failures.ts`. Pass all collaborators explicitly through an options
object so the module does not import `pipeline.ts`.

- [ ] **Step 6: Run failure and facade tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-comments.test.ts src/cli/commands/run-once/pipeline-failures.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit comments/failures extraction**

```bash
git add src/cli/commands/run-once/pipeline-comments.ts src/cli/commands/run-once/pipeline-comments.test.ts src/cli/commands/run-once/pipeline-failures.ts src/cli/commands/run-once/pipeline-failures.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "refactor(run-once): extract comments and failure handling"
```

---

### Task 4: Extract workspace and selection policy

**Files:**

- Create: `src/cli/commands/run-once/pipeline-workspace.ts`
- Create: `src/cli/commands/run-once/pipeline-workspace.test.ts`
- Create: `src/cli/commands/run-once/pipeline-selection.ts`
- Create: `src/cli/commands/run-once/pipeline-selection.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- `pipeline-workspace.ts` produces: `cleanStatusIgnoredPaths()`,
  `configuredWorktreeDir()`, `configuredPathRelativeToRepo()`,
  `mirrorConfiguredPathInWorktree()`, `resumePlanningArtifactPolicy()`,
  `configuredWorktreeStrategy()`, and `expectedIssueWorkspace()`.
- `pipeline-selection.ts` produces: `stringArray()`, `visualEvidenceArray()`,
  `emitSelectionDiagnostics()`, `selectResumableIssue()`, `mergeIssueLists()`,
  and `loadSelectionIssues()`.
- Both modules consume existing lower-level modules and shared types, not
  `pipeline.ts`.

- [ ] **Step 1: Write workspace policy tests**

Create `pipeline-workspace.test.ts` with focused tests for configured worktree
strategy, path mirroring inside issue worktrees, clean-status ignored paths, and
expected issue workspace identity.

Expected before implementation: FAIL because `pipeline-workspace.ts` does not
exist.

- [ ] **Step 2: Move workspace helpers**

Move workspace/path helpers from `pipeline.ts` into `pipeline-workspace.ts` and
update imports. Keep concrete Git command execution in `git.ts`.

- [ ] **Step 3: Run workspace tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-workspace.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write selection tests**

Create `pipeline-selection.test.ts` by moving relevant facade tests and adding
focused tests for no eligible issue diagnostics, dry-run selected issue results,
explicit issue loading, resumable issue ordering, and blocked recovery selection
safety.

Expected before implementation: FAIL because `pipeline-selection.ts` does not
exist.

- [ ] **Step 5: Move selection helpers**

Move selection/preflight helpers from `pipeline.ts` into
`pipeline-selection.ts`. Keep generic eligibility rules in existing
`selection.ts`.

- [ ] **Step 6: Run selection and facade tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-selection.test.ts src/cli/commands/run-once/pipeline-workspace.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit workspace/selection extraction**

```bash
git add src/cli/commands/run-once/pipeline-workspace.ts src/cli/commands/run-once/pipeline-workspace.test.ts src/cli/commands/run-once/pipeline-selection.ts src/cli/commands/run-once/pipeline-selection.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "refactor(run-once): extract workspace and selection policy"
```

---

### Task 5: Extract pipeline progress and Pi observation accounting

**Files:**

- Create: `src/cli/commands/run-once/pipeline-progress.ts`
- Create: `src/cli/commands/run-once/pipeline-progress.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Produces: `progress()`, `emitSimpleStep()`, `withLogPath()`,
  `createStepAccounting()`, and `recordPiObservation()` or equivalent names that
  make the current nested step-accounting behavior testable.
- Consumes existing `ProgressReporter`, `AgentIssueProgressEvent`, and Pi
  observation result types.

- [ ] **Step 1: Write progress accounting tests**

Create `pipeline-progress.test.ts` with tests for simple step start/complete
emission, log path enrichment, active step completion when a new step starts,
assistant usage accounting, and tool-call accounting on active implementation
steps.

Expected before implementation: FAIL because `pipeline-progress.ts` does not
exist.

- [ ] **Step 2: Move progress wrappers and step accounting**

Move `progress`, `emitSimpleStep`, `withLogPath`, and the step-accounting/Pi
observation closure logic from `runOneIssue()` into `pipeline-progress.ts`.
Return a small stateful object from the new module so `pipeline.ts` and later
stage modules can call explicit methods instead of sharing nested closures.

- [ ] **Step 3: Run progress and facade tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-progress.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit progress extraction**

```bash
git add src/cli/commands/run-once/pipeline-progress.ts src/cli/commands/run-once/pipeline-progress.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "refactor(run-once): extract pipeline progress accounting"
```

---

### Task 6: Extract implementation-stage orchestration

**Files:**

- Create: `src/cli/commands/run-once/pipeline-implementation.ts`
- Create: `src/cli/commands/run-once/pipeline-implementation.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Produces:

```ts
export type PipelineImplementationStageResult =
  | {
      kind: "implemented";
      result: AgentIssuePrCreatedResult | AgentIssueMergedResult;
    }
  | {
      kind: "already-implemented";
      result: AgentIssuePrCreatedResult | AgentIssueMergedResult;
    }
  | { kind: "blocked"; result: AgentIssuePipelineResult }
  | { kind: "unexpected"; error: Error };

export async function runPipelineImplementationStage(
  options: PipelineImplementationStageOptions,
): Promise<PipelineImplementationStageResult>;
```

- Consumes planning-stage output, `AgentIssueConfig`, host, runner, progress
  accounting, lifecycle helpers, failure handlers, development-environment
  stage, issue-todo helpers, plan-task helpers, prompt helpers, and run-state
  helpers.

- [ ] **Step 1: Write implementation-stage characterization tests**

Create `pipeline-implementation.test.ts` by moving implementation-specific tests
from the facade suite. Cover development-environment handoff, implementation
prompt invocation, plan-task progress switching, blocked result routing, invalid
final statuses, `pr-created`, `merged`, and direct-land enforcement.

Expected before implementation: FAIL because `pipeline-implementation.ts` does
not exist.

- [ ] **Step 2: Define the stage options/result types**

Add explicit option and result types to `pipeline-implementation.ts`. Include
only collaborators required by the implementation stage. If an option list grows
unwieldy, group related collaborators under `runtime`, `issue`, `planning`,
`progress`, and `persistence` properties rather than importing the facade.

- [ ] **Step 3: Move implementation orchestration code**

Move the implementation-specific section of `runOneIssue()` into
`runPipelineImplementationStage()`. Preserve the current order of development
handoff, progress setup, prompt invocation, Pi observation capture, blocked
routing, final status validation, direct-land checks, and run-state updates.

- [ ] **Step 4: Update `pipeline.ts` to call the stage**

Replace the moved section with a single call to
`runPipelineImplementationStage()`. Route `blocked` and `unexpected` stage
outcomes exactly as the current inline code does.

- [ ] **Step 5: Run implementation and facade tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-implementation.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit implementation-stage extraction**

```bash
git add src/cli/commands/run-once/pipeline-implementation.ts src/cli/commands/run-once/pipeline-implementation.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "refactor(run-once): extract implementation stage"
```

---

### Task 7: Extract finish, handoff, and cleanup orchestration

**Files:**

- Create: `src/cli/commands/run-once/pipeline-finish.ts`
- Create: `src/cli/commands/run-once/pipeline-finish.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Produces:

```ts
export type PipelineFinishStageResult =
  | { kind: "finished"; result: AgentIssuePipelineResult }
  | { kind: "unexpected"; error: Error };

export async function runPipelineFinishStage(
  options: PipelineFinishStageOptions,
): Promise<PipelineFinishStageResult>;
```

- Consumes successful implementation result, issue context, host, progress
  reporter, lifecycle labels, comment helpers, visual evidence helpers,
  issue-todo helpers, cleanup hook helpers, workspace cleanup helpers, and
  run-state persistence.

- [ ] **Step 1: Write finish-stage characterization tests**

Create `pipeline-finish.test.ts` by moving finish-specific tests from the facade
suite. Cover todo completion assertion, implementation run-state persistence,
visual evidence upload/reference validation, handoff comment, done label
ensure/apply, final progress event, cleanup hook results, and workspace cleanup.

Expected before implementation: FAIL because `pipeline-finish.ts` does not
exist.

- [ ] **Step 2: Move finish orchestration code**

Move the post-implementation success path from `runOneIssue()` into
`runPipelineFinishStage()`. Preserve the current operation order so comments,
labels, progress events, run-state writes, and cleanup remain compatible.

- [ ] **Step 3: Update `pipeline.ts` to call the finish stage**

Replace the moved finish block with `runPipelineFinishStage()`. Keep failure
routing in the facade so safety and unexpected errors still flow through the
same top-level catch behavior.

- [ ] **Step 4: Run finish and facade tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-finish.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit finish-stage extraction**

```bash
git add src/cli/commands/run-once/pipeline-finish.ts src/cli/commands/run-once/pipeline-finish.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "refactor(run-once): extract finish stage"
```

---

### Task 8: Slim facade tests and run final verification

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify focused test files created in Tasks 2-7 as needed.
- Modify: `src/cli/commands/run-once/pipeline.ts`

**Interfaces:**

- `pipeline.test.ts` remains a facade smoke suite for broad orchestration.
- Focused test files own detailed behavior assertions for their production
  modules.

- [ ] **Step 1: Move remaining behavior-specific tests out of
      `pipeline.test.ts`**

Keep only these broad scenarios in `pipeline.test.ts`:

- no eligible issue;
- dry-run selected issue;
- plan-created;
- pr-created;
- current merged/direct-land smoke coverage;
- blocked result;
- unexpected failure; and
- saved blocked implementation resume.

Move all other detailed assertions to the focused test file that matches the
behavior under test.

- [ ] **Step 2: Check file sizes and public facade shape**

Run this command and inspect the output:

```bash
node -e 'const fs=require("fs"); for (const f of fs.readdirSync("src/cli/commands/run-once").filter(f=>/^pipeline.*\\.ts$/.test(f)).sort()) { const p="src/cli/commands/run-once/"+f; console.log(`${p}: ${fs.readFileSync(p,"utf8").split(/\\r?\\n/).length} lines`); }'
```

Expected: `pipeline.ts` is a thin facade, `pipeline.test.ts` is far smaller than
its original 9,990 lines, and oversized stage modules have clear
responsibilities or are split further before final verification.

- [ ] **Step 3: Run run-once tests**

Run:

```bash
npm run test:run-once
```

Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Verify npm dependency files did not change**

Run:

```bash
git diff -- package.json package-lock.json npm-shrinkwrap.json
```

Expected: no output. If there is output, revert accidental dependency-file
changes. If a real dependency change was introduced intentionally, run the Nix
build required by `AGENTS.md` before merging.

- [ ] **Step 8: Commit final facade cleanup**

```bash
git add src/cli/commands/run-once
git commit -m "refactor(run-once): slim pipeline facade and tests"
```
