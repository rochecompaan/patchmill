# Prevent Approval-Wait Queue Starvation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure automatic `patchmill run-once` skips approval-wait Issues and
continues to the next facade-ranked candidate when a pinned legacy candidate is
safely rejected before mutation.

**Architecture:** Add an automatic-only approval-wait gate at the beginning of
facade choice construction, before planning or Run recovery state is read. Give
the internal pinned legacy handoff a discriminated pre-mutation rejection
result, then let the public facade exclude that Issue and re-run its existing
ranking over the original open-Issue snapshot; all substantive, failing,
explicit, dry-run, and planning-pipeline outcomes remain terminal.

**Tech Stack:** TypeScript ESM, Node.js and `node:test`, existing Patchmill
workflow-state/selection/lease contracts, Prettier, ESLint, and the TypeScript
build; no new dependency.

**Spec:**
`docs/specs/2026-09-20-issue-256-run-once-starves-fresh-issues-when-the-top-ranked-legacy-resume-is-in-an-approval-wait-state-no-fallback-after-pinning-design.md`

## Global Constraints

- Use **Run-once workflow**, **Issue run**, **Run attempt**, and **Run recovery
  state** as defined by `CONTEXT.md`.
- In automatic mode, a resolved `waiting-spec-review` or `waiting-plan-review`
  state is absolutely ineligible, even when stale labels also include
  `agent-ready`, `in-progress`, or a high-priority label.
- Apply the approval-wait exclusion before reading candidate-specific planning
  state or Run recovery state; malformed state on a waiting Issue must not block
  unrelated work.
- Do not require ready or approved labels for every owned active workflow. A
  resolved `not-actionable` state remains eligible for the existing active
  planning/legacy ownership rules; only approval-wait states gain the new
  automatic exclusion.
- Preserve the existing planning, legacy, and fresh-planning workflow ranks,
  configured priority-label order, and Issue-number tie-break among remaining
  candidates.
- Preserve active owned planning and ordinary legacy recovery when neither is
  waiting for approval, and preserve approved finished legacy planning
  workspaces as higher-ranked legacy resumes.
- Fall back only from a pinned legacy rejection explicitly classified before Git
  preflight, claim/label mutation, agent execution, or any other Issue effect.
  Release an acquired Issue run lease before choosing another Issue.
- Treat `blocked`, `error`, `review-pending`, `stopped`, cleanup, success,
  exceptions, and every other substantive result as terminal for the Run
  attempt. Planning-pipeline identity/lock failures never trigger fallback.
- Keep explicit `--issue` single-target and fail-fast, including its existing
  `approval-required` diagnostic. Keep dry-run on the existing full-list legacy
  path.
- Retain the initial open-Issue snapshot, reject each candidate at most once,
  and perform at most one substantive Run-once workflow per invocation.
- Do not change public result schemas, planning-state schemas, Run recovery
  state schemas, approval policy, label names, dependencies, configuration,
  coordinator behavior, issue #252 adoption, or issue #255 stale-lock recovery.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If implementation unexpectedly retains an npm dependency metadata change, run
  the Nix build required by `AGENTS.md`.

---

## File and Module Map

- `src/cli/commands/run-once/planning-selection.ts` — resolve workflow state at
  the top of automatic choice construction and omit only approval-wait Issues
  before candidate-specific state reads; retain existing rank calculation.
- `src/cli/commands/run-once/pipeline-legacy.ts` — classify the existing
  pre-mutation `no-issue`/`approval-required` exits for the internal pinned
  handoff and carry that classification across Issue-run lease release without
  changing ordinary legacy callers or public result objects.
- `src/cli/commands/run-once/pipeline.ts` — keep the initial Issue snapshot and
  bounded rejected-Issue set, reselect after a safe automatic legacy rejection,
  and return every other outcome immediately.
- `src/cli/commands/run-once/planning-selection.test.ts` — cover waiting-state
  precedence, early filtering across choice branches, approved resume behavior,
  and unchanged active-work ranking.
- `src/cli/commands/run-once/planning-pipeline-facade.test.ts` — drive the
  public non-dry facade through fallback, priority re-ranking, lease release,
  exhaustion, explicit selection, substantive completion, and exception paths.

No new production module is warranted: `planning-selection.ts` remains a
cohesive selector, `pipeline.ts` remains the small public orchestration facade,
and the legacy classification belongs beside its existing pinned entry point.
Although `pipeline-legacy.ts` is already large, this change adds only a narrow
entry/exit contract and does not mix a broad extraction refactor with the bug
fix. Keep new facade tests grouped by fallback behavior with small local fixture
helpers if the test module approaches the test-file size threshold.

## Interfaces

Use these shapes consistently across Tasks 1 and 2.

```ts
// planning-selection.ts: automatic selection admits actionable and owned
// not-actionable workflows, but never either approval-wait state.
function automaticWorkflowStateEligible(
  issue: IssueSummary,
  config: AgentIssueConfig,
): boolean {
  const state = resolveWorkflowState(issue.labels, {
    readyLabel: lifecycleLabels(config).ready,
    policy: config.approvalPolicy,
  });
  return isActionableWorkflowState(state) || state.kind === "not-actionable";
}
```

```ts
// pipeline-legacy.ts: internal contract only; result remains a normal public
// AgentIssuePipelineResult when pipeline.ts unwraps it.
export type LegacySelectionRunResult =
  | { kind: "pipeline-result"; result: AgentIssuePipelineResult }
  | {
      kind: "selection-rejected";
      result: AgentIssuePipelineResult & {
        status: "no-issue" | "approval-required";
      };
    };
```

```ts
// pipeline.ts: one fixed candidate snapshot and one bounded rejection set.
const rejectedIssueNumbers = new Set<number>();
while (true) {
  const candidates = issues.filter(
    (issue) => !rejectedIssueNumbers.has(issue.number),
  );
  const selected = await selectRunOnceWorkflow(
    candidates,
    config,
    planningState,
    options.now?.toISOString(),
  );
  // Existing non-legacy cases return immediately.
  // Only automatic selection-rejected adds the selected Issue and continues.
}
```

## Testing Value Gate

The planned automated tests are required and pass Patchmill's Testing Value
Gate:

- They prove queue liveness, stable ranking, pre-mutation safety, and public
  Run-once workflow behavior rather than restating source or configuration.
- They fail for meaningful regressions: review labels overriding readiness,
  waiting state files blocking unrelated work, a rejected pin ending the Run
  attempt, retry loops, priority drift, unreleased leases, explicit-selection
  fallback, or a second dispatch after effects/failure.
- Maintainers can rerun them whenever facade selection, legacy revalidation,
  approval gates, or lease boundaries change.
- The behavior is reusable and high-risk because a single Issue can otherwise
  starve every open Issue and because unsafe fallback could process two Issues
  in one Run attempt.

Do not add tests for static label configuration, dependency versions, plan text,
or the mere presence of the new type. Verify those directly through typecheck,
lint, build, and final diff inspection.

---

### Task 1: Exclude Approval-Wait Issues Before Facade State Reads

**Files:**

- Modify: `src/cli/commands/run-once/planning-selection.test.ts`
- Modify: `src/cli/commands/run-once/planning-selection.ts:142-243`

**Interfaces:**

- Consumes: `resolveWorkflowState()`, `isActionableWorkflowState()`,
  `lifecycleLabels()`, the existing `IssueSummary` and `AgentIssueConfig`, and
  the automatic/explicit distinction in `config.issueNumber`.
- Produces: `automaticWorkflowStateEligible(issue, config): boolean`, used only
  as the first automatic filter inside `selectRunOnceWorkflow()`; no exported
  API or rank changes.

- [ ] **Step 1: Add the approval-policy selection fixture**

  In `planning-selection.test.ts`, define a local approval-enabled config beside
  the existing `config` so every new case uses the real configured review and
  approved labels:

  ```ts
  const approvalConfig = {
    ...config,
    approvalPolicy: {
      specApproval: {
        kind: "spec",
        required: true,
        reviewLabel: "spec-review",
        approvedLabel: "spec-approved",
      },
      planApproval: {
        kind: "plan",
        required: true,
        reviewLabel: "plan-review",
        approvedLabel: "plan-approved",
      },
    },
  } as never;
  ```

  Reuse this fixture rather than duplicating the policy inside each test. Keep
  all temporary Run recovery state under `mkdtemp()` and remove it in `finally`.

- [ ] **Step 2: Write the failing legacy-starvation and approval-resume tests**

  Write one table-driven test for both approval phases. For each row, persist a
  finished legacy planning workspace for Issue 272, then select it alongside a
  fresh ready Issue 327:

  ```ts
  for (const [reviewLabel, approvedLabel] of [
    ["spec-review", "spec-approved"],
    ["plan-review", "plan-approved"],
  ] as const) {
    const waiting = await selectRunOnceWorkflow(
      [
        issue(272, ["agent-ready", reviewLabel, "priority:high"]),
        issue(327, ["agent-ready", "priority:low"]),
      ],
      { ...approvalConfig, runStateDir },
      planningState,
    );
    assert.equal(waiting.kind, "fresh-planning");
    if (waiting.kind === "fresh-planning")
      assert.equal(waiting.issue.number, 327);

    const approved = await selectRunOnceWorkflow(
      [
        issue(272, ["agent-ready", reviewLabel, approvedLabel]),
        issue(327, ["agent-ready"]),
      ],
      { ...approvalConfig, runStateDir },
      planningState,
    );
    assert.equal(approved.kind, "legacy");
    if (approved.kind === "legacy") assert.equal(approved.issue.number, 272);
  }
  ```

  The waiting assertions prove workflow state outranks stale readiness,
  priority, and legacy rank. The approved assertions protect the existing
  higher-ranked resume path.

- [ ] **Step 3: Write the failing early-filter and branch-coverage tests**

  Add a focused test whose planning-state test double records reads and throws
  if the waiting Issue is inspected. Give Issue 272 an active-looking planning
  state and contradictory `agent-ready + spec-review` labels, and give Issue 327
  ordinary ready labels:

  ```ts
  const reads: number[] = [];
  const result = await selectRunOnceWorkflow(
    [issue(272, ["agent-ready", "spec-review"]), issue(327, ["agent-ready"])],
    approvalConfig,
    {
      path: (number) => `issue-${number}.json`,
      read: async (number) => {
        reads.push(number);
        if (number === 272)
          throw new Error("approval-wait state must not be read");
        return undefined;
      },
    } as never,
  );
  assert.equal(result.kind, "fresh-planning");
  assert.deepEqual(reads, [327]);
  ```

  Add a separate fresh-choice case with no state files and
  `agent-ready + plan-review` on the waiting Issue so the review label cannot
  enter through the fresh branch. Retain or extend the existing active-planning
  priority test to assert a `not-actionable` owned workflow (for example, no
  ready/review/approved label but active state) still outranks fresh work.

  Finally, call the selector with `issueNumber: 272` and stale
  `agent-ready + spec-review` labels plus the finished legacy state. Assert it
  still returns `kind: "legacy"`; the explicit pinned legacy path must remain
  able to produce its existing `approval-required` diagnostic rather than
  silently choose Issue 327.

- [ ] **Step 4: Run the focused selector test and verify the red state**

  Run:

  ```sh
  node --test src/cli/commands/run-once/planning-selection.test.ts
  ```

  Expected before implementation: FAIL because the finished legacy waiting Issue
  wins or the selector reads the waiting Issue's planning state and returns
  `invalid-planning-state`. Existing selector tests should remain green.

- [ ] **Step 5: Add the automatic-only workflow-state gate**

  In `planning-selection.ts`, add `automaticWorkflowStateEligible()` from
  **Interfaces** near the other private eligibility helpers. At the beginning of
  the `for` loop, after the explicit-Issue and open-state checks but before
  `planningState.read()` or `readRunState()`, add:

  ```ts
  if (
    config.issueNumber === undefined &&
    !automaticWorkflowStateEligible(issue, config)
  )
    continue;
  ```

  Do not replace this with a blanket actionable-only condition:
  `state.kind === "not-actionable"` must continue into existing active-owned
  workflow logic. Do not move the check below planning/legacy state reads and do
  not alter the per-branch lifecycle, cleanup, conflict, or ranking rules.

- [ ] **Step 6: Run selector and legacy selection regression tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-selection.test.ts \
    src/cli/commands/run-once/pipeline-selection-scenarios.test.ts
  ```

  Expected: PASS. Waiting Issues are omitted before state access, approved
  resumes remain legacy choices, explicit selection remains pinned, and ordinary
  active recovery behavior is unchanged.

- [ ] **Step 7: Commit the aligned automatic eligibility contract**

  ```sh
  git add \
    src/cli/commands/run-once/planning-selection.ts \
    src/cli/commands/run-once/planning-selection.test.ts
  git commit -m "fix(run-once): exclude approval-wait selections"
  ```

---

### Task 2: Fall Back After Safe Pinned Legacy Rejection

**Files:**

- Modify: `src/cli/commands/run-once/pipeline-legacy.ts:102-226`
- Modify: `src/cli/commands/run-once/pipeline.ts:18-80`
- Modify: `src/cli/commands/run-once/planning-pipeline-facade.test.ts`

**Interfaces:**

- Consumes: Task 1's approval-wait filtering, the initial
  `loadSelectionIssues()` result, `selectRunOnceWorkflow()`,
  `withIssueRunLease()` finally-based release, and existing early
  `no-issue`/`approval-required` exits in `runLegacyOneIssueInternal()`.
- Produces: `LegacySelectionRunResult` from **Interfaces** for
  `runLegacyOneIssueForSelection()`, plus a bounded facade loop that removes
  only an automatically rejected legacy Issue and re-ranks the original
  candidates.

- [ ] **Step 1: Add a focused facade race fixture**

  In `planning-pipeline-facade.test.ts`, add small local helpers that:
  - write a finished legacy planning-workspace Run recovery state;
  - create a live planning Issue lock for the chosen fresh fallback, using the
    existing lock-record shape from the first facade test; and
  - count pinned `tea issues <number>` views separately from the initial
    `tea issues list` snapshot.

  Keep the mock authoritative: the initial list returns immutable advisory
  `IssueSummary` objects, while successive pinned views may return changed
  labels. Import `readFile` only if needed to prove the legacy lease file is
  gone after fallback.

- [ ] **Step 2: Write the failing public fallback, priority, and lease-release
      regression**

  Configure non-dry execution with both approval gates enabled. The initial
  snapshot contains:

  ```ts
  const legacy = issue(272, ["agent-ready"], "Legacy candidate");
  const low = issue(326, ["agent-ready", "priority:low"], "Low fallback");
  const high = issue(
    327,
    ["agent-ready", "priority:critical"],
    "High fallback",
  );
  ```

  Persist finished legacy state for Issue 272 and create planning locks for the
  fresh candidates. Return `legacy` for the first pinned view (before lease),
  then return Issue 272 with `agent-ready + spec-review` for the second pinned
  view (under lease). Call the public `runOneIssue()`, never the legacy alias.

  Assert:

  ```ts
  assert.equal(result.status, "stopped");
  if (result.status === "stopped") {
    assert.equal(result.issue.number, 327);
    assert.equal(result.reason, "issue-locked");
  }
  assert.equal(
    runner.calls.some((call) => call.args.includes("edit")),
    false,
  );
  await assert.rejects(
    readFile(join(config.runStateDir, "locks", "issue-272.lock"), "utf8"),
    { code: "ENOENT" },
  );
  ```

  Also assert Issue 326 is never dispatched. This one case proves the same Run
  attempt continues, remaining priority order is preserved, the first Issue is
  mutation-free, and its lease is released before the fresh planning lock is
  attempted.

- [ ] **Step 3: Write bounded exhaustion and terminal-boundary regressions**

  Add these public-facade cases:
  1. Two advisory finished-legacy candidates are each ready in the initial
     snapshot but each pinned view is approval-wait. Assert each Issue is viewed
     once, the final result is exactly `no-issue`, and there are no Git, label,
     comment, or Pi calls. This detects retries of the same rejected Issue and
     proves finite exhaustion.
  2. Extend the existing unfinished in-progress legacy facade test with a fresh
     ready candidate. Assert the legacy `plan-created`/`plan-found` result stays
     authoritative and the fresh Issue is never viewed or locked. A substantive
     first result must not trigger fallback.
  3. Make the second authoritative view of a selected legacy Issue fail at the
     host/provider boundary. Assert `runOneIssue()` rejects with that error, its
     lease file is removed, and no command dispatches the next candidate. An
     exception is terminal, not a selection rejection.

  Use command-call assertions rather than testing the internal discriminant's
  static shape.

- [ ] **Step 4: Write the explicit approval diagnostic regression**

  Set `issueNumber: 272`, persist its finished legacy state, and return
  `agent-ready + spec-review` for both the explicit load and pinned re-read
  while the open-Issue listing also contains ready Issue 327. Assert:

  ```ts
  assert.equal(result.status, "approval-required");
  if (result.status === "approval-required") {
    assert.equal(result.issue.number, 272);
    assert.equal(result.approvalKind, "spec");
    assert.equal(result.missingLabel, "spec-approved");
  }
  ```

  Assert Issue 327 is listed only as required by existing explicit-resume
  safety, but is never pinned, locked, or mutated. This protects explicit
  fail-fast behavior while the same classified rejection enables automatic
  fallback.

- [ ] **Step 5: Run the facade tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-pipeline-facade.test.ts
  ```

  Expected before implementation: FAIL in the race regression because Issue
  272's pinned `no-issue` ends the invocation instead of selecting Issue 327.
  Existing facade behavior should remain green.

- [ ] **Step 6: Classify only pre-mutation pinned legacy rejection**

  In `pipeline-legacy.ts`, add `LegacySelectionRunResult` from **Interfaces**
  and an internal sentinel carrying the narrowed rejection result. Add a private
  option used only by the pinned handoff:

  ```ts
  type LeasedRunOneIssueOptions = RunOneIssueOptions & {
    // existing fields
    classifySelectionRejection?: boolean;
  };

  class LegacySelectionRejected extends Error {
    constructor(
      readonly result: AgentIssuePipelineResult & {
        status: "no-issue" | "approval-required";
      },
    ) {
      super(`Pinned legacy selection rejected: ${result.status}`);
    }
  }
  ```

  Add a helper that returns the unchanged public result for ordinary callers but
  throws the sentinel when the pinned handoff requested classification:

  ```ts
  function preMutationSelectionResult(
    result: LegacySelectionRejected["result"],
    options: LeasedRunOneIssueOptions,
  ): AgentIssuePipelineResult {
    if (options.classifySelectionRejection)
      throw new LegacySelectionRejected(result);
    return result;
  }
  ```

  Use this helper only around the existing `approval-required` catch return and
  `!issue`/`no-issue` return, both of which occur before Git preflight, lease
  adoption, claims, or mutation. Do not classify by inspecting a result after
  the complete pipeline returns; that could make a future post-effect status
  accidentally retryable.

  Update `runLegacyOneIssueForSelection()` to set
  `classifySelectionRejection: true`, wrap a normal completion as
  `{ kind: "pipeline-result", result }`, catch only `LegacySelectionRejected`,
  and return `{ kind: "selection-rejected", result: error.result }`. Rethrow
  every other error. Because the sentinel crosses `withIssueRunLease()`, its
  `finally` releases the lease before the handoff resolves to the facade.

  Leave `runLegacyOneIssue()`, `runLegacyOneIssueAfterReset()`, and their
  `Promise<AgentIssuePipelineResult>` contracts unchanged.

- [ ] **Step 7: Add bounded facade re-selection**

  In `pipeline.ts`, allocate one `PlanningStateStore` and one `Set<number>`
  after the initial `loadSelectionIssues()` call. Replace the one-shot
  selector/switch with the loop from **Interfaces**.

  For the legacy case, use exactly this decision boundary:

  ```ts
  const legacy = await runLegacyOneIssueForSelection(
    runner,
    config,
    selected.issue.number,
    options,
  );
  if (legacy.kind === "pipeline-result") return legacy.result;
  if (config.issueNumber !== undefined) return legacy.result;
  rejectedIssueNumbers.add(selected.issue.number);
  continue;
  ```

  Return `none`, invalid planning state, active planning, and fresh planning
  exactly as before. Never re-list Issues, never add the live re-read object to
  the candidate pool, and never continue after a planning-pipeline outcome.
  Filtering a finite original array by the growing set provides the loop bound;
  do not add an independent retry counter that could drift from candidate
  identity.

- [ ] **Step 8: Run focused fallback and selection suites**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-selection.test.ts \
    src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
    src/cli/commands/run-once/planning-pipeline-facade.test.ts
  ```

  Expected: PASS. Automatic races advance after lease release, priority and
  finite exhaustion hold, explicit selection returns its approval diagnostic,
  and substantive/errors never dispatch a second Issue.

- [ ] **Step 9: Commit bounded fallback behavior**

  ```sh
  git add \
    src/cli/commands/run-once/pipeline-legacy.ts \
    src/cli/commands/run-once/pipeline.ts \
    src/cli/commands/run-once/planning-pipeline-facade.test.ts
  git commit -m "fix(run-once): fall back after safe selection rejection"
  ```

---

### Task 3: Run Full Regression and Scope Verification

**Files:**

- Verify: `src/cli/commands/run-once/planning-selection.ts`
- Verify: `src/cli/commands/run-once/pipeline-legacy.ts`
- Verify: `src/cli/commands/run-once/pipeline.ts`
- Verify: `src/cli/commands/run-once/planning-selection.test.ts`
- Verify: `src/cli/commands/run-once/planning-pipeline-facade.test.ts`
- Verify unchanged: public result/state schemas, approval/label configuration,
  dependencies, dry-run routing, planning mutation semantics, and unrelated
  issue #252/#255 behavior

**Interfaces:**

- Consumes: Tasks 1-2's implementation commits and the complete design spec.
- Produces: fresh focused, run-once, repository, lint, build, type,
  architecture, dependency/Nix-condition, and final-scope evidence. This task
  creates no validation-only commit when no tracked file changes.

- [ ] **Step 1: Run the spec's focused regression command**

  Run exactly:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-selection.test.ts \
    src/cli/commands/run-once/planning-pipeline-facade.test.ts
  ```

  Expected: PASS with no failed, cancelled, or skipped issue-specific tests.

- [ ] **Step 2: Run the complete Run-once workflow suite**

  Run:

  ```sh
  npm run test:run-once
  ```

  Expected: PASS. Dry-run, explicit selection, approval diagnostics, recovery,
  planning, locks, result rendering, and unrelated Run-once workflow behavior
  remain unchanged.

- [ ] **Step 3: Run repository tests and static verification**

  Run each command separately:

  ```sh
  npm test
  npm run lint
  npm run build
  npm run check:types
  npm run check:architecture
  git diff --check
  ```

  Expected: every command exits `0`, with no test failures, formatting drift,
  ESLint/markdown errors, TypeScript errors, architecture violations, or
  whitespace errors.

- [ ] **Step 4: Enforce the AGENTS.md npm dependency/Nix condition**

  Run:

  ```sh
  if git diff --quiet origin/main...HEAD -- \
    package.json package-lock.json npm-shrinkwrap.json; then
    echo "Nix build skipped: npm dependency metadata unchanged"
  else
    nix build .#patchmill --print-build-logs
  fi
  ```

  Expected for this issue: the skip message. If any npm dependency metadata
  changed and remains necessary, `nix build` must run and exit `0` before
  completion.

- [ ] **Step 5: Review final scope and acceptance evidence**

  Run:

  ```sh
  git status --short
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- \
    src/cli/commands/run-once/planning-selection.ts \
    src/cli/commands/run-once/pipeline-legacy.ts \
    src/cli/commands/run-once/pipeline.ts \
    src/cli/commands/run-once/planning-selection.test.ts \
    src/cli/commands/run-once/planning-pipeline-facade.test.ts
  git diff --quiet origin/main...HEAD -- \
    src/cli/commands/run-once/types.ts \
    src/cli/commands/run-once/workflow-state.ts \
    src/workflow/planning-state-types.ts \
    package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: the quiet diff command exits `0`; the worktree is clean; source
  changes are limited to automatic eligibility, the internal pinned handoff, and
  the bounded facade loop; tests demonstrate waiting-label precedence,
  state-read ordering, approved/active preservation, same-invocation fallback,
  priority, exhaustion, lease release, explicit diagnostics, and terminal
  substantive/error behavior.

  Confirm from the final diff that no public serialized result/state shape or
  label policy changed, no candidate outside the initial snapshot can enter, and
  no path can start a second substantive Run-once workflow.

- [ ] **Step 6: Record verification evidence without a new commit**

  Update the Task 3 Issue todo body with every exact command and outcome, any
  residual risk, and whether the conditional Nix build ran. Set that todo to the
  configured terminal status. Do not amend implementation commits or create a
  validation-only commit when verification changes no tracked file.

---

## Self-Review Notes

- **Spec coverage:** Task 1 makes both approval-wait states absolute automatic
  exclusions before state reads while preserving approved, active-owned,
  explicit, and rank behavior. Task 2 adds the separate bounded fallback,
  explicit pre-mutation classification, lease-release boundary, stable initial
  snapshot, priority re-ranking, finite exhaustion, and terminal handling for
  every unsafe outcome. Task 3 runs every validation command from the spec and
  enforces the repository's conditional Nix requirement.
- **Module boundaries:** Workflow-state interpretation stays in the selector,
  pinned revalidation classification stays at the legacy entry point, and retry
  orchestration stays in the public facade. No helper bucket or unrelated
  refactor is introduced. The large legacy module gains only a narrow boundary
  contract; the facade remains the sole owner of cross-candidate fallback.
- **Type consistency:** `LegacySelectionRunResult` always wraps one unchanged
  `AgentIssuePipelineResult`; only the rejection variant narrows status to
  `no-issue | approval-required`. `runOneIssue()` unwraps it before returning,
  so the public result union and output/exit-code consumers do not change.
- **Testing Value Gate:** New tests exercise externally meaningful selection,
  liveness, ordering, mutation, failure, and lease behavior. Static source,
  config, dependency, and document assertions are deliberately excluded and
  covered by direct validation.
- **Placeholder scan:** Every code-changing task names exact files, interfaces,
  red/green commands, expected failures, minimal implementation behavior, and a
  Conventional Commit message. No implementation decision is deferred.
