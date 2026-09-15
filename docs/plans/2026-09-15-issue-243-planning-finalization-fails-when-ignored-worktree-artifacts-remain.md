# Recoverable Cleanup-Pending Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve ignored phase-workspace artifacts at finalization, report a
durable and actionable `cleanup-pending` result, and resume cleanup safely after
operator acknowledgment without replaying completed finish effects.

**Architecture:** Replace the cleanup layer's boolean ignored-content guard with
a typed removal assessment that distinguishes ordinary dirty state from an exact
ignored-path inventory. Persist that inventory in the existing `planning-pr-v1`
workspace cleanup checkpoint, propagate a nonfailure outcome through phase and
pipeline orchestration, and keep comment/label/output policy in a focused CLI
module. A retry re-assesses the same owned phase workspace and advances directly
to worktree and branch removal only after every blocker is gone.

**Tech Stack:** TypeScript 6, Node.js 22, Git porcelain v1 `-z`, `node:test`,
real-Git and provider-process fixtures, the existing `planning-pr-v1` state
store and run-once result renderer, and Astro documentation; no new dependency.

**Spec:**
`docs/specs/2026-09-15-issue-243-planning-finalization-fails-when-ignored-worktree-artifacts-remain-design.md`

## Global Constraints

- Use the domain terms **Issue run**, **Run attempt**, **Run recovery state**,
  and **phase workspace** from `CONTEXT.md`.
- Do not force-remove, clean, reset, stash, copy, archive, hash, upload, inspect
  file contents, or silently delete ignored content.
- Do not classify ignored paths as disposable by name. `.pi/`, `.env`, build
  output, test output, and unknown ignored paths follow the same policy.
- Tracked, staged, and ordinary untracked changes remain
  `PlanningWorkspaceConflictError("dirty-worktree")` blockers, including a
  change that appears between the ordinary and complete status reads.
- Preserve workspace ownership, registration, path, saved head OID, remote-head,
  and branch-deletion checks exactly; no pending outcome may invoke worktree
  removal, branch deletion, done-label effects, or phase completion.
- Add `cleanup-pending` to existing workflow version `planning-pr-v1`; do not
  migrate existing `ready`, `worktree-removed`, or `removed` state and do not
  add a configuration key.
- A pending retry skips checkpointed cost publication, visual-evidence
  validation, handoff, and cleanup-hook effects. It refreshes only the ignored
  inventory, without a state revision when that inventory is unchanged.
- `cleanup-pending` is warning-level and exit-zero for the Run attempt, while
  the Issue run and current phase remain incomplete.
- After the durable pending checkpoint, post an idempotent actionable comment,
  apply `needs-info`, and remove `ready` and `in-progress`. Only the configured
  ready label acknowledges a retry.
- Render ignored path names with control characters escaped. Keep the exact raw
  repository-relative names in durable state and redirected JSON.
- Keep `planning-state-validation.ts` (currently about 556 lines) and
  `planning-pipeline.ts` (currently about 465 lines) from growing further:
  extract workspace-state decoding and cleanup-pending result/lifecycle policy
  into focused modules. Put new state, output, and pipeline regressions in new
  focused test files instead of expanding existing 500–1,100 line suites.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If a dependency file changes unexpectedly, run the Nix build required by
  `AGENTS.md`.

---

## File and Module Map

### Git removal assessment

- `src/git/planning-workspaces.ts` — own the pending cleanup state, typed
  worktree-removal outcome, and lifecycle interface.
- `src/git/planning-workspace-inspection.ts` — parse complete NUL-delimited
  status into ordinary-dirty evidence and a deterministic ignored-path inventory
  without changing normal `inspect()` cleanliness.
- `src/git/planning-workspace-cleanup.ts` — retain ownership/head guards and
  return pending before `git worktree remove` when only ignored paths remain.
- `src/git/planning-workspace-git.ts` — expose the typed cleanup operation.
- `src/git/planning-workspace-cleanup-pending.test.ts` — focused parser and
  real-Git preservation/destructive-boundary regression coverage.
- `src/git/planning-workspace-git.test.ts` and
  `src/git/planning-workspaces.test.ts` — update established lifecycle fakes and
  assertions for the typed removal result.

### Durable state

- `src/workflow/planning-state-workspace-codec.ts` — extracted workspace and
  cleanup decoder, including repository-relative ignored-path validation.
- `src/workflow/planning-state-validation.ts` — consume the focused workspace
  decoder and keep cross-phase cleanup invariants.
- `src/workflow/planning-state-types.ts` — add the `cleanup-pending` cleanup
  discriminator.
- `src/workflow/planning-state-transitions.ts` — permit only ready-to-pending,
  pending refresh, and pending-to-worktree-removed transitions.
- `src/workflow/planning-state-cleanup-pending.test.ts` — codec, serialization,
  transition, immutable-evidence, and completion regressions.

### Finish and phase propagation

- `src/cli/commands/run-once/planning-finish.ts` — checkpoint and return
  implementation cleanup pending, or continue cleanup after blockers clear.
- `src/cli/commands/run-once/planning-phase-cleanup.ts` — apply the same typed
  retry contract to spec and plan planning pull requests.
- `src/cli/commands/run-once/planning-phase-publisher.ts` and
  `planning-phase-reconciler.ts` — stop at pending cleanup before review/merge
  classification advances.
- `src/cli/commands/run-once/planning-phase-runner-shared.ts`,
  `planning-phase-runner-planning.ts`,
  `planning-phase-runner-implementation.ts`, and `planning-phase-coordinator.ts`
  — propagate one common pending outcome.
- Focused finish, cleanup, publisher, reconciler, runner, and coordinator tests
  — prove retry behavior and prevent another caller from converting pending to a
  generic failure.

### Public lifecycle and result

- `src/cli/commands/run-once/types.ts` — add the pipeline-owned rich
  `cleanup-pending` result.
- `src/cli/commands/run-once/planning-cleanup-pending.ts` — build exact result
  evidence and remediation, escape path diagnostics, render the pending comment,
  and publish idempotent operator effects.
- `src/cli/commands/run-once/planning-lifecycle-labels.ts` — apply the explicit
  needs-info boundary from a fresh issue read.
- `src/cli/commands/run-once/planning-pipeline.ts` — minimally wire pending
  publication and result mapping after durable checkpointing.
- `src/cli/commands/run-once/planning-selection.ts` — retain active state while
  requiring ready-label acknowledgment after needs-info.
- `src/cli/commands/run-once/result-summary.ts`, `result-output.ts`, and
  `terminal-result.ts` — expose redirected JSON, warning JSONL/terminal output,
  and exit code `0`.

### End-to-end regression and operator docs

- `test-support/run-once/planning-provider-scenario.ts`,
  `planning-provider-scenario-types.ts`, `planning-provider-runner.ts`, and
  `planning-provider-git.ts` — let one real-Git provider scenario create and
  later clear representative ignored implementation artifacts.
- `src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts` — cover
  the cleanup-hook checkpoint, pending retries, labels/comments, preserved
  bytes, output, and eventual completion.
- `site/src/content/docs/using-patchmill/run-once.md`,
  `site/src/content/docs/reference/agent-workflow-lifecycle.md`, and
  `site/src/content/docs/getting-started/configuration.md` — document the hook
  boundary and safe operator retry.

## Public Interfaces

Use these names and shapes consistently across tasks:

```ts
// src/git/planning-workspaces.ts
export type PlanningWorkspaceCleanupPending = Readonly<{
  state: "cleanup-pending";
  reason: "ignored-worktree-content";
  ignoredPaths: readonly string[];
}>;

export type PlanningWorkspaceCleanup =
  | Readonly<{ state: "ready" }>
  | PlanningWorkspaceCleanupPending
  | Readonly<{ state: "worktree-removed"; pushedHeadOid: string }>
  | Readonly<{ state: "removed"; pushedHeadOid: string }>;

export type PlanningWorkspaceRemovalOutcome =
  | Readonly<{
      kind: "removed";
      snapshot: Extract<
        PlanningWorkspaceSnapshot,
        { state: "branch-only" | "missing" }
      >;
    }>
  | Readonly<{
      kind: "cleanup-pending";
      reason: "ignored-worktree-content";
      ignoredPaths: readonly string[];
    }>;
```

`PlanningWorkspaceLifecycle.removeWorktree()` accepts ownership whose cleanup
state is `ready` or `cleanup-pending` and returns
`Promise<PlanningWorkspaceRemovalOutcome>`.

```ts
// src/cli/commands/run-once/planning-phase-runner-shared.ts
export type PlanningCleanupPendingOutcome = Readonly<{
  kind: "cleanup-pending";
  state: PlanningStateV1;
  phase: "spec" | "plan" | "implementation";
  prUrl: string;
  reason: "ignored-worktree-content";
  ignoredPaths: readonly string[];
}>;
```

`PlanningPhaseRunnerOutcome` and `PlanningCoordinatorOutcome` include this exact
variant. `finishPlanningImplementation()` returns either this pending evidence
plus the durable implementation result, or its existing completed evidence.

```ts
// src/cli/commands/run-once/types.ts
export type AgentIssueCleanupPendingResult = {
  status: "cleanup-pending";
  issue: IssueSummary;
  phase: "spec" | "plan" | "implementation";
  prUrl: string;
  branch: string;
  worktreePath: string;
  reason: "ignored-worktree-content";
  ignoredPaths: string[];
  remediation: string[];
  specPath?: string | undefined;
  planPath?: string | undefined;
  commits?: string[] | undefined;
  validation?: string[] | undefined;
};
```

The redirected summary removes `issue`, adds `issueNumber`, and otherwise keeps
the spec's exact fields. Implementation pending results include `commits` and
`validation`; spec/plan pending results omit them.

## Testing Value Gate

Every planned automated test passes Patchmill's Testing Value Gate:

- Git tests protect a destructive data-loss boundary, exact NUL path parsing,
  ordinary-dirty race handling, and byte preservation.
- State tests protect a reusable durable codec and legal retry transitions.
- Finish tests protect idempotence across the reported
  `cleanupHookCompleted: true` plus `ready` intermediate checkpoint.
- Pipeline tests protect lifecycle selection, host effects, result contracts,
  and eventual completion across Run attempts.
- Output tests protect redirected JSON, JSONL severity, terminal safety, and the
  process exit-code API.

Do not add tests that assert documentation prose, static configuration, package
metadata, or dependency versions. Verify documentation through lint and the site
build, and verify dependency scope with `git diff`.

---

### Task 1: Return a typed, non-destructive worktree-removal assessment

**Files:**

- Modify: `src/git/planning-workspaces.ts`
- Modify: `src/git/planning-workspace-inspection.ts`
- Modify: `src/git/planning-workspace-cleanup.ts`
- Modify: `src/git/planning-workspace-git.ts`
- Create: `src/git/planning-workspace-cleanup-pending.test.ts`
- Modify: `src/git/planning-workspace-git.test.ts`
- Modify: `src/git/planning-workspaces.test.ts`

**Interfaces:**

- Consumes: saved `PlanningWorkspaceOwnership`, normal ordinary-status
  inspection, and complete
  `git status --porcelain=v1 -z --untracked-files=all --ignored=matching` bytes.
- Produces: `PlanningWorkspaceCleanupPending`,
  `PlanningWorkspaceRemovalOutcome`, and a lifecycle operation that never runs
  `git worktree remove` when either ordinary or ignored content is present.

- [ ] **Step 1: Write focused failing parser and removal tests**

Create `planning-workspace-cleanup-pending.test.ts`. Export a pure parser or
repository method from `planning-workspace-inspection.ts` and exercise records
without line splitting:

```ts
const assessment = parsePlanningWorkspaceRemovalStatus(
  "!! .env\0" + "!! build/output\nname.bin\0" + "!! .env\0",
);
assert.deepEqual(assessment, {
  ordinaryDirty: false,
  ignoredPaths: [".env", "build/output\nname.bin"],
});
```

Add a complete-status case containing `" M tracked.txt\0"` or
`"?? ordinary.txt\0"` and assert `ordinaryDirty: true` even if ignored entries
also exist. Assert malformed missing-NUL responses and empty ignored-status path
records raise `PlanningWorkspaceResponseError` rather than being interpreted as
safe.

Use a real repository/worktree with `.gitignore` entries for `.env`, `.pi/`,
`build/`, `test-results/`, and `.unknown/`. Write distinct sentinel bytes, call
`removeWorktree()`, and assert:

```ts
assert.deepEqual(result, {
  kind: "cleanup-pending",
  reason: "ignored-worktree-content",
  ignoredPaths: [".env", ".pi/", ".unknown/", "build/", "test-results/"],
});
assert.deepEqual(await readFile(join(path, ".env")), envBytes);
assert.equal(
  calls.some((args) => args[0] === "worktree" && args[1] === "remove"),
  false,
);
```

Then remove the sentinels and call the same operation with saved
`cleanup-pending` ownership. Assert it returns `{ kind: "removed", snapshot }`
and the snapshot is `branch-only`. Add table cases proving tracked, staged, and
ordinary untracked content still throws `dirty-worktree`; make one case return
ordinary content only from the second complete-status read to cover the race.

- [ ] **Step 2: Run the focused test and verify the regression**

Run:

```sh
node --test src/git/planning-workspace-cleanup-pending.test.ts
```

Expected: FAIL because the parser, pending cleanup type, and typed removal
outcome do not exist, while ignored content currently throws `dirty-worktree`.

- [ ] **Step 3: Parse complete status without changing path spelling**

In `planning-workspace-inspection.ts`, add:

```ts
export type PlanningWorkspaceRemovalStatus = Readonly<{
  ordinaryDirty: boolean;
  ignoredPaths: readonly string[];
}>;

export function parsePlanningWorkspaceRemovalStatus(
  stdout: string,
): PlanningWorkspaceRemovalStatus;

class PlanningWorkspaceRepositoryGit {
  async removalStatus(path: string): Promise<PlanningWorkspaceRemovalStatus>;
}
```

Require an empty response or a trailing NUL. Split only on `"\0"`; records
starting with `"!! "` contribute their exact `slice(3)` value, while every other
nonempty record makes `ordinaryDirty` true. Deduplicate ignored paths and sort
them by JavaScript code-unit order so repeated reads produce a stable inventory.
Do not trim, unquote, normalize, or split a path containing whitespace/newlines.

Keep `inspect()` and its ordinary `clean(path)` call unchanged for in-place
resume. Replace `contentSafeToRemove()` with `removalStatus()` issuing the
existing complete-status command.

- [ ] **Step 4: Add the pending state and typed cleanup boundary**

Add the interfaces from **Public Interfaces** to `planning-workspaces.ts` and
change the lifecycle signature to:

```ts
removeWorktree(input: {
  runId: string;
  phase: PlanningPhaseKind;
  workspace: PlanningWorkspaceOwnership<
    | { state: "ready" }
    | PlanningWorkspaceCleanupPending
  >;
}): Promise<PlanningWorkspaceRemovalOutcome>;
```

In `PlanningWorkspaceCleanupGit.removeWorktree()`, preserve the current owner,
registration, path, and head assertions, then apply this order:

```ts
if (!snapshot.clean) {
  throw new PlanningWorkspaceConflictError(
    "dirty-worktree",
    workspace.identity,
  );
}
const content = await this.repository.removalStatus(path);
if (content.ordinaryDirty) {
  throw new PlanningWorkspaceConflictError(
    "dirty-worktree",
    workspace.identity,
  );
}
if (content.ignoredPaths.length > 0) {
  return {
    kind: "cleanup-pending",
    reason: "ignored-worktree-content",
    ignoredPaths: content.ignoredPaths,
  };
}
await this.repository.run(
  ["worktree", "remove", "--", path],
  "worktree-remove",
);
const after = await this.repository.inspect(workspace.identity);
if (after.state === "ready") {
  throw new PlanningWorkspaceConflictError(
    "unsafe-registration",
    workspace.identity,
  );
}
return { kind: "removed", snapshot: after };
```

Return `kind: "removed"` around the current missing and branch-only idempotence
paths as well. Do not pass `--force` and do not add a deletion command.

Update `PlanningWorkspaceGit.removeWorktree()` to preserve that exact input and
return type.

- [ ] **Step 5: Update established lifecycle fakes and assertions**

In `planning-workspaces.test.ts`, make `FakePlanningWorkspace.removeWorktree()`
return `{ kind: "removed", snapshot: this.snapshot }`. In
`planning-workspace-git.test.ts`, update snapshot assertions to read
`result.snapshot.state`, and replace the old ignored-content rejection assertion
with the pending outcome while retaining the tracked/staged/untracked rejection
matrix.

- [ ] **Step 6: Run Git cleanup regressions**

Run:

```sh
node --test \
  src/git/planning-workspace-cleanup-pending.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/git/planning-workspaces.test.ts
```

Expected: PASS. Exact ignored names and bytes remain, no destructive command is
recorded while pending, ordinary content still throws, and clearing blockers
allows idempotent removal.

- [ ] **Step 7: Commit the typed removal boundary**

```sh
git add \
  src/git/planning-workspaces.ts \
  src/git/planning-workspace-inspection.ts \
  src/git/planning-workspace-cleanup.ts \
  src/git/planning-workspace-git.ts \
  src/git/planning-workspace-cleanup-pending.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/git/planning-workspaces.test.ts
git commit -m "fix(git): report pending planning workspace cleanup"
```

---

### Task 2: Persist and constrain the cleanup-pending checkpoint

**Files:**

- Modify: `src/workflow/planning-state-types.ts`
- Create: `src/workflow/planning-state-workspace-codec.ts`
- Modify: `src/workflow/planning-state-validation.ts`
- Modify: `src/workflow/planning-state-transitions.ts`
- Create: `src/workflow/planning-state-cleanup-pending.test.ts`

**Interfaces:**

- Consumes: `PlanningWorkspaceCleanupPending` from Task 1 and existing strict
  state parsing/replacement.
- Produces: round-trippable pending state and only these new legal transitions:
  `ready -> cleanup-pending`, `cleanup-pending -> cleanup-pending`, and
  `cleanup-pending -> worktree-removed`.

- [ ] **Step 1: Write failing codec and transition tests**

Create `planning-state-cleanup-pending.test.ts` with a valid spec
`pull-request-open` fixture and a valid implementation `pull-request-open`
fixture whose finish state includes all checkpoints through
`cleanupHookCompleted`.

Assert parse/serialize round trips this exact cleanup evidence, including a path
with a newline:

```ts
cleanup: {
  state: "cleanup-pending",
  reason: "ignored-worktree-content",
  ignoredPaths: [".env", "build/output\nname.bin"],
}
```

For both phase kinds, construct revision-stepped replacements proving:

```text
ready -> cleanup-pending
cleanup-pending(paths A) -> cleanup-pending(paths B)
cleanup-pending -> worktree-removed -> removed
```

Assert an identical pending checkpoint is also a valid revision-stepped
replacement, while finish code in Task 3 decides not to write that unnecessary
revision.

Add rejection cases for an empty inventory, duplicate path, non-string, empty
path, NUL, absolute path, parent escape, wrong reason, unknown key, transition
back to `ready`, changed ownership/head evidence, cleanup before the
implementation hook checkpoint, and phase completion from pending.

- [ ] **Step 2: Run the state test and verify the missing discriminator**

Run:

```sh
node --test src/workflow/planning-state-cleanup-pending.test.ts
```

Expected: FAIL with `invalid-cleanup` or type errors because state decoding and
replacement do not recognize `cleanup-pending`.

- [ ] **Step 3: Extract focused workspace-state decoding**

Move the existing `workspace()` decoder out of the 556-line
`planning-state-validation.ts` into `planning-state-workspace-codec.ts`,
preserving its current ready/removed behavior before adding the new variant.
Export:

```ts
export function planningWorkspaceEvidence(
  value: unknown,
  path: string,
): PlanningWorkspaceOwnership;
```

Decode pending cleanup with exact keys `state`, `reason`, and `ignoredPaths`.
Validate each raw path as a nonempty repository-relative path of at most 4096
characters with no NUL and no absolute or parent escape. Do not trim or
normalize accepted newline, tab, space, backslash, or trailing-slash characters;
preserve each accepted string byte-for-byte and reject duplicates rather than
normalizing them.

Import this decoder from `planning-state-validation.ts`; do not change the
public `validatePlanningState()` entry point.

- [ ] **Step 4: Add pending-aware cross-field and replacement rules**

Extend `PlanningWorkspaceCleanup` through the Task 1 type. In
`planning-state-validation.ts`, compare `pushedHeadOid` with `headOid` only for
`worktree-removed` and `removed`; pending has no pushed-head evidence.
Workspace-ready and branch-pushed phases must still require `ready`, and every
complete pull-request phase must still require `removed`.

In `planning-state-transitions.ts`, add planning and implementation phase names
for pending cleanup. Extend `allowed` so ready may move to pending or directly
to worktree-removed, pending may refresh itself or move to worktree-removed, and
no later state regresses.

Update `assertWorkspace()` with an explicit same-pending rule:

```ts
if (
  current.cleanup.state === "cleanup-pending" &&
  next.cleanup.state === "cleanup-pending"
) {
  if (current.cleanup.reason !== next.cleanup.reason)
    fail("immutable-evidence", index, ".workspace.cleanup.reason");
  return; // the strict codec validated the replaceable complete inventory
}
```

Permit pending-to-worktree-removed only when `pushedHeadOid` equals the
immutable workspace `headOid`. Keep the existing implementation rule requiring
`cleanupHookCompleted` before any non-ready cleanup state.

- [ ] **Step 5: Run focused and established state suites**

Run:

```sh
node --test \
  src/workflow/planning-state-cleanup-pending.test.ts \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-publication-regressions.test.ts \
  src/workflow/planning-state-store.test.ts
```

Expected: PASS with old serialized state unchanged, malformed pending state
rejected, and no skipped cleanup or finish transition accepted.

- [ ] **Step 6: Commit the durable checkpoint**

```sh
git add \
  src/workflow/planning-state-types.ts \
  src/workflow/planning-state-workspace-codec.ts \
  src/workflow/planning-state-validation.ts \
  src/workflow/planning-state-transitions.ts \
  src/workflow/planning-state-cleanup-pending.test.ts
git commit -m "feat(workflow): checkpoint pending workspace cleanup"
```

---

### Task 3: Stop and resume phase finalization at cleanup pending

**Files:**

- Modify: `src/cli/commands/run-once/planning-finish.ts`
- Modify: `src/cli/commands/run-once/planning-finish.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-cleanup.ts`
- Modify: `src/cli/commands/run-once/planning-phase-cleanup.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.ts`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-shared.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-planning.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-phase-coordinator.ts`
- Create: `src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts`

**Interfaces:**

- Consumes: Task 1's removal outcome and Task 2's durable transitions.
- Produces: `PlanningCleanupPendingOutcome` from **Public Interfaces** at every
  spec, plan, and implementation cleanup caller, with deterministic retry and no
  later effect.

- [ ] **Step 1: Write failing implementation-finish retry tests**

Extend `planning-finish.test.ts` so the fake `removeWorktree()` can return a
sequence of pending/removed outcomes and record assessments separately from
actual removal.

Add these cases:

1. A normal finish runs and checkpoints the cleanup hook once, receives ignored
   paths, checkpoints `pull-request-open/cleanup-pending`, returns the validated
   PR result with pending evidence, and never calls branch or done-label
   effects.
2. A Run attempt starting from `cleanupHookCompleted: true` plus cleanup `ready`
   performs only removal assessment and checkpoints pending.
3. A retry from pending with the same inventory performs assessment but writes
   no state revision.
4. A retry with a changed inventory replaces the pending checkpoint exactly
   once.
5. A retry after blockers clear advances to worktree-removed, removes the
   branch, applies done labels, and completes as `pr-created` without replaying
   cost, visual, handoff, or cleanup-hook effects.

Use exact assertions such as:

```ts
assert.equal(outcome.kind, "cleanup-pending");
assert.deepEqual(outcome.ignoredPaths, [".env", "build/"]);
assert.equal(run.state().phases[0]?.status, "pull-request-open");
assert.equal(run.events.filter((event) => event === "cleanupHook").length, 1);
assert.equal(run.events.includes("branch"), false);
assert.equal(run.events.includes("applyDoneLabels"), false);
```

- [ ] **Step 2: Write failing generic phase-cleanup propagation tests**

Create `planning-phase-cleanup-pending.test.ts` around a spec planning pull
request. Make `removeWorktree()` first return pending, then unchanged pending,
then removed after blockers clear. Assert remote-head proof runs before each
ready/pending assessment, changed inventory checkpoints, unchanged inventory
does not, branch removal waits, and eventual cleanup reaches `removed`.

Add focused publisher/reconciler assertions that a pending helper result becomes
`kind: "cleanup-pending"` with the saved planning PR URL and prevents the second
host classification, merge proof, base fetch, and next phase. Add runner and
coordinator assertions that the same outcome returns unchanged instead of being
translated to `blocked`, `review-pending`, or `complete`.

- [ ] **Step 3: Run finish and phase tests to verify callers expect removal**

Run:

```sh
node --test \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts
```

Expected: FAIL because finish currently throws/continues, removal has no typed
branch, and phase outcomes have no cleanup-pending variant.

- [ ] **Step 4: Checkpoint implementation pending or continue cleanup**

Define `PlanningImplementationFinishOutcome` in `planning-finish.ts` as a union
of completed evidence and:

```ts
{
  kind: "cleanup-pending";
  state: PlanningStateV1;
  result: AgentIssuePrCreatedResult;
  reason: "ignored-worktree-content";
  ignoredPaths: readonly string[];
}
```

Treat workspace cleanup `ready` and `cleanup-pending` as removable candidates.
After `removeWorktree()`:

```ts
if (removal.kind === "cleanup-pending") {
  const cleanup = {
    state: "cleanup-pending" as const,
    reason: removal.reason,
    ignoredPaths: [...removal.ignoredPaths],
  };
  if (!isDeepStrictEqual(phase.workspace.cleanup, cleanup)) {
    phase = { ...phase, workspace: { ...phase.workspace, cleanup } };
    state = await checkpoint(input, state, phase);
  }
  return {
    kind: "cleanup-pending",
    state,
    result: durableImplementationResult(phase),
    reason: cleanup.reason,
    ignoredPaths: cleanup.ignoredPaths,
  };
}
```

Only the removed outcome checkpoints `worktree-removed` and reaches branch and
label code. Return `{ kind: "complete", state, result }` for both existing
complete state and newly completed state. Do not rerun an already checkpointed
finish effect.

- [ ] **Step 5: Give spec/plan cleanup the same typed retry contract**

Make `finishPlanningPhaseCleanup()` return:

```ts
type PlanningPhaseCleanupOutcome =
  | {
      kind: "cleanup-pending";
      phase: PullRequestOpenPlanningPhase;
      reason: "ignored-worktree-content";
      ignoredPaths: readonly string[];
    }
  | { kind: "cleaned"; phase: PullRequestOpenPlanningPhase };
```

For ready or pending state, revalidate the exact remote head and call
`removeWorktree()`. Checkpoint pending only when its complete inventory changed;
return immediately before branch deletion. On removed, checkpoint
`worktree-removed` directly, then retain existing branch-removal/idempotence
logic.

Change the `remoteHead` callback parameter to a narrow cleanup-candidate phase
rather than casting pending ownership to ready ownership. It still checks saved
publication and remote OID before every destructive attempt.

- [ ] **Step 6: Propagate one common pending phase outcome**

Add `PlanningCleanupPendingOutcome` to `planning-phase-runner-shared.ts` and
both runner/coordinator unions. In `planning-phase-publisher.ts` and
`planning-phase-reconciler.ts`, convert the cleanup helper's pending branch into
their own typed pending result before a second host read, review result, merge
proof, or base fetch.

Map those variants in `runPlanningSpecPlanPhase()`. In
`runPlanningImplementationPhase()`, map the finish union to:

```ts
if (finished.kind === "cleanup-pending") {
  return {
    kind: "cleanup-pending",
    state: finished.state,
    phase: "implementation",
    prUrl: finished.result.prUrl,
    reason: finished.reason,
    ignoredPaths: finished.ignoredPaths,
  };
}
```

Have `coordinatePlanningPhases()` return cleanup pending immediately. Do not
advance the completed prefix.

- [ ] **Step 7: Run focused phase and finish regressions**

Run the command from Step 3.

Expected: PASS. Both planning and implementation pull requests stay valid and
open while cleanup is pending, repeated effects remain single-shot, and clearing
blockers resumes directly through existing removal checkpoints.

- [ ] **Step 8: Commit retry-safe finalization**

```sh
git add \
  src/cli/commands/run-once/planning-finish.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-runner-shared.ts \
  src/cli/commands/run-once/planning-phase-runner-planning.ts \
  src/cli/commands/run-once/planning-phase-runner-implementation.ts \
  src/cli/commands/run-once/planning-phase-coordinator.ts
git commit -m "fix(run-once): resume pending planning cleanup"
```

---

### Task 4: Publish the recoverable operator lifecycle

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Create: `src/cli/commands/run-once/planning-cleanup-pending.ts`
- Create: `src/cli/commands/run-once/planning-cleanup-pending.test.ts`
- Modify: `src/cli/commands/run-once/planning-lifecycle-labels.ts`
- Modify: `src/cli/commands/run-once/planning-lifecycle-labels.test.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline.test.ts`
- Modify: `src/cli/commands/run-once/planning-selection.test.ts`

**Interfaces:**

- Consumes: Task 3's coordinator outcome and exact durable phase evidence.
- Produces: `AgentIssueCleanupPendingResult`, escaped actionable comments,
  needs-info labels, and explicit-ready retry eligibility.

- [ ] **Step 1: Write failing result-construction and operator-effect tests**

Create `planning-cleanup-pending.test.ts` with spec, plan, and implementation
coordinator outcomes. Assert `planningCleanupPendingResult()` finds the exact
active phase workspace and pull request, collects one durable spec/plan path,
and includes `commits`/`validation` only for implementation.

Assert these exact remediation intents without unsafe language:

```ts
assert.deepEqual(result.remediation, [
  `Inspect and preserve or remove the listed ignored paths in ${result.worktreePath}.`,
  "After every blocker is handled, apply `agent-ready` to issue #243.",
  "Rerun `patchmill run-once --issue 243`.",
]);
assert.doesNotMatch(result.remediation.join("\n"), /force|git clean|reset/u);
```

Test `formatPlanningCleanupPath()` with newline, tab, ESC, quote, backslash,
DEL, and C1 controls; output must contain visible JSON-style escapes and no raw
control character.

Use a recording host to call `publishPlanningCleanupPending()` twice with the
same issue/comment. Assert one comment is posted, the needs-info label is
ensured, and every label application is computed from a fresh read to remove
ready/in-progress while preserving unrelated labels.

- [ ] **Step 2: Write failing selection and pipeline-mapping tests**

In `planning-selection.test.ts`, use an active-state fixture whose workspace
cleanup is pending. Assert automatic selection returns `none` for `needs-info`,
and returns `planning` only after `agent-ready` is also present.

In `planning-pipeline.test.ts`, import a newly exported
`mapPlanningOutcome(issue, outcome, readyLabel)` and pass a cleanup-pending
coordinator outcome. Assert it returns the same exact rich evidence as
`planningCleanupPendingResult()`. Keep effect ordering in the
`publishPlanningCleanupPending()` test from Step 1: the input state is already
pending, comment/label failures propagate, and neither path mutates that state.
Task 5's real-Git scenario covers the one-line production wiring after
`runtime.coordinate()`.

- [ ] **Step 3: Run lifecycle tests and verify no public result exists**

Run:

```sh
node --test \
  src/cli/commands/run-once/planning-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-lifecycle-labels.test.ts \
  src/cli/commands/run-once/planning-selection.test.ts \
  src/cli/commands/run-once/planning-pipeline.test.ts
```

Expected: FAIL because the result variant, comment formatter, path escaping, and
cleanup-specific publication wiring do not exist.

- [ ] **Step 4: Build exact rich result and escaped comment data**

Add `AgentIssueCleanupPendingResult` from **Public Interfaces** to
`AgentIssuePipelineResult` in `types.ts`.

In `planning-cleanup-pending.ts`, export:

```ts
export function formatPlanningCleanupPath(path: string): string;
export function planningCleanupPendingResult(
  issue: IssueSummary,
  outcome: PlanningCleanupPendingOutcome,
  readyLabel: string,
): AgentIssueCleanupPendingResult;
export async function publishPlanningCleanupPending(input: {
  host: RunOnceHostProvider;
  config: AgentIssueConfig;
  result: AgentIssueCleanupPendingResult;
  labels: { ready: string; inProgress: string; needsInfo: string };
}): Promise<void>;
```

Implement `formatPlanningCleanupPath()` as a quoted JSON-style representation,
plus explicit `\\u00xx` escaping for DEL/C1 controls not escaped by
`JSON.stringify`. Keep `result.ignoredPaths` raw.

Add `cleanupPendingComment()` to `planning-cleanup-pending.ts` with the pull
request, phase, worktree, every escaped blocking path, and the three remediation
lines. Do not use blocker/failure wording and do not suggest force removal.
Keeping result construction, display escaping, comment rendering, and
publication in this cleanup-specific module avoids a dependency cycle with
`pipeline-comments.ts` and keeps the generic comment module unchanged.

- [ ] **Step 5: Apply and retry the needs-info boundary**

In `planning-lifecycle-labels.ts`, share a private fresh-read calculation
between the existing blocker behavior and a new
`applyPlanningCleanupPendingLabels()`. The cleanup function removes only the
configured ready/in-progress labels and adds needs-info, preserving planning
review and unrelated labels.

`publishPlanningCleanupPending()` must:

1. read current comments and post the exact body only when absent;
2. ensure the configured needs-info label exists; and
3. call `applyPlanningCleanupPendingLabels()`.

An unchanged retry therefore does not duplicate the comment. A changed ignored
inventory produces a new complete actionable comment.

- [ ] **Step 6: Wire pending publication after the durable outcome**

In `planning-pipeline.ts`, add a small `cleanup-pending` branch after
`runtime.coordinate()` returns. Build the rich result from the returned durable
state, publish its operator effects, then return the coordinator outcome. Rename
and export the current private mapper as
`mapPlanningOutcome(issue, outcome, readyLabel)`, and add a branch that calls
the same `planningCleanupPendingResult()` function. Keep result construction and
comment formatting out of the already-large pipeline module.

The existing claim mutation removes needs-info when ready acknowledges a retry;
do not add another selection mechanism. Preserve the current behavior that an
active state with needs-info but no ready label is ineligible.

- [ ] **Step 7: Run lifecycle and selection regressions**

Run the command from Step 3.

Expected: PASS. Pending state is durable before comment/label effects, output
retains the PR and phase workspace, automatic selection stops, and a ready label
reclaims the same Issue run.

- [ ] **Step 8: Commit the operator lifecycle**

```sh
git add \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/planning-cleanup-pending.ts \
  src/cli/commands/run-once/planning-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-lifecycle-labels.ts \
  src/cli/commands/run-once/planning-lifecycle-labels.test.ts \
  src/cli/commands/run-once/planning-pipeline.ts \
  src/cli/commands/run-once/planning-pipeline.test.ts \
  src/cli/commands/run-once/planning-selection.test.ts
git commit -m "feat(run-once): publish cleanup pending lifecycle"
```

---

### Task 5: Expose warning output and prove the full implementation retry

**Files:**

- Modify: `src/cli/commands/run-once/result-summary.ts`
- Modify: `src/cli/commands/run-once/result-summary.test.ts`
- Modify: `src/cli/commands/run-once/result-output.ts`
- Modify: `src/cli/commands/run-once/result-output.test.ts`
- Modify: `src/cli/commands/run-once/terminal-result.ts`
- Create: `src/cli/commands/run-once/planning-cleanup-pending-output.test.ts`
- Modify: `test-support/run-once/planning-provider-scenario-types.ts`
- Modify: `test-support/run-once/planning-provider-git.ts`
- Modify: `test-support/run-once/planning-provider-runner.ts`
- Modify: `test-support/run-once/planning-provider-scenario.ts`
- Create: `src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts`

**Interfaces:**

- Consumes: Task 4's rich pipeline result and the existing final result writer.
- Produces: exact redirected JSON, warning terminal/JSONL output, exit code `0`,
  and a real-Git Run-attempt regression that completes after operator cleanup.

- [ ] **Step 1: Extend the provider scenario with ignored artifact controls**

Add this reusable fixture input/type:

```ts
export type PlanningScenarioIgnoredArtifact = Readonly<{
  path: string;
  contents: string | Uint8Array;
}>;

createPlanningProviderScenario({
  provider,
  gates,
  ignoredImplementationArtifacts?: readonly PlanningScenarioIgnoredArtifact[],
});
```

`createPlanningScenarioRepository()` writes and commits exact `.gitignore`
patterns before the initial push. The provider runner creates configured
artifacts after the implementation commit/push but before returning
`pr-created`, preserving binary contents.

Expose fixture methods that return a cloned issue snapshot, remove only the
configured ignored artifacts from the saved implementation worktree, and apply
the configured ready label. Extend `PlanningStateSnapshot.cleanupState` with
`"cleanup-pending"`; include ignored paths only when tests explicitly request
the full durable state.

- [ ] **Step 2: Write the failing real-Git finalization regression**

Create `planning-pipeline-cleanup-pending.test.ts` with a GitHub process
fixture, no planning review gates, a successful cleanup hook, and these
representative artifacts:

```ts
[
  { path: ".env", contents: "TOKEN=local-only\n" },
  { path: ".pi/todos/issue-243.md", contents: "# local task\n" },
  { path: ".superpowers/progress.md", contents: "review\n" },
  { path: "build/output.bin", contents: Uint8Array.from([0, 36, 243, 255]) },
  { path: "test-results/result.json", contents: "{}\n" },
  { path: ".unknown/unique.txt", contents: "preserve me\n" },
];
```

Run through implementation and assert the first result is
`cleanup-pending/implementation`, retains the implementation PR URL, commits,
validation, branch, and worktree, and lists exact Git-reported blockers. Read
every surviving file and compare bytes. Assert durable state has
`cleanupHookCompleted: true`, cleanup is pending, and effects contain exactly
one cleanup hook but no implementation workspace removal, branch removal, or
done label.

Assert issue labels are needs-info without ready/in-progress and the escaped
comment exists once. An automatic second Run attempt must return `no-issue` and
produce no write effect. Apply ready without clearing blockers and rerun; assert
the same pending result, no durable revision for unchanged inventory, no comment
duplicate, and still one cleanup-hook effect.

Finally remove the configured artifacts, apply ready, and rerun. Assert
`pr-created`, terminal implementation state, one cleanup-hook effect total,
implementation workspace/branch removal, and done labels. The worktree removal
must occur only after the sentinel reads and explicit fixture removal.

- [ ] **Step 3: Add failing machine and terminal output assertions**

Create `planning-cleanup-pending-output.test.ts` and use the integration result
from Step 2 or an equivalent fixture. Assert `summarizeResult()` returns:

```ts
{
  status: "cleanup-pending",
  issueNumber: 243,
  phase: "implementation",
  prUrl,
  branch,
  worktreePath,
  reason: "ignored-worktree-content",
  ignoredPaths,
  remediation,
  specPath,
  planPath,
  commits,
  validation,
}
```

Assert `exitCodeForRunOnceResult()` is `0`, `terminalResultSeverity()` is
`"warning"`, and `writeRunOnceResult()` writes a warning-level final JSONL event
whose `data` is exactly the redirected summary.

Render a path containing `"line\nbreak\t\u001b[31m"`; assert terminal output has
`Final result: ! Cleanup pending`, a `Cleanup pending` section, reason, phase,
worktree, every escaped path, and remediation, with no raw newline injection or
ANSI sequence from the path.

- [ ] **Step 4: Run the new pipeline/output tests and verify the missing
      status**

Run:

```sh
node --test \
  src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending-output.test.ts
```

Expected: FAIL until result summary, severity, exit code, terminal sections, and
final log handling recognize the new status.

- [ ] **Step 5: Add the redirected summary and exit/log contract**

Add a `cleanup-pending` member to `RunOncePipelineResultSummary` matching the
spec's redirected shape. In `summarizeResult()`, copy raw arrays and optional
spec/plan/commit/validation fields without leaking the `IssueSummary` object.

Add `cleanup-pending` to the exit-zero branch of `exitCodeForRunOnceResult()`.
Since `writeRunOnceResult()` derives event level from terminal severity and
writes `data: summary`, no special JSONL path is needed beyond the status
severity. Add the new status to the established summary and exhaustive exit-code
test matrices.

- [ ] **Step 6: Render actionable warning output safely**

Add this status metadata to `terminal-result.ts`:

```ts
"cleanup-pending": { label: "Cleanup pending", severity: "warning" },
```

Create a `Cleanup pending` section containing phase and reason fields, a warning
list of `ignoredPaths.map(formatPlanningCleanupPath)`, and an arrow-marked
remediation list. The existing pull-request and issue/workspace sections carry
PR and worktree identity; implementation validation and commits continue to
render through their existing generic sections.

Pass only escaped ignored-path display strings to the terminal layout. Do not
change raw summary values or weaken the layout's terminal-sequence sanitization.

- [ ] **Step 7: Run focused output, pipeline, and provider recovery tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/planning-cleanup-pending-output.test.ts \
  src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts \
  src/cli/commands/run-once/result-summary.test.ts \
  src/cli/commands/run-once/result-output.test.ts \
  src/cli/commands/run-once/terminal-result.test.ts \
  src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts
```

Expected: PASS. The Run attempt is warning/exit-zero while pending, the Issue
run remains incomplete and unselected, unchanged retry is idempotent, and
clearing ignored blockers completes without replaying the hook.

- [ ] **Step 8: Commit the public result and full regression**

```sh
git add \
  src/cli/commands/run-once/result-summary.ts \
  src/cli/commands/run-once/result-summary.test.ts \
  src/cli/commands/run-once/result-output.ts \
  src/cli/commands/run-once/result-output.test.ts \
  src/cli/commands/run-once/terminal-result.ts \
  src/cli/commands/run-once/planning-cleanup-pending-output.test.ts \
  src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts \
  test-support/run-once/planning-provider-scenario-types.ts \
  test-support/run-once/planning-provider-git.ts \
  test-support/run-once/planning-provider-runner.ts \
  test-support/run-once/planning-provider-scenario.ts
git commit -m "feat(run-once): report pending workspace cleanup"
```

---

### Task 6: Document cleanup ownership and run complete verification

**Files:**

- Modify: `site/src/content/docs/using-patchmill/run-once.md`
- Modify: `site/src/content/docs/reference/agent-workflow-lifecycle.md`
- Modify: `site/src/content/docs/getting-started/configuration.md`
- Verify: every source, test, fixture, and documentation file changed by Tasks
  1–5

**Interfaces:**

- Consumes: the final result, lifecycle, retry, and hook contracts from Tasks
  1–5.
- Produces: operator guidance and complete project verification evidence.

- [ ] **Step 1: Document the cleanup-pending result and retry procedure**

In `site/src/content/docs/using-patchmill/run-once.md`:

- list `cleanup-pending` beside `review-pending` as an exit-zero resumable Run
  attempt result;
- explain that the implementation/planning PR remains valid but its Issue run is
  incomplete;
- add a recovery-table row directing the operator to inspect and preserve or
  remove every reported ignored path, then apply the configured ready label and
  rerun the same issue;
- state that unknown and familiar ignored names receive identical treatment;
- state that ordinary tracked/untracked changes remain hard failures; and
- state that Patchmill never force-cleans the phase workspace.

In `agent-workflow-lifecycle.md`, describe the durable pending checkpoint,
needs-info transition, lack of automatic reselection, and eventual done-label
transition after acknowledged safe cleanup.

In `getting-started/configuration.md`, clarify that `cleanupHook` owns external
resources, not Patchmill worktree deletion. A successful checkpointed hook is
not rerun because ignored local files later require operator cleanup.

Do not add a documentation-text test; lint and site compilation are the selected
direct verification.

- [ ] **Step 2: Run all focused issue regressions**

Run:

```sh
node --test \
  src/git/planning-workspace-cleanup-pending.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/git/planning-workspaces.test.ts \
  src/workflow/planning-state-cleanup-pending.test.ts \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-publication-regressions.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-selection.test.ts \
  src/cli/commands/run-once/planning-pipeline.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending-output.test.ts \
  src/cli/commands/run-once/planning-pipeline-cleanup-pending.test.ts \
  src/cli/commands/run-once/result-summary.test.ts \
  src/cli/commands/run-once/result-output.test.ts \
  src/cli/commands/run-once/terminal-result.test.ts
```

Expected: PASS with byte preservation, ordinary-dirty refusal, strict state
transitions, both cleanup callers, intermediate-checkpoint retry, lifecycle
acknowledgment, warning output, and eventual completion covered.

- [ ] **Step 3: Run required project verification**

Run each command separately and retain its exit status:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run site:build
```

Expected: every command exits `0`.

- [ ] **Step 4: Confirm dependency metadata did not change**

Run:

```sh
base_commit=$(git merge-base HEAD origin/main)
git diff --name-only "$base_commit"..HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json
```

Expected: no output. If any dependency file is listed unexpectedly, remove the
out-of-scope change or, only if it is truly required, run:

```sh
nix build .#patchmill --print-build-logs
```

Expected when required: exit `0`, satisfying `AGENTS.md`.

- [ ] **Step 5: Review acceptance evidence and scope**

Run:

```sh
git status --short
git diff --check
git diff --stat "$base_commit"
```

Expected: only issue-scoped Git cleanup, state, run-once orchestration/output,
test support, and operator documentation changed; `git diff --check` is silent.
Confirm the full scenario observed ignored bytes before operator deletion, one
cleanup hook across retries, no destructive command while pending, exact
worktree/path diagnostics, needs-info selection blocking, and final `pr-created`
completion.

- [ ] **Step 6: Commit documentation**

```sh
git add \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/getting-started/configuration.md
git commit -m "docs: explain pending planning workspace cleanup"
```

---

## Acceptance Mapping

| Acceptance criterion                                                 | Plan evidence                                                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful implementation has a supported terminal finalization path | Tasks 3–5 return warning/exit-zero `cleanup-pending`, preserve the validated PR, and later complete as `pr-created`.                                                 |
| Unknown ignored content is not silently deleted                      | Task 1 inventories all ignored paths path-agnostically, preserves sentinel bytes, and runs no removal command.                                                       |
| Tracked and ordinary untracked changes still block                   | Task 1 keeps ordinary status and late complete-status records on the existing `dirty-worktree` path.                                                                 |
| Hook/removal checkpoints cannot loop permanently                     | Tasks 2–3 persist pending state, skip the checkpointed hook, avoid unchanged revisions, refresh changed inventories, and advance after cleanup.                      |
| Operator action is explicit and actionable                           | Tasks 4–5 include phase, PR, worktree, escaped blocking paths, remediation, needs-info labels, and ready acknowledgment.                                             |
| Regression covers successful hook and intermediate retry             | Task 3 starts from `cleanupHookCompleted: true` plus `ready`; Task 5 exercises first pending, unchanged pending retry, and cleared-blocker completion with one hook. |
| Generic phase-workspace policy is preserved                          | Task 3 covers spec/plan planning-pull-request cleanup as well as implementation finalization.                                                                        |
