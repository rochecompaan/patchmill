# Planning Phase Integration and Required Implementation Pull Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route fresh `run-once` Issue runs through `planning-pr-v1`, stop at
required planning reviews or `--plan-only`, and finish only after independently
validating a live implementation pull request.

**Architecture:** Keep `runOneIssue()` as a small workflow router and move the
current orchestration unchanged behind a legacy entry point. A separate planning
pipeline acquires the strict issue lock, revalidates issue and state, and
invokes a focused phase coordinator built from issue #188's artifact,
publication, and reconciliation services. The implementation path records strict
local, remote, host, and ancestry proof before a planning-state-aware finish
wrapper can run handoff, hook, workspace cleanup, or lifecycle effects.

**Tech Stack:** TypeScript, Node.js 22.19+, Node's `node:test` runner, Git CLI
through `CommandRunner`, provider-neutral `PullRequestHost`, GitHub `gh`,
Forgejo `tea`, strict `planning-pr-v1` JSON state, Prettier, ESLint, and
dependency-cruiser.

**Spec:**
`docs/specs/2026-09-09-issue-189-integrate-planning-phases-and-require-implementation-pull-requests-design.md`

## Prerequisite

Issue #188 must be merged into the implementation base before Task 1. Its
current branch,
`origin/agent/issue-188-execute-and-publish-planning-pull-request-phases`,
defines the APIs this plan consumes: `runPlanningPhaseArtifacts()`,
`publishPlanningPhase()`, `reconcilePlanningPhase()`, `PlanningPublicationGit`,
`createPullRequestHost()`, and the publication-aware strict phase variants.
Rebase rather than reimplementing those services. If the merged API differs,
update call sites and type names mechanically while preserving the interfaces
and invariants below.

## Global Constraints

- Keep `runOneIssue()` as the exported facade. Route recognized unfinished
  legacy state to the legacy pipeline, and route valid active `planning-pr-v1`
  state or fresh eligible issues to the new planning pipeline.
- Never interpret malformed, unknown, or unsupported planning state as legacy or
  fresh state. If planning and legacy state are both active for one issue, fail
  closed before labels, Git, Pi, or host mutation.
- Select in this order: explicit `--issue`, active nonblocked planning state,
  resumable legacy state with `in-progress`, then fresh ready issue. Within each
  bucket, preserve configured priority-label order and break ties by issue
  number.
- Treat selection before the planning lock as advisory. After acquiring the
  ownership-ID lock, re-read the issue, planning state, and legacy state before
  the first mutation. Retry a fresh-state race once with the authoritative saved
  `runId`; never select another issue in the same Run attempt.
- Map an `active` lock conflict to `stopped/issue-locked` with no mutation. Map
  `stale`, `unverifiable`, and `malformed` conflicts to blocked operator
  conditions; never replace or remove the existing lock.
- Snapshot `workflow.specApproval.required` and `workflow.planApproval.required`
  only when fresh state is created. Approval labels and issue artifact comments
  do not authorize or advance the new workflow.
- Implement all four gate sequences exactly as recorded in
  `planningPhasePlan()`. An implementation phase is never completed from an
  empty `artifactKinds` array.
- Return `review-pending` for an open required spec or plan pull request. It is
  a normal warning result and must precede a `plan-only` stop.
- For `--plan-only`, run and checkpoint missing planning artifacts assigned to
  the implementation phase, but do not run implementation code, push the
  implementation branch, or create its pull request. Do not create an
  implementation workspace when no assigned artifact is missing.
- Preserve the implementation development-environment, todo, validation, review,
  visual-evidence, Pi repair, and finalization gates. Pass a copied Git policy
  with `allowDirectLand: false` and reject every `merged` result.
- Accept implementation success only after proving the exact target repository,
  saved base branch, allowed push repository, owned head branch, equal
  local/remote/host head OID, open status, canonical URL/reference, one exact
  final implementation marker, effective top-level `Closes #<issue>`, base
  ancestry, and reported-commit ancestry.
- Persist the validated implementation `pull-request-open` checkpoint before
  cost publication, visual-evidence validation, handoff, cleanup hook,
  worktree/branch removal, or done-label mutation.
- Preserve the implementation workspace and active planning state on validation
  failure. Resume finish effects from exact strict checkpoints; never force
  remove, reset, clean, or adopt uncertain local state.
- Keep legacy state, lease, labels, artifact comments, approval behavior,
  direct-land policy, results, and finish ordering unchanged.
- Keep orchestration, state validation, pull-request validation, and output
  formatting in separate modules. Prefer modules under roughly 200 meaningful
  lines; split pure parsing/progress logic from effectful orchestration when a
  module grows beyond that boundary.
- Do not add configuration keys, dependencies, installed skill-pack changes,
  generated configuration, examples, or user documentation. Do not add live
  provider acceptance scenarios.

---

## File and Module Map

### Strict workflow state

- Modify `src/workflow/planning-state-types.ts` to give implementation phases
  exact agent evidence, publication, finish checkpoints, and terminal
  `implementation-pull-request` completion variants.
- Modify `src/workflow/planning-state-validation.ts` to parse those exact
  shapes, forbid implementation evidence on `spec`/`plan`, and forbid
  remote-base or merged-planning completion for `implementation`.
- Modify `src/workflow/planning-state-transitions.ts` to allow only the
  implementation checkpoint sequence and immutable evidence.
- Modify `src/workflow/planning-state.test.ts` and
  `src/workflow/planning-state-publication-regressions.test.ts` for exact
  schema, progress-prefix, transition, cleanup, and recovery regressions.

### Public result contract

- Modify `src/cli/commands/run-once/types.ts` for internal `review-pending` and
  `stopped` variants retaining `IssueSummary`.
- Modify `src/cli/commands/run-once/result-summary.ts`, `result-output.ts`, and
  `terminal-result.ts` for redirected JSON, JSONL, warning rendering, and exit
  code `0`.
- Modify their focused tests plus `src/cli/commands/run-once/args.test.ts`,
  which exercises the exported summary helper from `main.ts`.

### Pull-request proof and implementation execution

- Create `src/workflow/planning-implementation-body.ts` and its test for the
  effective top-level closing reference.
- Modify `src/workflow/planning-pull-request-validation.ts` and its test so the
  shared identity/marker validator accepts `implementation` without changing
  planning reconciliation semantics.
- Modify `src/cli/commands/run-once/prompts.ts` and `prompts.test.ts` to require
  the exact implementation marker while leaving legacy prompts byte-for-byte
  compatible when the new option is absent.
- Create `src/cli/commands/run-once/development-environment-agent.ts` and
  `implementation-agent.ts` as state-neutral Pi cores; keep legacy state and
  lifecycle effects in the existing wrappers.
- Create `src/cli/commands/run-once/implementation-task-progress.ts` for task
  label normalization and progress-step switching, keeping the extracted
  implementation core focused.
- Create `src/cli/commands/run-once/planning-implementation-validation.ts` and
  its test for local, remote, host, URL, repository, branch, status, marker,
  closing-reference, and ancestry proof.
- Create `src/cli/commands/run-once/planning-implementation.ts` and its test to
  run the core, force pull-request-only policy, reject `merged`, and checkpoint
  branch and validated pull-request evidence.

### Planning orchestration and compatibility routing

- Create `src/cli/commands/run-once/planning-finish.ts` and its test for strict
  finish ordering and idempotent checkpoint resume.
- Create `src/cli/commands/run-once/planning-phase-coordinator.ts` and its test
  for the four gate matrices, reconciliation, base satisfaction, review stops,
  and `--plan-only`.
- Create `src/cli/commands/run-once/planning-selection.ts` and its test for
  workflow-aware advisory priority and fail-closed state classification.
- Create `src/cli/commands/run-once/planning-pipeline.ts` and its test for lock
  acquisition, post-lock revalidation, lifecycle effects, dependency
  construction, and lock release.
- Create `src/cli/commands/run-once/pipeline-legacy.ts`; mechanically move the
  current implementation there and leave `pipeline.ts` as the public router.
- Add `src/cli/commands/run-once/planning-pipeline-scenarios.test.ts` for full
  recording-seam scenarios and extend existing legacy pipeline scenario tests
  only where needed to prove the routing boundary.

## Public Interfaces

Use these names consistently across tasks:

```ts
// src/workflow/planning-state-types.ts
export type PlanningImplementationVisualEvidence = Readonly<{
  screenshotPath: string;
  caption?: string;
  referencePaths?: readonly string[];
  url?: string;
}>;

export type PlanningRunCostEvidence = Readonly<{
  stages: readonly Readonly<{
    stage: string;
    models: readonly Readonly<{
      model: string;
      promptTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    }>[];
    promptTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }>[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}>;

export type PlanningImplementationAgentEvidence = Readonly<{
  status: "pr-created";
  prUrl: string;
  branch: string;
  commits: readonly string[];
  validation: readonly string[];
  reviewSummary?: string;
  landingDecision?: string;
  visualEvidence: readonly PlanningImplementationVisualEvidence[];
  runCostReport?: PlanningRunCostEvidence;
}>;

export type PlanningImplementationFinishCheckpoints = Readonly<{
  costPublicationCompleted?: true;
  visualEvidenceValidated?: true;
  handoffCommentPosted?: true;
  cleanupHookCompleted?: true;
  doneLabelEnsured?: true;
  doneLabelApplied?: true;
}>;

export type ImplementationBranchPushedPlanningPhase = Readonly<{
  kind: "implementation";
  status: "branch-pushed";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  implementation: PlanningImplementationAgentEvidence;
}>;

export type ImplementationPullRequestOpenPlanningPhase = Readonly<{
  kind: "implementation";
  status: "pull-request-open";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
  implementation: PlanningImplementationAgentEvidence;
  finish: PlanningImplementationFinishCheckpoints;
}>;

export type ImplementationCompletePlanningPhase = Readonly<{
  kind: "implementation";
  status: "complete";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{
    state: "removed";
    pushedHeadOid: string;
  }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
  implementation: PlanningImplementationAgentEvidence;
  finish: Required<PlanningImplementationFinishCheckpoints>;
  completion: Readonly<{ kind: "implementation-pull-request" }>;
}>;
```

`PlanningRunCostEvidence` mirrors the existing non-secret aggregate
`RunCostReport` fields using readonly arrays and finite nonnegative numbers. Add
explicit conversion functions in `planning-implementation.ts` and
`planning-finish.ts`; do not import CLI modules from `src/workflow/`.

```ts
// src/cli/commands/run-once/planning-phase-coordinator.ts
export type PlanningCoordinatorOutcome =
  | {
      kind: "review-pending";
      state: PlanningStateV1;
      phase: "spec" | "plan";
      prUrl: string;
    }
  | {
      kind: "stopped";
      state: PlanningStateV1;
      reason: "plan-only";
      nextPhase: "implementation";
    }
  | { kind: "blocked"; state: PlanningStateV1; result: AgentIssueBlockedResult }
  | {
      kind: "complete";
      state: PlanningStateV1;
      result: AgentIssuePrCreatedResult;
    };

export async function coordinatePlanningPhases(
  input: PlanningPhaseCoordinatorInput,
): Promise<PlanningCoordinatorOutcome>;
```

```ts
// src/cli/commands/run-once/planning-selection.ts
export type RunOnceWorkflowSelection =
  | { kind: "none" }
  | { kind: "invalid-planning-state"; issue: IssueSummary; reason: string }
  | { kind: "planning"; issue: IssueSummary; state: PlanningStateV1 }
  | { kind: "legacy"; issue: IssueSummary }
  | {
      kind: "fresh-planning";
      issue: IssueSummary;
      initialState: PlanningStateV1;
    };

export async function selectRunOnceWorkflow(
  issues: readonly IssueSummary[],
  config: AgentIssueConfig,
  planningState: Pick<PlanningStateStore, "read" | "path">,
): Promise<RunOnceWorkflowSelection>;
```

```ts
// src/cli/commands/run-once/types.ts
export type AgentIssueReviewPendingResult = {
  status: "review-pending";
  issue: IssueSummary;
  phase: "spec" | "plan";
  prUrl: string;
};

export type AgentIssueStoppedResult = {
  status: "stopped";
  issue: IssueSummary;
  reason: "plan-only" | "issue-locked";
  nextPhase?: "implementation";
  specPath?: string;
  planPath?: string;
  branch?: string;
  worktreePath?: string;
};
```

## Testing Value Gate

Every planned automated test proves behavior with meaningful regression value:

- State tests protect reusable parsing, immutable evidence, progress ordering,
  lock authorization, and destructive cleanup boundaries.
- Closing-reference, marker, URL, repository, and ancestry tests protect
  security-sensitive pull-request identity and cannot be replaced by static
  inspection.
- Coordinator and recording-pipeline tests protect gate sequencing, concurrency,
  recovery, and the ordering of externally visible effects.
- Result tests protect redirected JSON, terminal, JSONL, and process exit-code
  API contracts.
- Legacy scenario suites protect compatibility while the router is introduced.

No new test should assert dependency versions, lockfile text, documentation
content, static configuration, or import spelling. Verify those directly with
`git diff`, `npm run build`, lint, type checks, architecture checks, and the
conditional Nix command in Task 10.

---

## Task 1: Extend strict planning state for implementation and finish checkpoints

**Files:**

- Modify: `src/workflow/planning-state-types.ts`
- Modify: `src/workflow/planning-state-validation.ts`
- Modify: `src/workflow/planning-state-transitions.ts`
- Modify: `src/workflow/planning-state.test.ts`
- Modify: `src/workflow/planning-state-publication-regressions.test.ts`

**Interfaces:**

- Consumes: issue #188's `PlanningPublicationEvidence`, publication-aware phase
  variants, `PlanningWorkspaceOwnership`, `PlanningPullRequestEvidence`, and
  strict `PlanningStateStore.replace()` contract.
- Produces: the implementation evidence and checkpoint types in **Public
  Interfaces**, plus transition rules consumed by Tasks 5 and 6.

- [ ] **Step 1: Write failing strict-schema and transition tests**

Add table-driven cases that prove:

```ts
const forbidden = [
  { kind: "spec", status: "branch-pushed", implementation: agentEvidence },
  { kind: "plan", status: "pull-request-open", implementation: agentEvidence },
  {
    kind: "implementation",
    status: "complete",
    completion: { kind: "remote-base" },
  },
  {
    kind: "implementation",
    status: "complete",
    completion: { kind: "merged-pull-request" },
  },
];
```

Also assert that implementation `branch-pushed` accepts a final workspace head
newer than its planning-artifact commits while keeping those artifact paths,
sources, and commit OIDs immutable; Task 5's Git proof checks their ancestry.
`pull-request-open` requires exact publication, implementation, pull-request,
and empty finish evidence; finish checkpoints can only accumulate `true` fields
in the declared order; cleanup advances `ready -> worktree-removed -> removed`;
and terminal completion requires removed workspace plus every finish checkpoint.

- [ ] **Step 2: Run the state tests and verify they fail**

Run:

```sh
node --test \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-publication-regressions.test.ts
```

Expected: FAIL because the implementation evidence, finish checkpoints, and
terminal completion discriminator are not yet recognized.

- [ ] **Step 3: Add exact implementation evidence types and validators**

Implement the types shown in **Public Interfaces**, plus exact readonly visual
and run-cost evidence. Validate unknown keys, nonblank bounded single-line
identity fields, canonical relative evidence paths, full 40- or 64-character Git
OIDs, nonempty validation entries, finite nonnegative run-cost totals, and
cross-field equality:

```ts
phase.implementation.branch === phase.workspace.identity.branch;
phase.implementation.prUrl === phase.pullRequest.url; // once PR-open
phase.publication.headOid === phase.workspace.headOid;
phase.workspace.cleanup.state === "removed"; // terminal only
```

Keep bodies, raw command output, credentials, state bytes, and Pi transcript
content out of durable evidence.

- [ ] **Step 4: Implement phase-specific replacement rules**

Permit exactly:

```text
implementation workspace-ready
  -> implementation branch-pushed
  -> implementation pull-request-open/finish checkpoints
  -> implementation complete/implementation-pull-request
```

Make agent, repository, branch, head, URL/reference, artifact, and validation
evidence immutable after first persistence. Allow only the saved cleanup
transition and one-way finish checkpoint additions; reject skipped checkpoints,
checkpoint removal, head changes after `branch-pushed`, and any planning-phase
implementation evidence.

- [ ] **Step 5: Run the focused state tests**

Run the command from Step 2. Expected: PASS, including issue #188 publication
regressions and the new implementation matrix.

- [ ] **Step 6: Commit the state contract**

```sh
git add \
  src/workflow/planning-state-types.ts \
  src/workflow/planning-state-validation.ts \
  src/workflow/planning-state-transitions.ts \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-publication-regressions.test.ts
git commit -m "feat(workflow): checkpoint implementation pull requests"
```

## Task 2: Add review-pending and stopped public result contracts

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/result-summary.ts`
- Modify: `src/cli/commands/run-once/result-summary.test.ts`
- Modify: `src/cli/commands/run-once/result-output.ts`
- Modify: `src/cli/commands/run-once/result-output.test.ts`
- Modify: `src/cli/commands/run-once/terminal-result.ts`
- Modify: `src/cli/commands/run-once/terminal-result.test.ts`
- Modify: `src/cli/commands/run-once/args.test.ts`

**Interfaces:**

- Consumes: `AgentIssuePipelineResult`, existing log/session path propagation,
  JSONL result events, and terminal layout primitives.
- Produces: the exact internal and redirected result variants from the spec;
  Tasks 7 and 8 return these variants.

- [ ] **Step 1: Write failing summary, terminal, JSONL, and exit tests**

Construct full results and assert exact redirected forms:

```ts
{
  status: "review-pending",
  issueNumber: 189,
  phase: "spec",
  prUrl: "https://example.test/owner/repo/pull/12",
}

{
  status: "stopped",
  issueNumber: 189,
  reason: "plan-only",
  nextPhase: "implementation",
  specPath: "docs/specs/issue-189.md",
  planPath: "docs/plans/issue-189.md",
  branch: "agent/issue-189-implementation",
  worktreePath: ".worktrees/issue-189-implementation",
}
```

Assert optional `logPath` and `piSessionPath`, one compact redirected JSON
object, the same summary in the final JSONL event, warning severity, phase/PR
terminal text for review, reason/next phase/preserved paths for stops, and exit
code `0` for both new statuses. Retain code `1` for `blocked` and `error`.

- [ ] **Step 2: Run focused output tests and verify they fail**

```sh
node --test \
  src/cli/commands/run-once/result-summary.test.ts \
  src/cli/commands/run-once/result-output.test.ts \
  src/cli/commands/run-once/terminal-result.test.ts \
  src/cli/commands/run-once/args.test.ts
```

Expected: FAIL because the new discriminants are absent from the unions and
formatters.

- [ ] **Step 3: Implement the exact result unions and summary mapping**

Add the types from **Public Interfaces** to `AgentIssuePipelineResult` and these
summary variants:

```ts
| { status: "review-pending"; issueNumber: number; phase: "spec" | "plan"; prUrl: string }
| { status: "stopped"; issueNumber: number; reason: "plan-only" | "issue-locked";
    nextPhase?: "implementation"; specPath?: string; planPath?: string;
    branch?: string; worktreePath?: string }
```

Map only declared fields and normal optional log/session paths; do not serialize
`IssueSummary`, PR bodies, lock bytes, or internal state.

- [ ] **Step 4: Implement terminal and exit behavior**

Add `Review pending` and `Stopped` entries with warning severity. Render review
phase and pull request, and render stop reason plus optional next phase before
existing artifact/workspace sections. Make `exitCodeForRunOnceResult()` explicit
and exhaustive: approval-required, environment-not-ready, blocked, and error are
`1`; all established successes plus review-pending and stopped are `0`.

- [ ] **Step 5: Run focused output tests**

Run the command from Step 2. Expected: PASS with no changed expectations for
legacy statuses.

- [ ] **Step 6: Commit the public contract**

```sh
git add \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/result-summary.ts \
  src/cli/commands/run-once/result-summary.test.ts \
  src/cli/commands/run-once/result-output.ts \
  src/cli/commands/run-once/result-output.test.ts \
  src/cli/commands/run-once/terminal-result.ts \
  src/cli/commands/run-once/terminal-result.test.ts \
  src/cli/commands/run-once/args.test.ts
git commit -m "feat(run-once): report planning review stops"
```

## Task 3: Validate implementation pull-request bodies and prompt requirements

**Files:**

- Create: `src/workflow/planning-implementation-body.ts`
- Create: `src/workflow/planning-implementation-body.test.ts`
- Modify: `src/workflow/planning-pull-request-validation.ts`
- Modify: `src/workflow/planning-pull-request-validation.test.ts`
- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/prompts.test.ts`

**Interfaces:**

- Consumes: `parsePlanningPullRequestMarker()`,
  `validatePlanningPullRequestSummary()`, `renderPlanningPullRequestMarker()`,
  and `ImplementationPromptInput`.
- Produces: `assertImplementationClosingReference(body, issueNumber)`, shared
  implementation marker/identity validation, and an optional prompt marker that
  Task 5 supplies.

- [ ] **Step 1: Write failing Markdown body tests**

Cover one valid column-zero line and reject absent or example-only references:

````ts
const accepted = `Summary\n\nCloses #189\n\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->`;
const rejected = [
  "```md\nCloses #189\n```",
  "> Closes #189",
  "    Closes #189",
  "- Closes #189",
  "Closes #190",
  "Refs #189",
];
````

Also cover CRLF input, fenced blocks using backticks and tildes, longer fence
closers, duplicate/malformed/unsupported/fenced markers, wrong issue or phase,
and the requirement that the one valid marker is the final nonblank top-level
line.

- [ ] **Step 2: Write failing prompt and shared-validator tests**

Assert the planning implementation prompt includes direct landing disabled,
`Closes #189`, and this exact final marker instruction and sample line:

```text
<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->
```

Assert the existing legacy prompt output is unchanged when no marker option is
provided. Extend the shared validator test matrix so `phase: "implementation"`
validates the same target/base/head/OID/URL/reference/marker identity as spec
and plan without forcing planning reconciliation to accept only open status.

- [ ] **Step 3: Run focused tests and verify they fail**

```sh
node --test \
  src/workflow/planning-implementation-body.test.ts \
  src/workflow/planning-pull-request-validation.test.ts \
  src/cli/commands/run-once/prompts.test.ts
```

Expected: FAIL because the closing-reference parser and implementation prompt
contract do not exist.

- [ ] **Step 4: Implement the focused body validator**

Export:

```ts
export class PlanningImplementationBodyError extends Error {
  readonly reason: "closing-reference";
}

export function assertImplementationClosingReference(
  body: string,
  issueNumber: number,
): void;
```

Normalize CRLF, track top-level backtick/tilde fences, ignore block quotes,
lists, and four-space/tab-indented code, and require a column-zero line exactly
equal to `Closes #${issueNumber}`. Keep marker parsing in the existing marker
module rather than duplicating it.

- [ ] **Step 5: Extend shared validation and prompt rendering**

Change the shared validator phase type to `PlanningPhaseKind`. Add
`requiredPullRequestMarker?: string` to `ImplementationPromptInput`; thread it
through PR creation instructions and the Markdown example, placing it as the
final nonblank line. The planning caller will pass the rendered marker and
`git.allowDirectLand: false`; legacy callers omit the option and retain their
current output and result contracts.

- [ ] **Step 6: Run focused tests**

Run the command from Step 3. Expected: PASS for pure Markdown, shared identity,
and both prompt modes.

- [ ] **Step 7: Commit body and prompt validation**

```sh
git add \
  src/workflow/planning-implementation-body.ts \
  src/workflow/planning-implementation-body.test.ts \
  src/workflow/planning-pull-request-validation.ts \
  src/workflow/planning-pull-request-validation.test.ts \
  src/cli/commands/run-once/prompts.ts \
  src/cli/commands/run-once/prompts.test.ts
git commit -m "feat(run-once): require implementation pull request markers"
```

## Task 4: Extract state-neutral development and implementation agent cores

**Files:**

- Create: `src/cli/commands/run-once/development-environment-agent.ts`
- Create: `src/cli/commands/run-once/development-environment-agent.test.ts`
- Create: `src/cli/commands/run-once/implementation-agent.ts`
- Create: `src/cli/commands/run-once/implementation-agent.test.ts`
- Create: `src/cli/commands/run-once/implementation-task-progress.ts`
- Modify: `src/cli/commands/run-once/development-environment-stage.ts`
- Modify: `src/cli/commands/run-once/pipeline-implementation.ts`
- Modify: `src/cli/commands/run-once/pipeline-development-environment.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-implementation.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts`

**Interfaces:**

- Consumes: existing Pi profiles, prompt builders, todo readers, Pi repair,
  progress callbacks, and visual-evidence result parsing.
- Produces: state-neutral cores returning typed results without labels, legacy
  Run recovery state, comments, or finish effects; the existing wrappers retain
  all old mutations.

- [ ] **Step 1: Add characterization tests for legacy behavior**

Record the current order and outputs for development ready/not-ready, Pi
blocked, `pr-created`, allowed/disallowed `merged`, saved implementation resume,
todo completeness, task progress, repair attempts, and error conversion. Assert
that the legacy wrapper still writes `worktreeReady`, maps not-ready labels,
invokes `blockIssue`, and enforces configured direct-land policy.

- [ ] **Step 2: Run the legacy implementation tests**

```sh
node --test \
  src/cli/commands/run-once/pipeline-development-environment.test.ts \
  src/cli/commands/run-once/pipeline-implementation.test.ts \
  src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts
```

Expected: PASS before refactoring; these tests are the compatibility baseline.

- [ ] **Step 3: Extract the development-environment agent**

Move only profile selection, prompt construction, `runPiPrompt()`, and handoff
creation behind:

```ts
export type DevelopmentEnvironmentAgentOutcome =
  | { kind: "ready"; handoff: AgentIssueDevelopmentEnvironmentHandoff }
  | {
      kind: "not-ready";
      result: AgentIssueDevelopmentEnvironmentNotReadyResult;
    };

export async function runDevelopmentEnvironmentAgent(
  input: DevelopmentEnvironmentAgentInput,
): Promise<DevelopmentEnvironmentAgentOutcome>;
```

Keep not-ready label changes, legacy `writeRunState()`, final progress, and
pipeline result construction in `development-environment-stage.ts`.

- [ ] **Step 4: Extract implementation task progress and Pi execution**

Move task-label normalization and step switching into a focused tracker created
by:

```ts
export function createImplementationTaskProgress(
  input: ImplementationTaskProgressInput,
): ImplementationTaskProgress;
```

Move development-environment invocation, implementation prompt/Pi execution,
repair, todo checks, and result parsing behind:

```ts
export type ImplementationAgentOutcome =
  | {
      kind: "implemented";
      result: AgentIssuePrCreatedResult | AgentIssueMergedResult;
    }
  | { kind: "blocked"; result: AgentIssueBlockedResult }
  | {
      kind: "environment-not-ready";
      result: AgentIssueDevelopmentEnvironmentNotReadyResult;
    };

export async function runImplementationAgent(
  input: ImplementationAgentInput,
): Promise<ImplementationAgentOutcome>;
```

The input must accept explicit `git` policy and
`requiredPullRequestMarker?: string`; it must not read or write legacy Run
recovery state, mutate labels, post comments, clean workspaces, or decide
whether `merged` is allowed.

- [ ] **Step 5: Rebuild the legacy wrapper around the cores**

Keep `runPipelineImplementationStage()`'s public options/result unchanged. It
writes legacy state, constructs the existing resume context, maps not-ready and
blocked outcomes through existing lifecycle helpers, calls
`assertDirectLandAllowed()`, and returns the same `implemented` versus
`already-implemented` discriminants.

- [ ] **Step 6: Run extraction and legacy tests**

```sh
node --test \
  src/cli/commands/run-once/development-environment-agent.test.ts \
  src/cli/commands/run-once/implementation-agent.test.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts \
  src/cli/commands/run-once/pipeline-implementation.test.ts \
  src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts
```

Expected: PASS with the characterization assertions unchanged.

- [ ] **Step 7: Commit the neutral cores**

```sh
git add \
  src/cli/commands/run-once/development-environment-agent.ts \
  src/cli/commands/run-once/development-environment-agent.test.ts \
  src/cli/commands/run-once/implementation-agent.ts \
  src/cli/commands/run-once/implementation-agent.test.ts \
  src/cli/commands/run-once/implementation-task-progress.ts \
  src/cli/commands/run-once/development-environment-stage.ts \
  src/cli/commands/run-once/pipeline-implementation.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts \
  src/cli/commands/run-once/pipeline-implementation.test.ts \
  src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts
git commit -m "refactor(run-once): extract implementation agent core"
```

## Task 5: Run and independently validate the planning implementation phase

**Files:**

- Create: `src/cli/commands/run-once/planning-implementation-validation.ts`
- Create: `src/cli/commands/run-once/planning-implementation-validation.test.ts`
- Create: `src/cli/commands/run-once/planning-implementation.ts`
- Create: `src/cli/commands/run-once/planning-implementation.test.ts`

**Interfaces:**

- Consumes: Task 1's implementation state variants, Task 3's body/shared
  validators, Task 4's neutral agent core, `PlanningWorkspaceLifecycle`,
  `PlanningPublicationOperations`, `PullRequestHost`,
  `PlanningStateStore.replace()`, and `resolvePipelineRunCost()`.
- Produces: branch-pushed and validated pull-request-open implementation
  checkpoints consumed by Tasks 6 and 7.

- [ ] **Step 1: Write failing pure/recording validation tests**

Cover exact target repository, saved base branch, provider-allowed head
repository, owned branch, equal clean-local/remote/host head OID, open status,
canonical result URL/reference, implementation marker, closing reference, base
to head ancestry, saved workspace head to final head ancestry, and every
reported commit both descended from base and ancestor of head. Add one failing
case per reason and assert host transport, authentication, not-found, incomplete
discovery, malformed response, repository, status, marker, closing-reference,
remote-head, and ancestry errors remain distinguishable and do not expose PR
bodies.

- [ ] **Step 2: Write failing implementation-stage checkpoint tests**

Use recording agent, workspace, Git, host, state store, and lock seams. Assert:

```text
resume exact workspace
run optional development environment
run implementation with allowDirectLand=false and exact marker
validate todos/local head/ancestry
observe exact remote head and repositories
persist branch-pushed
read and validate canonical open PR
persist pull-request-open
```

Assert `merged` becomes a blocked safety result regardless of configured policy;
wrong returned branch, dirty/missing workspace, changed remote head, invalid PR,
or state conflict produces zero finish/label/handoff/hook/cleanup calls and
preserves the workspace.

- [ ] **Step 3: Run focused tests and verify they fail**

```sh
node --test \
  src/cli/commands/run-once/planning-implementation-validation.test.ts \
  src/cli/commands/run-once/planning-implementation.test.ts
```

Expected: FAIL because the planning implementation path does not exist.

- [ ] **Step 4: Implement local and live pull-request proof**

Export a validator with this effect boundary:

```ts
export async function validatePlanningImplementation(
  input: PlanningImplementationValidationInput,
): Promise<{
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
  headOid: string;
}>;
```

Use `workspaces.inspect()` to prove the exact registered owned workspace is
ready and clean, `assertAncestor()` for base/head, saved workspace head/final
head, and both sides of every reported commit, `inspectRemoteHead()` for the
exact configured remote branch, repository resolvers plus
`assertPlanningPublicationRepositories()`, canonical URL parsing for the
returned PR number, `getPullRequest()` for exact readback, shared summary
validation with phase `implementation`, status `open`, and the focused
closing-reference validator. Do not infer not-found from message text.

- [ ] **Step 5: Implement planning implementation execution and checkpoints**

Export:

```ts
export type PlanningImplementationOutcome =
  | { kind: "validated"; state: PlanningStateV1 }
  | {
      kind: "blocked";
      state: PlanningStateV1;
      result: AgentIssueBlockedResult;
    };

export async function runPlanningImplementation(
  input: PlanningImplementationInput,
): Promise<PlanningImplementationOutcome>;
```

For `workspace-ready`, resume exact ownership, run the neutral agent with copied
Git policy `{ ...configuredGit, allowDirectLand: false }` and the rendered
implementation marker, require `pr-created`, calculate and sanitize optional
run-cost evidence, prove local/remote head and reported commits, then persist
`branch-pushed`. For a resumed `branch-pushed`, skip Pi and validate the saved
canonical PR. Persist `pull-request-open` only after every
host/body/head/ancestry check succeeds. Never accept or adapt `merged`.

- [ ] **Step 6: Run focused implementation tests**

Run the command from Step 3. Expected: PASS, including zero post-validation side
effects on every rejection.

- [ ] **Step 7: Commit implementation validation**

```sh
git add \
  src/cli/commands/run-once/planning-implementation-validation.ts \
  src/cli/commands/run-once/planning-implementation-validation.test.ts \
  src/cli/commands/run-once/planning-implementation.ts \
  src/cli/commands/run-once/planning-implementation.test.ts
git commit -m "feat(run-once): validate implementation pull requests"
```

## Task 6: Finish only from durable validated implementation evidence

**Files:**

- Create: `src/cli/commands/run-once/planning-finish.ts`
- Create: `src/cli/commands/run-once/planning-finish.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-comments.ts`
- Modify: `src/cli/commands/run-once/pipeline-comments.test.ts`

**Interfaces:**

- Consumes: Task 1's `ImplementationPullRequestOpenPlanningPhase`, existing cost
  publication, visual evidence, handoff comment, cleanup hook, workspace
  lifecycle, label helpers, state store, and issue lock.
- Produces: terminal strict implementation state and a public `pr-created`
  result reconstructed only from durable evidence.

- [ ] **Step 1: Write failing finish-order and resume tests**

Record every state read/write and external effect. Assert exact order:

```text
load validated pull-request-open
publish/handle run cost; checkpoint
validate committed visual evidence; checkpoint
post canonical PR handoff; checkpoint
run cleanup hook successfully; checkpoint
remove clean owned worktree; checkpoint worktree-removed
prove remote head and remove exact local branch; checkpoint removed
ensure done label; checkpoint
apply done/remove in-progress and blocker labels; checkpoint
persist complete/implementation-pull-request
return durable pr-created
```

Inject failure before and after each checkpoint and rerun. Completed effects
must not repeat; the next incomplete effect resumes. A failed hook, visual
validation, workspace cleanup, label mutation, state conflict, or lock conflict
must preserve the last state and perform no later effect.

- [ ] **Step 2: Run focused finish tests and verify they fail**

```sh
node --test \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/pipeline-comments.test.ts
```

Expected: FAIL because no planning-state-aware finish path exists.

- [ ] **Step 3: Add a durable-evidence handoff renderer**

Keep the existing legacy `handoffComment()` unchanged. Add a narrow renderer
that receives the canonical durable PR URL, branch, plan path, validation,
review summary, and landing decision. It must not accept a raw Pi result or PR
body.

- [ ] **Step 4: Implement the checkpointed finish wrapper**

Export:

```ts
export async function finishPlanningImplementation(
  input: PlanningFinishInput,
): Promise<{ state: PlanningStateV1; result: AgentIssuePrCreatedResult }>;
```

Reject any phase other than validated implementation `pull-request-open` or a
fully terminal implementation phase. Use one strict `replace()` per checkpoint.
Treat cost publication as the established best-effort warning and durably mark
it handled; treat visual, handoff, hook, workspace, branch, label, state, and
lock failures as stopping failures. Consider any failed cleanup-hook result a
failure rather than continuing. Build the `AgentIssuePrCreatedResult` from
durable branch, canonical PR URL, commits, validation, review/landing, and
visual evidence. Return the terminal state alongside it so the coordinator and
pipeline can add durable artifact paths and the preserved worktree identity to
the public pipeline result.

- [ ] **Step 5: Run focused finish tests**

Run the command from Step 2. Expected: PASS for ordering, interruption recovery,
and legacy handoff compatibility.

- [ ] **Step 6: Commit the strict finish path**

```sh
git add \
  src/cli/commands/run-once/planning-finish.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/pipeline-comments.ts \
  src/cli/commands/run-once/pipeline-comments.test.ts
git commit -m "feat(run-once): checkpoint implementation finish effects"
```

## Task 7: Coordinate all planning gate combinations and explicit stops

**Files:**

- Create: `src/cli/commands/run-once/planning-phase-coordinator.ts`
- Create: `src/cli/commands/run-once/planning-phase-coordinator.test.ts`

**Interfaces:**

- Consumes: `planningPhasePlan()`, `PlanningRemoteBaseGit`,
  `PlanningWorkspaceLifecycle`, issue #188 artifact/publisher/reconciler
  services, Task 5's implementation runner, Task 6's finish wrapper, and strict
  state replacement under the live lock.
- Produces: `PlanningCoordinatorOutcome` from **Public Interfaces**.

- [ ] **Step 1: Write failing four-gate matrix tests**

Use recording fakes and assert these exact sequences:

```ts
const cases = [
  {
    gates: [false, false],
    sequence: [
      "implementation:spec",
      "implementation:plan",
      "implementation:code",
      "implementation:pr",
    ],
  },
  {
    gates: [true, false],
    sequence: [
      "spec:pr",
      "spec:merge",
      "implementation:plan",
      "implementation:code",
      "implementation:pr",
    ],
  },
  {
    gates: [false, true],
    sequence: [
      "plan:spec",
      "plan:plan",
      "plan:pr",
      "plan:merge",
      "implementation:code",
      "implementation:pr",
    ],
  },
  {
    gates: [true, true],
    sequence: [
      "spec:pr",
      "spec:merge",
      "plan:pr",
      "plan:merge",
      "implementation:code",
      "implementation:pr",
    ],
  },
];
```

Every open required planning PR must return `review-pending` before any next
workspace or implementation call. A verified merge must fetch a new remote base
before preparing the next phase.

- [ ] **Step 2: Add recovery, base-artifact, and plan-only tests**

Cover `branch-pushed` and `pull-request-open` reconciliation before local
preparation; `closed-unmerged`, `missing`, and `ambiguous` blocked without
replacement; one base artifact satisfying assigned work; multiple candidates
blocking; implementation with empty `artifactKinds` still executing; and
approval labels/artifact comments having no effect.

For `--plan-only`, prove review-pending precedence, implementation-carried
artifacts checkpoint before stop, zero code/push/PR calls, resume without the
flag, and no implementation workspace creation when no assigned planning
artifact is missing.

- [ ] **Step 3: Run the coordinator test and verify it fails**

```sh
node --test src/cli/commands/run-once/planning-phase-coordinator.test.ts
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 4: Implement strict-prefix phase coordination**

Read the first noncomplete phase from validated state. Reconcile saved planning
publication states before preparation; continue only from `satisfied-by-base` or
verified merged completion. For pending work, fetch/pin base, resolve artifacts,
checkpoint remote-base completion only for `spec`/`plan`, prepare or resume the
exact owned workspace, run missing artifacts in assignment order, and publish
planning phases through issue #188.

For implementation, enforce the special `--plan-only` boundary before workspace
creation when all assigned planning artifacts are already on base; otherwise
checkpoint artifacts then stop. Without `--plan-only`, call Task 5, then Task 6.
Return after review, explicit stop, blocker, or finish; loop only after durable
phase completion.

- [ ] **Step 5: Keep coordinator failures typed and sanitized**

Map only expected phase classifications to blocked results. Propagate transport,
state, lock, Git, and unexpected provider errors without parsing messages.
Include issue-facing reasons and concise questions, but never PR bodies, raw
command output, credentials, state bytes, or Pi transcript content.

- [ ] **Step 6: Run coordinator and issue #188 service tests**

```sh
node --test \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-phase-artifacts.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.real.test.ts
```

Expected: PASS with the coordinator composing rather than duplicating issue #188
behavior.

- [ ] **Step 7: Commit the phase coordinator**

```sh
git add \
  src/cli/commands/run-once/planning-phase-coordinator.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts
git commit -m "feat(run-once): coordinate planning pull request phases"
```

## Task 8: Add workflow-aware selection, locking, and side-by-side routing

**Files:**

- Create: `src/cli/commands/run-once/planning-selection.ts`
- Create: `src/cli/commands/run-once/planning-selection.test.ts`
- Create: `src/cli/commands/run-once/planning-pipeline.ts`
- Create: `src/cli/commands/run-once/planning-pipeline.test.ts`
- Create: `src/cli/commands/run-once/pipeline-legacy.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/selection.ts`
- Modify: `src/cli/commands/run-once/selection.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-selection.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-selection-scenarios.test.ts`
- Modify: `src/cli/commands/run/reset/reset.ts`
- Modify: `src/cli/commands/run/reset/reset.test.ts`

**Interfaces:**

- Consumes: Task 7's coordinator, planning state/store/lock, current legacy
  recovery policy, host factories, lifecycle labels, configured priority order,
  and the current reset-only leased entry point.
- Produces: `selectRunOnceWorkflow()`, `runPlanningIssue()`, and a small public
  `pipeline.ts` router while preserving `runOneIssueAfterReset()` as legacy.

- [ ] **Step 1: Write failing advisory selection tests**

Use real temporary planning/legacy state files and explicit issue fixtures.
Assert explicit selection wins; active nonblocked planning outranks resumable
legacy and fresh ready; legacy outranks fresh; configured priority labels then
issue number order each bucket; review-pending and plan-only planning state stay
selectable through state plus `in-progress`; needs-info planning state is
skipped until ready is reapplied; malformed planning state is returned as
invalid rather than skipped; and active planning plus unfinished legacy for one
issue fails closed.

- [ ] **Step 2: Write failing lock and post-lock tests**

Record issue/state reads and every mutation. Assert state and issue are read
after lock acquisition before initialization, labels, comments, Git, Pi, or PR
calls. Two contenders must permit effects from exactly one owner. Assert active
conflict returns `stopped/issue-locked`; stale/unverifiable/malformed conflicts
block without takeover; provisional fresh `runId` retries once with a racing
authoritative state; a second identity change blocks;
title/state/open/eligibility changes stop before mutation; and release removes
only the same `ownershipId` in `finally`.

- [ ] **Step 3: Run focused selection/pipeline tests and verify they fail**

```sh
node --test \
  src/cli/commands/run-once/planning-selection.test.ts \
  src/cli/commands/run-once/planning-pipeline.test.ts \
  src/cli/commands/run-once/selection.test.ts \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
  src/cli/commands/run/reset/reset.test.ts
```

Expected: FAIL because workflow-aware selection and routing do not exist.

- [ ] **Step 4: Implement deterministic workflow selection**

Expose or add one pure priority comparator in `selection.ts`; do not duplicate
priority-label rules. In `planning-selection.ts`, read planning state for every
open candidate, classify malformed state with its path/reason, inspect legacy
state only for the current recovery policy, reject dual-active identity, and
return the exact `RunOnceWorkflowSelection` union. Fresh selection checks the
ready label and normal blocker exclusions but ignores approval labels for
authorization; active planning selection ignores review labels and allows
`in-progress` while still honoring genuine blocker labels.

- [ ] **Step 5: Implement the locked planning pipeline**

Construct default issue/PR hosts, `PlanningStateStore`, `PlanningRemoteBaseGit`,
`PlanningWorkspaceGit`, `PlanningPublicationGit`, and agent services behind
injectable dependency interfaces for recording tests. For fresh work, create an
in-memory state and acquire its lock before initialization. Re-read issue,
planning state, and legacy state; initialize state before applying `in-progress`
and removing ready; deduplicate the existing started comment by exact body; then
invoke the coordinator. Keep `in-progress` on review and stopped outcomes. Map
genuine blockers through a planning-aware needs-info label/comment helper
without writing legacy state.

Release the owned lock in `finally`; if both work and release fail, throw an
`AggregateError` retaining both causes. Never release a conflicting lock.

- [ ] **Step 6: Extract legacy orchestration and wire the facade**

Move the current `runOneIssueInternal()` implementation mechanically to
`pipeline-legacy.ts`, preserving imports, options, lease recursion, and
observable ordering. Make `pipeline.ts` select once and dispatch the pinned
issue to legacy or planning. Route `runOneIssueAfterReset()` directly to the
legacy entry because reset compatibility is out of scope. Keep existing exports
and call signatures stable.

- [ ] **Step 7: Run focused routing and reset tests**

Run the command from Step 3. Expected: PASS, including unchanged legacy reset,
lease, selection, and approval-label assertions.

- [ ] **Step 8: Commit workflow routing**

```sh
git add \
  src/cli/commands/run-once/planning-selection.ts \
  src/cli/commands/run-once/planning-selection.test.ts \
  src/cli/commands/run-once/planning-pipeline.ts \
  src/cli/commands/run-once/planning-pipeline.test.ts \
  src/cli/commands/run-once/pipeline-legacy.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/selection.ts \
  src/cli/commands/run-once/selection.test.ts \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
  src/cli/commands/run/reset/reset.ts \
  src/cli/commands/run/reset/reset.test.ts
git commit -m "feat(run-once): route planning pull request workflows"
```

## Task 9: Prove end-to-end safety ordering and legacy compatibility

**Files:**

- Create: `src/cli/commands/run-once/planning-pipeline-scenarios.test.ts`
- Verify unchanged: `src/cli/commands/run-once/pipeline-planning.test.ts`
- Verify unchanged:
  `src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts`
- Verify unchanged:
  `src/cli/commands/run-once/pipeline-finish-scenarios.test.ts`
- Verify unchanged: `src/cli/commands/run-once/pipeline-recovery.test.ts`
- Verify unchanged: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Consumes: the complete planning workflow from Tasks 1-8 and existing recording
  command/host fixtures.
- Produces: scenario evidence that every acceptance criterion holds through the
  public facade and that the legacy route remains behaviorally unchanged.

- [ ] **Step 1: Add full planning workflow scenarios**

Drive `runOneIssue()` through recording seams for all four gate snapshots,
separate Run attempts around each open planning PR, merged reconciliation with a
new fetched base, implementation PR validation, and final cleanup. Assert public
results, durable revisions, labels/comments, exact branch/worktree identity,
remote/head ancestry checks, final JSON summary data, and zero next-phase
effects at review gates.

- [ ] **Step 2: Add failure-order scenarios**

Inject active/stale/malformed locks; malformed/dual state; planning PR
closed/missing/ambiguous; direct merge; wrong target/base/head/status/marker/
closing reference/URL; remote-head mismatch; non-descendant commits; validation
state-write failure; finish hook failure; cleanup conflict; and done-label
failure. For every implementation proof failure, assert no cost, visual,
handoff, hook, workspace, branch, or done-label effect begins.

- [ ] **Step 3: Run new scenarios and verify meaningful failures before fixes**

```sh
node --test src/cli/commands/run-once/planning-pipeline-scenarios.test.ts
```

Expected on first addition: any missing wiring or ordering assertion FAILS for a
specific external effect. Repair production code at the owning task boundary; do
not weaken the assertions.

- [ ] **Step 4: Run the complete legacy run-once scenario set unchanged**

```sh
npm run test:run-once
```

Expected: PASS. In particular, unfinished legacy state must retain prior labels,
artifact comments, approval behavior, worktree reuse, configured direct-land,
result statuses, handoff, cleanup ordering, and recovery/reset behavior.

- [ ] **Step 5: Commit scenario coverage and any targeted regression fix**

```sh
git add src/cli/commands/run-once/planning-pipeline-scenarios.test.ts
git add -u src/cli/commands/run-once
git diff --cached --check
git commit -m "test(run-once): cover planning workflow integration"
```

Expected: the staged diff contains the new behavior scenarios and only targeted
production/test corrections required by a failing scenario.

## Task 10: Run final validation and audit issue scope

**Files:**

- Verify: all files changed by Tasks 1-9
- Do not modify: dependency metadata, installed skills, generated config,
  examples, or user documentation

**Interfaces:**

- Consumes: the complete implementation branch.
- Produces: reproducible validation evidence and a clean handoff-ready branch.

- [ ] **Step 1: Run focused planning and pull-request suites**

```sh
node --test \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-publication-regressions.test.ts \
  src/workflow/planning-implementation-body.test.ts \
  src/workflow/planning-pull-request-validation.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-implementation-validation.test.ts \
  src/cli/commands/run-once/planning-implementation.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-selection.test.ts \
  src/cli/commands/run-once/planning-pipeline.test.ts \
  src/cli/commands/run-once/planning-pipeline-scenarios.test.ts \
  src/cli/commands/run-once/result-summary.test.ts \
  src/cli/commands/run-once/result-output.test.ts \
  src/cli/commands/run-once/terminal-result.test.ts
```

Expected: all focused state, coordinator, concurrency, validation, finish, and
public-contract tests PASS.

- [ ] **Step 2: Run the approved final validation commands exactly**

```sh
npm run test:run-once
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
git diff --check
```

Expected: every command exits with status `0`.

- [ ] **Step 3: Apply the AGENTS.md dependency/Nix condition**

```sh
if git diff --name-only origin/main...HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json | grep -q .; then
  nix build .#patchmill --print-build-logs
else
  echo "Nix build skipped: npm dependency metadata unchanged"
fi
```

Expected for this issue: print the skip message. If retained dependency metadata
changed unexpectedly, the Nix build must run and exit `0`.

- [ ] **Step 4: Audit scope and safety boundaries directly**

```sh
git diff --name-only origin/main...HEAD
rg -n "allowDirectLand: false|phase=implementation|Closes #" \
  src/cli/commands/run-once src/workflow
rg -n "runCleanupHookScript|removeWorktree|removeBranch|applyLabels" \
  src/cli/commands/run-once/planning-finish.ts \
  src/cli/commands/run-once/planning-implementation.ts
```

Expected: no dependency, installed skill-pack, generated configuration, example,
or user-documentation changes; the implementation marker and forced
pull-request-only policy are present; validation persists before every finish
operation; and legacy finish remains in `pipeline-finish.ts` unchanged.

- [ ] **Step 5: Inspect the final branch**

```sh
git status --short
git log --oneline --decorate -12
```

Expected: no uncommitted tracked changes, no `.pi/todos` files staged, and
focused Conventional Commits corresponding to Tasks 1-9. Do not create a live
GitHub or Forgejo pull request as part of automated validation.
