# Restore run-once progress during planning phases

- **Issue:** #245
- **Status:** Proposed design

## Summary

`patchmill run-once` will emit the same progress contract for
planning-pull-request artifact authoring that the legacy pipeline already emits:
one issue banner, one step around each spec or plan agent invocation, and the Pi
session observations produced while that step is active. The implementation
phase will keep its existing progress behavior.

A single `createStepAccounting` instance will serve all work performed by one
planning workflow attempt. This preserves step-local tool-call counts and
cumulative output-token totals when an attempt creates artifacts and then
continues into implementation. Existing console and JSONL reporters will consume
the restored events without a new event type or presentation change.

## Context and root cause

The public non-dry-run facade in `pipeline.ts` now routes fresh and active
planning work through `runPlanningWorkflow`. That path passes a progress
reporter into `runPiPrompt`, so heartbeats and debug lifecycle data still exist,
but it omits the three inputs required for operator-visible output:

1. `runPlanningWorkflow` never emits the `run-start` event rendered as
   `issue #N · title`.
2. `createPlanningArtifactAgent` enables exact Pi session observation with
   `observeSession: true`, but `planning-runtime.ts` does not provide
   `runOptions.onObservation`. `runPiPrompt` therefore parses tool-call,
   subagent-progress, and assistant-usage observations and discards them at the
   optional callback boundary.
3. No `step-start` or `step-complete` events surround spec and plan agent runs.
   Even if tool calls were forwarded, `AgentIssueConsoleProgressReporter`
   intentionally renders ordinary tool calls only while a step is active.

The working references are the legacy spec/plan path and
`planning-implementation-adapter.ts`: both use `createStepAccounting`, route Pi
observations through `steps.observe`, and execute agent work inside named steps.
The regression escaped because `pipeline-progress-scenarios.test.ts` explicitly
imports `runLegacyOneIssue`; it does not exercise the public planning path
selected after issue #220.

## Goals

- Print the issue banner as soon as a planning workflow attempt starts.
- Render `create spec` and `create plan` steps whenever the corresponding
  missing artifact is authored.
- Forward planning Pi tool calls, subagent progress, and assistant usage through
  the existing progress reporter while the correct step is active.
- Preserve accurate per-step tool-call/output-token counts and attempt-wide
  cumulative output-token totals.
- Keep existing planning state transitions, review stops, publication, recovery,
  and final results unchanged.
- Add behavior-level coverage through the public planning pipeline so future
  tests cannot pass solely against the legacy implementation.

## Non-goals

This change will not:

- redesign console formatting or add progress event variants;
- make heartbeat or existing debug-only events visible;
- add synthetic steps for artifacts already satisfied by remote base or durable
  workspace state;
- add long-running progress for Git, host, pull-request publication, or review
  reconciliation operations;
- change dry-run or explicitly selected legacy behavior;
- change Pi session parsing, subagent correlation, planning gates, or approval
  policy; or
- change workflow state, artifact, pull-request, or terminal-result schemas.

## Approaches considered

### Share one accounting object across the planning runtime (chosen)

Create one `createStepAccounting` instance for each production planning runtime.
Use it to decorate spec/plan artifact-agent calls, consume their Pi
observations, and drive the existing implementation adapter. This follows the
established legacy contract while keeping cumulative accounting correct if
artifacts and implementation run in the same attempt.

### Give the artifact agent independent accounting

`createPlanningArtifactAgent` could create its own steps internally while the
implementation adapter retained a separate counter. This is smaller locally, but
an implementation-carried spec/plan flow could reset the displayed cumulative
token total when implementation begins. It also makes orchestration state the
responsibility of a low-level Pi adapter. This approach is rejected.

### Wrap the complete planning phase runner

The coordinator could wrap every spec or plan phase, including reconciliation
and publication. That would emit misleading `create` steps on attempts that only
inspect an already-open or merged pull request, and it would complicate the
implementation phase's existing nested steps. Steps should represent actual
agent authoring work, so this approach is rejected.

## Proposed design

### Run start

`runPlanningWorkflow` will emit exactly one existing `run-start` progress event
for its selected issue before lock acquisition and coordination begin. It will
use the attempt timestamp already computed for Pi session storage and the same
event shape as the legacy pipeline:

```ts
{
  level: "info",
  stage: "run",
  message: `issue #${issue.number} · ${issue.title}`,
  issueNumber: issue.number,
  step: {
    type: "run-start",
    issueNumber: issue.number,
    title: issue.title,
  },
}
```

This gives immediate feedback even when the attempt subsequently stops at a
lock, identity, review, or recovery boundary. The planning workflow owns this
emission so legacy and dry-run paths do not receive a duplicate banner.

### Shared planning-attempt accounting

`createPlanningRuntime` will create one `createStepAccounting` instance using
the attempt's progress reporter and issue number. That object will remain alive
for the runtime's complete coordination attempt.

The runtime will retain the raw `createPlanningArtifactAgent`, then pass the
phase runner a progress-decorated artifact agent. For each actual `agent.run`
request, the decorator will call:

```ts
steps.run(`create ${request.kind}`, () => artifactAgent.run(request));
```

The resulting labels remain `create spec` and `create plan`, matching the legacy
pipeline. Because the wrapper is applied at the agent boundary, resumed or
base-satisfied artifacts do not create phantom steps. `steps.run` also preserves
the current finally-based completion behavior if the agent blocks or throws; the
final pipeline result remains authoritative for success or failure.

### Pi observation flow

The runtime will supply this callback through `createPlanningArtifactAgent`'s
existing `runOptions` pass-through:

```ts
onObservation: (observation) => steps.observe("pi-plan", observation);
```

The existing exact-session streamer in `runPiPrompt` will then deliver:

- `assistant-usage` observations, which update cumulative and step output-token
  accounting;
- `tool-call` observations, which increment the active step's tool-call count
  and render as indented console lines; and
- `subagent-progress` observations, which retain the console reporter's existing
  child rendering and deduplication behavior.

All observations will also continue through composite reporters to JSONL
diagnostics. No observation is reconstructed from stdout, heartbeat messages, or
unrestricted tool results.

### Implementation continuity

`planning-implementation-adapter.ts` will consume the runtime-owned accounting
object instead of constructing another one. Its existing `runStep`, `stepStart`,
`stepComplete`, and `observePi` callbacks otherwise remain unchanged.

Sharing the object matters when planning gates place missing spec or plan
artifacts in the implementation workspace: `create spec`, `create plan`, and
implementation steps must report a monotonic attempt-wide `totalOutputTokens`
value rather than restarting the total at zero. Step numbering remains
presentation-owned by `AgentIssueConsoleProgressReporter` and therefore
continues naturally across all emitted steps.

## Event flow

For a fresh spec-required attempt:

1. The facade selects the planning workflow.
2. `runPlanningWorkflow` emits `run-start`; the console prints the issue banner.
3. Planning ownership and state checks complete.
4. The phase runner reaches a missing spec and calls the decorated artifact
   agent.
5. Shared accounting emits `step-start: create spec`.
6. `runPiPrompt` streams exact-session observations to
   `steps.observe("pi-plan", ...)`.
7. Existing reporters render and persist those observations; tool calls appear
   under the active step.
8. Agent completion or failure closes the step with usage, tool-call, and
   elapsed-time accounting.
9. Existing artifact verification, checkpointing, publication, and
   `review-pending` behavior continue unchanged.

A later plan attempt follows the same flow with `create plan`. An attempt that
only reconciles a review emits the banner but no artifact-creation step. An
implementation attempt continues to use its established steps and observation
stages.

## Affected components

- `src/cli/commands/run-once/planning-pipeline.ts`
  - Emit the planning workflow's single `run-start` event.
- `src/cli/commands/run-once/planning-runtime.ts`
  - Own one attempt-wide step-accounting object.
  - Decorate actual spec/plan agent calls with `create spec`/`create plan`
    steps.
  - Wire `runOptions.onObservation` to the shared accounting object.
  - Supply that same object to the implementation adapter.
- `src/cli/commands/run-once/planning-implementation-adapter.ts`
  - Accept shared accounting instead of creating an isolated counter.
- `src/cli/commands/run-once/planning-pipeline-progress.test.ts`
  - Add focused public-pipeline scenarios for the banner, artifact steps,
    exact-session observations, resume behavior, and accounting continuity.
  - Exercise `runOneIssue` from `pipeline.ts`, not the legacy alias.

No production change is expected in `console-progress.ts`, `progress.ts`,
`pi.ts`, the planning state model, or result rendering.

## Failure and compatibility behavior

- If no progress reporter is configured, optional event calls remain no-ops and
  planning behavior is unchanged.
- Observation callback failures retain `runPiPrompt`'s existing backpressured
  failure semantics; the fix will not catch and hide reporter errors.
- A blocked or failed artifact agent still closes its active step through
  `createStepAccounting.run` and then follows the existing planning
  blocker/error path.
- The banner may precede an immediate stopped or blocked planning outcome, which
  is intentional operator feedback that the selected issue attempt began.
- Existing legacy progress tests remain valid and must not be rewritten to mask
  planning-path behavior.
- No dependency or configuration file changes are planned.

## Verification strategy

These tests pass Patchmill's Testing Value Gate because they protect a critical
operator-visible runtime contract and the exact regression boundary that current
legacy-only tests miss.

### Public planning-path regression

Drive the public `runOneIssue` facade through a missing planning artifact with a
progress reporter and a synthetic exact Pi session. Assert that:

- exactly one `run-start` event identifies the selected issue;
- `step-start: create spec` occurs before planning observations;
- tool-call, assistant-usage, and subagent-progress observations reach the
  progress stream;
- the matching `step-complete` reports the expected tool-call and token counts;
- the production console reporter prints the issue banner, numbered step,
  indented tool/subagent lines, and completion accounting before the final
  `review-pending` result; and
- the test imports `runOneIssue` from `pipeline.ts`, preventing accidental
  legacy-only coverage.

Keep this coverage in `planning-pipeline-progress.test.ts` rather than further
enlarging the legacy-only progress scenario module.

### Resume and accounting coverage

Cover these boundaries with focused runtime or scenario tests:

- an artifact already satisfied by durable/base evidence emits no `create` step;
- a plan authoring attempt uses `create plan` and the same observation stage;
- an implementation-carried artifact flow keeps `totalOutputTokens` monotonic
  from artifact steps into existing implementation steps; and
- an immediate planning stop still emits the banner once without duplicating
  legacy banners.

Implementation verification should run:

```sh
node --test \
  src/cli/commands/run-once/planning-phase-artifacts.test.ts \
  src/cli/commands/run-once/planning-runtime.test.ts \
  src/cli/commands/run-once/planning-pipeline-progress.test.ts \
  src/cli/commands/run-once/console-progress.test.ts
npm run test:run-once
npm test
npm run lint
npm run build
```

No Nix build is required unless implementation unexpectedly changes an npm
dependency file.

## Acceptance mapping

| Requirement                  | Design response                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Immediate issue feedback     | `runPlanningWorkflow` emits one existing `run-start` event before coordination.                                        |
| Visible spec/plan activity   | Actual artifact-agent calls run inside `create spec` or `create plan` accounting steps.                                |
| Tool and subagent visibility | Exact-session observations flow through `steps.observe("pi-plan", ...)` while the step is active.                      |
| Correct usage accounting     | One runtime-owned accounting object spans planning artifacts and implementation.                                       |
| No misleading resume output  | Reconciliation and already-satisfied artifacts do not emit creation steps.                                             |
| Regression protection        | A public-facade planning scenario asserts events and rendered console output instead of importing the legacy pipeline. |
