# Restore Planning-Phase Run-Once Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `subagent-driven-development` (recommended) or `executing-plans` to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore immediate, step-scoped terminal progress for planning-path
`patchmill run-once` attempts without changing planning workflow results,
recovery, or presentation formats.

**Architecture:** Emit the existing `run-start` event at the public planning
workflow boundary, then create one `createStepAccounting` instance in
`createPlanningRuntime` for the complete attempt. Decorate only actual spec and
plan artifact-agent calls with `create spec`/`create plan` steps, route their
exact Pi session observations through that accounting object, and inject the
same object into the existing implementation adapter so cumulative token totals
do not reset. Existing console and JSONL reporters remain unchanged consumers
of the restored event stream.

**Tech Stack:** TypeScript ESM, Node.js and `node:test`, the existing
`ProgressReporter`/`PiSessionObservation` contracts, real-Git planning provider
fixtures, Prettier, ESLint, and the TypeScript build; no new dependency.

**Spec:**
`docs/specs/2026-09-16-issue-245-run-once-zero-terminal-progress-while-planning-phases-run-regression-from-220-design.md`

## Global Constraints

- Treat each process entry as a **Run attempt** and the resumable lifecycle as
  an **Issue run**, following `CONTEXT.md`.
- Emit exactly one existing `run-start` event for every selected planning Run
  attempt, before lock acquisition and coordination. Dry-run and legacy paths
  retain their existing banner and must not receive a duplicate.
- Use the attempt timestamp already computed by `runPlanningWorkflow`; do not
  introduce another run clock or event type.
- Create exactly one `createStepAccounting` object per production planning
  runtime and reuse it across spec authoring, plan authoring, and implementation.
- Wrap only actual `PlanningArtifactAgent.run()` calls. Reconciliation,
  already-satisfied remote/base artifacts, recovered workspace artifacts,
  publication, and review stops must not emit synthetic `create` steps.
- Keep the established labels exactly `create spec` and `create plan`, and keep
  planning observations on stage `pi-plan`.
- Forward only observations emitted by the existing exact parent-session
  streamer. Do not reconstruct progress from stdout, heartbeats, unrestricted
  session discovery, or tool results.
- Preserve `createStepAccounting.run()` finally behavior: blocked or throwing
  artifact agents still close their active step before the existing planning
  blocker/error result remains authoritative.
- Preserve planning state transitions, checkpoints, pull-request publication,
  review stops, cleanup, results, Pi parsing, subagent correlation, approval
  policy, legacy behavior, and console formatting.
- Do not change `console-progress.ts`, `progress.ts`, `pi.ts`, planning state
  schemas, result schemas, configuration, or user documentation.
- Keep `planning-runtime.ts` focused on production dependency construction. The
  progress decoration belongs at its artifact-agent boundary; do not move
  orchestration into `planning-phase-artifacts.ts`.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If implementation unexpectedly retains an npm dependency metadata change,
  run the Nix build required by `AGENTS.md`.

---

## File and Module Map

- `src/cli/commands/run-once/planning-pipeline.ts` — emit the planning
  workflow's one `run-start` event from the public workflow boundary.
- `src/cli/commands/run-once/planning-runtime.ts` — own attempt-wide step
  accounting, decorate actual artifact-agent calls, forward exact planning
  observations, and pass the same accounting object into implementation.
- `src/cli/commands/run-once/planning-implementation-adapter.ts` — consume the
  runtime-owned accounting object instead of creating a fresh counter.
- `src/cli/commands/run-once/planning-pipeline-progress.test.ts` — new focused
  public-facade regression coverage for immediate banners, spec/plan steps,
  exact-session observations, console output, resume behavior, and cumulative
  accounting.
- `test-support/run-once/planning-provider-scenario.ts` — expose the existing
  scenario's runner/config/time invocation tuple to the focused test so it can
  call the public `runOneIssue` export with a production progress reporter. Do
  not duplicate the real-Git/provider fixture or change its default behavior.
- `src/cli/commands/run-once/planning-phase-artifacts.test.ts`,
  `planning-runtime.test.ts`, and `console-progress.test.ts` — verification-only
  coverage for unchanged artifact, runtime-construction, and presentation
  contracts.

## Interfaces

Use these shapes consistently:

```ts
// planning-pipeline.ts: existing event contract, no new type
await input.options.progress?.event({
  time: attemptTimestamp,
  level: "info",
  stage: "run",
  message: `issue #${input.issue.number} · ${input.issue.title}`,
  issueNumber: input.issue.number,
  step: {
    type: "run-start",
    issueNumber: input.issue.number,
    title: input.issue.title,
  },
});
```

```ts
// planning-implementation-adapter.ts
export type PlanningImplementationAdapterInput = {
  // existing fields remain
  stepAccounting: ReturnType<typeof createStepAccounting>;
};
```

`createPlanningRuntime()` constructs this object once:

```ts
const steps = createStepAccounting({
  progress: input.progressReporter,
  issueNumber: input.issue.number,
  ...(input.now === undefined
    ? {}
    : { runStartedAtMs: input.now().getTime() }),
});
```

It retains the raw agent and exposes this decorated agent to the phase runner:

```ts
const rawArtifactAgent = createPlanningArtifactAgent({
  // existing inputs
  runOptions: {
    // existing run options
    onObservation: (observation) => steps.observe("pi-plan", observation),
  },
});

const artifactAgent: PlanningArtifactAgent = {
  run: (request) =>
    steps.run(`create ${request.kind}`, () =>
      rawArtifactAgent.run(request),
    ),
};
```

Pass `stepAccounting: steps` to `createPlanningImplementationAdapter()`. The
adapter aliases `const steps = input.stepAccounting` and otherwise keeps its
existing `runStep`, `stepStart`, `stepComplete`, and `observePi` callbacks.

## Testing Value Gate

The new automated coverage is required and passes Patchmill's Testing Value
Gate:

- It proves operator-visible runtime behavior rather than import or
  configuration shape.
- It fails meaningfully if the public facade routes only legacy progress, the
  banner moves after a lock/review stop, artifact calls lose their step, exact
  session observations are dropped, resume emits phantom work, or token totals
  reset before implementation.
- Maintainers can rerun it whenever planning orchestration or progress wiring
  changes.
- This critical regression spans public selection, real planning phases, exact
  Pi session streaming, accounting, and the production console reporter, so
  isolated implementation assertions are insufficient.

Do not add tests for static event type declarations, dependency versions, plan
text, or config values. Verify those directly with TypeScript, lint, and the
final diff.

---

### Task 1: Announce Every Selected Planning Attempt

**Files:**

- Create: `src/cli/commands/run-once/planning-pipeline-progress.test.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline.ts`

**Interfaces:**

- Consumes: the selected `IssueSummary`, `attemptTimestamp`, and optional
  `RunOneIssueOptions.progress` reporter already owned by
  `runPlanningWorkflow()`.
- Produces: exactly one existing `run-start` event before
  `runPlanningIssue()` attempts lock acquisition.

- [ ] **Step 1: Write the failing public-facade lock-boundary regression**

  In the new test module, import `runOneIssue` from `./pipeline.ts`, never the
  legacy alias. Reuse `makeConfig()`, issue fixtures,
  `planningIssueLockPath()`, and `collectProgressEvents()` to create a fresh
  planning selection with an active lock owned by the current process.

  Call:

  ```ts
  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
  });
  ```

  Assert the result remains `stopped/issue-locked`, no issue mutation command
  runs, and the progress stream contains exactly this single start event:

  ```ts
  assert.deepEqual(
    events.filter((event) => event.step?.type === "run-start"),
    [
      {
        time: NOW.toISOString(),
        level: "info",
        stage: "run",
        message: "issue #245 · Planning progress",
        issueNumber: 245,
        step: {
          type: "run-start",
          issueNumber: 245,
          title: "Planning progress",
        },
      },
    ],
  );
  ```

  This lock stop is intentional: it proves the banner is emitted before any
  coordination work and does not require a Pi fixture.

- [ ] **Step 2: Run the focused test and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts
  ```

  Expected: FAIL because the stopped planning attempt currently emits no
  `run-start` event.

- [ ] **Step 3: Emit the existing banner at the planning workflow boundary**

  In `runPlanningWorkflow()`, keep the current single computation of
  `attemptTimestamp` and `runOptions`. Immediately before awaiting
  `runPlanningIssue()`, emit the event from **Interfaces**.

  Do not put the event in `runPlanningIssue()`: that lower-level ownership
  function is used in focused state/lock tests and does not own public attempt
  presentation. Do not put it in `pipeline.ts`: the planning workflow owns its
  timestamp/session attempt, while legacy already owns its own banner.

- [ ] **Step 4: Run focused planning pipeline tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-pipeline-facade.test.ts
  ```

  Expected: PASS. The selected planning attempt announces itself exactly once,
  still stops at the active lock, and established routing/lock behavior is
  unchanged.

- [ ] **Step 5: Commit the planning attempt banner**

  ```sh
  git add \
    src/cli/commands/run-once/planning-pipeline.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts
  git commit -m "fix(run-once): announce planning workflow attempts"
  ```

---

### Task 2: Stream Step-Scoped Planning Work With Shared Accounting

**Files:**

- Modify: `src/cli/commands/run-once/planning-runtime.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-adapter.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline-progress.test.ts`
- Modify: `test-support/run-once/planning-provider-scenario.ts`

**Interfaces:**

- Consumes: Task 1's planning banner, `PlanningArtifactAgent`,
  `createStepAccounting`, exact `PiSessionObservation` callbacks, and the
  existing planning implementation adapter callbacks.
- Produces: one step-accounting lifetime spanning every actual planning artifact
  agent and the implementation adapter, with all `pi-plan` observations
  delivered while the correct artifact step is active.

- [ ] **Step 1: Expose the existing provider scenario invocation without
      changing defaults**

  Extend `PlanningProviderScenario` with a read-only test seam:

  ```ts
  invocation(): Readonly<{
    runner: CommandRunner;
    config: AgentIssueConfig;
    now: Date;
  }>;
  ```

  Return the already-created `runner`, `config`, and fixed scenario `now` from
  `createPlanningProviderScenario()`. Keep `scenario.run()`, provider effects,
  real-Git behavior, cleanup, and every existing caller unchanged. The new
  progress test must call its imported public `runOneIssue` directly with this
  tuple; it must not copy the provider fixture or import `pipeline-legacy.ts`.

- [ ] **Step 2: Add an exact-session progress harness to the new test module**

  Add a helper that combines an event collector with the production
  `AgentIssueConsoleProgressReporter`. On each debug event whose message is
  `pi session path`, write complete JSONL entries to the exact path from
  `event.data` before `runPiPrompt()` launches the mocked Pi process:

  ```ts
  const sessionEntries = (input: {
    id: string;
    outputTokens: number;
    includeSubagent?: boolean;
  }) => [
    { type: "session", version: 3, id: `session-${input.id}` },
    assistantToolCall(`tool-${input.id}`, "read", { path: "AGENTS.md" }),
    ...(input.includeSubagent
      ? [
          subagentProgressEntry({
            version: 1,
            kind: "workflow",
            toolCallId: `tool-${input.id}`,
            workflowRunId: `workflow-${input.id}`,
            childId: "worker",
            state: "running",
            agent: "worker",
            model: "openai/gpt-5.6",
            thinking: "high",
          }),
        ]
      : []),
    {
      type: "message",
      id: `usage-${input.id}`,
      parentId: null,
      message: {
        role: "assistant",
        content: [],
        usage: { output: input.outputTokens },
      },
    },
  ];
  ```

  Serialize each entry on its own line with a trailing newline. Use a distinct
  invocation ID per Pi call. The harness must retain complete progress events
  and console lines so assertions cover both the reporter contract and what an
  operator sees.

- [ ] **Step 3: Write the failing missing-spec public planning regression**

  Create a Forgejo planning provider scenario with
  `{ specRequired: true, planRequired: false }`. Call the public facade using
  `scenario.invocation()` and seed one exact `pi-plan` session with one read
  tool call, one subagent observation, and `outputTokens: 4200`.

  Assert:

  - the result is `review-pending` for phase `spec`;
  - exactly one `run-start` event identifies issue `#190`;
  - event order is `step-start:create spec`, then tool-call,
    subagent-progress, assistant-usage observations, then
    `step-complete:create spec`;
  - every observation has stage `pi-plan`;
  - completion reports `toolCalls: 1`, `taskOutputTokens: 4200`, and
    `totalOutputTokens: 4200`;
  - console lines contain `issue #190 · Provider scenario`, `01 create spec`,
    the indented read tool, the indented authoritative subagent line, and the
    `task 4.2k total 4.2k` completion summary before the final result is
    returned; and
  - no production console/result module is altered to satisfy the test.

- [ ] **Step 4: Write failing resume and plan-authoring regressions**

  Re-run the same scenario while its spec pull request remains open with a
  fresh progress harness. Assert one banner but no `step-start`, no Pi session,
  and no observation: review reconciliation did not perform artifact authoring.
  Then merge that spec pull request and call the public facade with a copied
  config whose `planOnly` is `true`. Seed the assigned plan-agent session and
  assert the only creation label is `create plan`: the spec now satisfied by
  merged-base evidence must not emit `create spec` again.

  Add a second scenario with
  `{ specRequired: false, planRequired: true }`. Seed two exact `pi-plan`
  sessions with 100 and 200 output tokens. Assert the actual calls emit exactly
  these starts in order:

  ```ts
  ["create spec", "create plan"]
  ```

  Assert their completion totals are respectively:

  ```ts
  [
    { label: "create spec", taskOutputTokens: 100, totalOutputTokens: 100 },
    { label: "create plan", taskOutputTokens: 200, totalOutputTokens: 300 },
  ]
  ```

  The open-review rerun proves durable/reconciled work does not create phantom
  steps; the combined plan phase proves labels derive from each actual agent
  request and that planning artifacts share one counter.

- [ ] **Step 5: Write the failing implementation-continuity regression**

  Create a scenario with both review gates disabled. It assigns missing spec and
  plan artifacts to the implementation workspace before implementation runs.
  Seed the two `pi-plan` sessions with 100 and 200 output tokens.

  When the `pi-implementation` session path is announced, create one closed
  issue todo under the resolved operator todo root, then seed an implementation
  tool call and 300 output tokens:

  ```ts
  const todoRoot = resolve(
    config.repoRoot,
    config.projectPolicy.pi.taskContract.todoRoot,
  );
  await mkdir(todoRoot, { recursive: true });
  await writeFile(
    join(todoRoot, "issue-190-progress.md"),
    `${JSON.stringify({
      title: "issue-190-task-01-progress-accounting",
      status: "closed",
      tags: ["agent-issue", "issue-190"],
    })}\n\nprogress fixture\n`,
    "utf8",
  );
  ```

  The closed task follows the configured title/status contract and causes the
  existing implementation task tracker to open and close
  `final review and landing` around the streamed observations without leaving a
  handoff blocker.

  Assert the public result remains `pr-created` and the relevant completions are
  monotonic across the same attempt:

  ```ts
  [
    { label: "create spec", taskOutputTokens: 100, totalOutputTokens: 100 },
    { label: "create plan", taskOutputTokens: 200, totalOutputTokens: 300 },
    {
      label: "final review and landing",
      taskOutputTokens: 300,
      totalOutputTokens: 600,
    },
  ]
  ```

  Also assert the implementation tool call belongs to the active final step.
  Before the fix there are no artifact steps or observations, and the adapter's
  independent counter would restart implementation totals even if artifact
  events were added incompletely.

- [ ] **Step 6: Run the new public regressions and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts
  ```

  Expected: FAIL after Task 1 because planning artifact steps and exact-session
  observations are absent. The continuity case must also expose the separate
  implementation accounting lifetime.

- [ ] **Step 7: Create one planning-runtime accounting object**

  In `planning-runtime.ts`, import `createStepAccounting` and the
  `PlanningArtifactAgent` type. Construct `steps` once at the beginning of
  `createPlanningRuntime()` using the code in **Interfaces**. Keep it alive in
  closures returned by that runtime.

  Rename the direct artifact agent to `rawArtifactAgent`. Add
  `runOptions.onObservation` exactly as shown in **Interfaces**, preserving all
  existing session root, progress, streaming, heartbeat, token usage, task
  contract, skills, and Pi-agent settings.

  Create the small `artifactAgent` decorator from **Interfaces** and pass it to
  `runPlanningPhase()`. Do not add step logic inside
  `createPlanningArtifactAgent()` or `runPlanningPhaseArtifacts()`: those lower
  layers should remain state-neutral and the wrapper must run only when their
  existing code actually calls the agent.

- [ ] **Step 8: Inject the same accounting object into implementation**

  In `planning-implementation-adapter.ts`, add
  `stepAccounting: ReturnType<typeof createStepAccounting>` to the input type.
  Import `createStepAccounting` only for the type query and keep `progress` as
  the runtime import. Replace the local constructor with:

  ```ts
  const steps = input.stepAccounting;
  ```

  In `planning-runtime.ts`, pass `stepAccounting: steps` when constructing the
  implementation adapter. Leave all adapter callbacks otherwise unchanged:

  ```ts
  runStep: steps.run,
  stepStart: steps.start,
  stepComplete: steps.complete,
  observePi: (stage) => async (observation) =>
    steps.observe(stage, observation),
  ```

  This is dependency injection, not a second accounting implementation. Do not
  couple token display totals to `tokenUsageState`; that object retains its
  separate run-cost/session responsibility.

- [ ] **Step 9: Run focused progress, runtime, artifact, and console tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-phase-artifacts.test.ts \
    src/cli/commands/run-once/planning-runtime.test.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    src/cli/commands/run-once/console-progress.test.ts
  ```

  Expected: PASS. Public planning runs render the banner, actual artifact steps,
  exact-session tools/subagents/usage, and monotonic artifact-to-implementation
  totals; open-review resume emits only its banner; unchanged lower-level
  artifact and console behavior remains green.

- [ ] **Step 10: Commit shared planning progress accounting**

  ```sh
  git add \
    src/cli/commands/run-once/planning-runtime.ts \
    src/cli/commands/run-once/planning-implementation-adapter.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    test-support/run-once/planning-provider-scenario.ts
  git commit -m "fix(run-once): stream planning phase progress"
  ```

---

### Task 3: Run Full Regression and Scope Verification

**Files:**

- Verify: `src/cli/commands/run-once/planning-pipeline.ts`
- Verify: `src/cli/commands/run-once/planning-runtime.ts`
- Verify: `src/cli/commands/run-once/planning-implementation-adapter.ts`
- Verify: `src/cli/commands/run-once/planning-pipeline-progress.test.ts`
- Verify: `test-support/run-once/planning-provider-scenario.ts`
- Verify unchanged: console/progress/Pi parsing, state/result schemas, package
  metadata, Nix files, and legacy pipeline behavior

**Interfaces:**

- Consumes: Tasks 1–2's implementation commits and the complete spec.
- Produces: fresh issue-focused, run-once, repository, lint, build,
  dependency/Nix-condition, and final-scope evidence. This task creates no
  validation-only commit when the worktree has no source changes.

- [ ] **Step 1: Run the spec's focused regression command**

  Run exactly:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-phase-artifacts.test.ts \
    src/cli/commands/run-once/planning-runtime.test.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    src/cli/commands/run-once/console-progress.test.ts
  ```

  Expected: PASS with no failed, cancelled, or skipped issue-specific tests.

- [ ] **Step 2: Run the complete run-once suite**

  Run:

  ```sh
  npm run test:run-once
  ```

  Expected: PASS. Legacy progress, planning state/recovery/publication,
  implementation, result rendering, and unrelated run-once behavior remain
  unchanged.

- [ ] **Step 3: Run repository tests, lint, and build**

  Run each command separately:

  ```sh
  npm test
  npm run lint
  npm run build
  ```

  Expected: every command exits `0` with no test failures, formatting drift,
  ESLint/markdown errors, or TypeScript build errors.

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
  git diff --check
  git status --short
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- \
    src/cli/commands/run-once/planning-pipeline.ts \
    src/cli/commands/run-once/planning-runtime.ts \
    src/cli/commands/run-once/planning-implementation-adapter.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    test-support/run-once/planning-provider-scenario.ts
  git diff --quiet origin/main...HEAD -- \
    src/cli/commands/run-once/console-progress.ts \
    src/cli/commands/run-once/progress.ts \
    src/cli/commands/run-once/pi.ts \
    src/workflow/planning-state-types.ts \
    package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: `git diff --check` and the final quiet diff command exit `0`; the
  worktree is clean; production changes are limited to banner and accounting
  wiring; test support only exposes the existing public scenario invocation;
  no schema, renderer, parser, dependency, or legacy-pipeline change is present.

  Review the captured progress evidence and confirm all acceptance points:
  exactly one immediate banner, actual-only spec/plan steps, exact-session tool
  and subagent visibility, per-step tool/token counts, monotonic attempt-wide
  totals into implementation, no phantom resume steps, and unchanged terminal
  results.

- [ ] **Step 6: Record verification evidence without a new commit**

  Update the Task 3 issue todo body with the exact commands and outcomes, any
  residual risks, and whether the conditional Nix build ran. Set the todo to the
  configured terminal status. Do not amend implementation commits or create a
  validation-only commit when verification changes no tracked file.

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers the immediate single banner, including a
  pre-coordination lock stop. Task 2 covers actual-only spec/plan steps,
  exact-session tool/usage/subagent observations, finally-based completion,
  public-facade console output, review resume without phantom work, combined
  plan authoring, and shared artifact-to-implementation totals. Task 3 covers
  the exact validation sequence and dependency/Nix policy.
- **Module boundaries:** The public planning pipeline owns Run-attempt start,
  `planning-runtime.ts` owns production dependency lifetime and decoration, the
  artifact adapter remains state-neutral, and the implementation adapter
  consumes rather than owns shared accounting. `planning-pipeline.ts` is already
  about 515 lines, so Task 1 adds only the boundary event; a broad orchestration
  split would mix unrelated refactoring into this critical regression. The
  roughly 202-line runtime remains cohesive after the small accounting
  decorator, and no presentation or Pi parser change is required.
- **Type consistency:** `stepAccounting` is exactly
  `ReturnType<typeof createStepAccounting>`; artifact labels derive from
  `PlanningArtifactKind`; planning observations use `pi-plan`; implementation
  keeps its existing stage union and callbacks.
- **Placeholder scan:** Every code-changing task names exact files, interfaces,
  red/green commands, expected failures, implementation behavior, and a
  Conventional Commit message. No implementation requirement is deferred.
