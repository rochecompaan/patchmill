# Durable Planning State and Pull Request Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict durable recovery state, ownership-ID locking, fetched
remote-base evidence, and a Git-backed lifecycle for safely creating, resuming,
and cleaning up planning phase workspaces.

**Architecture:** Keep pure state parsing and transition invariants under
`src/workflow/`, with filesystem durability and lock ownership in separate
modules. Refine the provider-neutral workspace contract in `src/git/`, then put
remote-base discovery, strict Git response parsing, and worktree effects behind
small adapters that consume complete saved ownership evidence. These modules
remain unwired from the current run-once workflow.

**Tech Stack:** TypeScript, Node.js 22.19+ filesystem APIs, Node's `node:test`
runner, Git CLI through `CommandRunner`, SHA-256 diagnostics, Prettier, ESLint,
strict TypeScript, and dependency-cruiser.

**Spec:**
`docs/specs/2026-09-07-issue-187-add-durable-planning-state-and-pull-request-workspaces-design.md`

## Global Constraints

- Keep the durable namespace exactly
  `<runStateDir>/planning-pr-v1/{issues,locks}`; do not reuse current run state
  or Issue run leases.
- Keep state `version` equal to `1` and `workflowVersion` equal to
  `planning-pr-v1`.
- Create one UUID `runId` for an Issue run and retain it across Run attempts;
  create a new unguessable `ownershipId` for every lock acquisition.
- Reject unknown keys at every state and lock object level. Never coerce,
  repair, or partially merge persisted documents.
- Require complete-document state replacement under the matching live issue
  lock, immutable Issue run identity, and an exact one-step revision increment.
- Use exclusive mode-`0600` creation for lock and temporary state files, flush
  file contents before close, replace state by same-directory rename, and sync
  the parent directory where supported.
- Never take over, archive, replace, or repair an existing planning lock.
- Classify an existing lock as `active`, `stale`, `unverifiable`, or
  `malformed`; age is diagnostic only and never authorizes mutation.
- Fetch the configured remote branch with an explicit refspec before each phase
  snapshot; use the resolved full object ID for artifact inspection and fresh
  workspace creation.
- Inspect planning artifacts from the pinned commit tree, not the working tree,
  and preserve zero, one, or multiple deterministic candidates.
- Fresh preparation never adopts an existing branch, path, or registration.
- Resume performs no fetch, reset, creation, or cleanup and accepts only the
  exact saved Run, phase, identity, base, and head.
- Cleanup consumes complete durable ownership evidence, refuses tracked,
  untracked, and ignored content, and never uses force, recursive filesystem
  deletion, `git clean`, `git reset`, name-pattern sweeps, merge, or rebase.
- Delete a local branch only after proving the exact configured remote branch
  equals the saved pushed head, and use expected-old-object compare-and-swap.
- Keep production modules focused. Use a public facade plus private validation
  modules for state, and extract strict worktree response parsing rather than
  growing an effect module beyond roughly 200 meaningful lines.
- Do not add dependencies or configuration keys.
- Do not run planning agents, create or reconcile pull requests, select phases,
  push branches, or wire these modules into `run-once`.
- Existing state, leases, workspaces, host factories, labels, publication, and
  CLI behavior must remain unchanged.

---

## File and Module Map

### Workflow state and locking

- Create `src/workflow/planning-state-types.ts` for the exact version-1 state
  and discriminator types used by the public state facade.
- Create `src/workflow/planning-state-validation.ts` for strict object readers,
  bounded scalar validation, cross-field invariants, and stable validation
  errors.
- Create `src/workflow/planning-state.ts` as the public owner of state creation,
  parsing, canonical serialization, and replacement-transition validation; it
  re-exports the public version-1 types and validation error.
- Create `src/workflow/planning-state.test.ts` for round trips, strict schema
  rejection, cross-field contradictions, and replacement rules.
- Create `src/workflow/planning-issue-lock.ts` for planning lock paths, exact
  record parsing, exclusive acquisition, diagnostics, ownership verification,
  and idempotent release.
- Create `src/workflow/planning-issue-lock.test.ts` for acquisition races,
  ownership checks, release retries, and all conflict classifications.
- Create `src/workflow/planning-state-store.ts` for planning state paths, reads,
  initialization, and atomic complete-document replacement.
- Create `src/workflow/planning-state-store.test.ts` for lock-fenced writes,
  optimistic revision conflicts, file mode, canonical bytes, crash safety, and
  directory isolation.

### Git infrastructure

- Modify `src/git/planning-workspaces.ts` to make pinned remote-base snapshots
  and complete saved workspace ownership first-class contract values, and add
  stable command/response error types.
- Modify `src/git/planning-workspaces.test.ts` to exercise the refined contract
  through a command-free fake adapter.
- Create `src/git/planning-remote-base.ts` for fetch, pinned-ref resolution,
  configured artifact-directory normalization, and commit-tree discovery.
- Create `src/git/planning-remote-base.test.ts` for recording-runner command
  contracts and real-Git artifact discovery.
- Create `src/git/planning-worktree-porcelain.ts` for strict parsing of
  `git worktree list --porcelain -z` output.
- Create `src/git/planning-worktree-porcelain.test.ts` for attached, detached,
  malformed, duplicate-path, and duplicate-branch records.
- Create `src/git/planning-workspace-git.ts` for inspection, fresh creation,
  exact resume, and the two idempotent cleanup operations.
- Create `src/git/planning-workspace-git.test.ts` for recording-runner command
  behavior and real repositories with local bare remotes.

No current `src/cli/`, `src/config/`, provider, package, or lockfile module is
modified.

## Public Data Shapes

The implementation tasks use these names consistently:

```ts
// src/git/planning-workspaces.ts
export type PlanningArtifactCandidates = Readonly<{
  spec: readonly string[];
  plan: readonly string[];
}>;

export type PlanningRemoteBaseSnapshot = Readonly<{
  remote: string;
  baseBranch: string;
  baseOid: string;
  artifactCandidates: PlanningArtifactCandidates;
}>;

export type PlanningWorkspaceCleanup =
  | Readonly<{ state: "ready" }>
  | Readonly<{ state: "worktree-removed"; pushedHeadOid: string }>
  | Readonly<{ state: "removed"; pushedHeadOid: string }>;

export type PlanningWorkspaceOwnership<
  Cleanup extends PlanningWorkspaceCleanup = PlanningWorkspaceCleanup,
> = Readonly<{
  runId: string;
  phase: PlanningPhaseKind;
  identity: PlanningWorkspaceIdentity;
  remote: string;
  baseBranch: string;
  baseOid: string;
  headOid: string;
  cleanup: Cleanup;
}>;
```

```ts
// src/workflow/planning-state-types.ts
export type PlanningStateV1 = Readonly<{
  version: 1;
  workflowVersion: "planning-pr-v1";
  runId: string;
  issueNumber: number;
  issueTitle: string;
  gates: PlanningGateSnapshot;
  phases: readonly PlanningPhaseStateV1[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PlanningPhaseStateV1 =
  | Readonly<{ kind: PlanningPhaseKind; status: "pending" }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "workspace-ready";
      base: PlanningBaseEvidence;
      workspace: PlanningWorkspaceEvidence;
    }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "pull-request-open";
      base: PlanningBaseEvidence;
      workspace: PlanningWorkspaceEvidence;
      artifacts: readonly PlanningArtifactEvidence[];
      pullRequest: PlanningPullRequestEvidence;
    }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "complete";
      base: PlanningBaseEvidence;
      artifacts: readonly PlanningArtifactEvidence[];
      completion: Readonly<{ kind: "remote-base" }>;
    }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "complete";
      base: PlanningBaseEvidence;
      workspace: PlanningWorkspaceEvidence;
      artifacts: readonly PlanningArtifactEvidence[];
      pullRequest: PlanningPullRequestEvidence;
      completion: Readonly<{
        kind: "merged-pull-request";
        mergeOid: string;
      }>;
    }>;
```

`PlanningBaseEvidence` aliases `PlanningRemoteBaseSnapshot`, and
`PlanningWorkspaceEvidence` aliases `PlanningWorkspaceOwnership`.
`PlanningArtifactEvidence` and `PlanningPullRequestEvidence` retain the exact
fields from the approved spec.

## Testing Value Gate

The planned automated tests pass Patchmill's Testing Value Gate:

- Strict state and lock tests prove reusable parsing, authorization,
  concurrency, and crash-safety behavior that can fail under meaningful
  regressions.
- Recording-runner tests prove command ordering, working directories, immutable
  object-ID use, safe arguments, and typed error classification without testing
  private implementation structure.
- Real-Git tests prove stale-clone fetching, commit-tree discovery, collision
  refusal, mutation-free resume, and destructive-cleanup boundaries against
  actual Git behavior.
- No new test asserts static documentation, configuration text, dependency
  versions, lockfile contents, or module import spelling. Runtime wiring and
  dependency absence are checked directly in final diff inspection.

---

### Task 1: Refine the planning workspace evidence contract

**Files:**

- Modify: `src/git/planning-workspaces.ts`
- Modify: `src/git/planning-workspaces.test.ts`

**Interfaces:**

- Consumes: `PlanningPhaseKind` from
  `src/workflow/planning-pull-request-markers.ts`.
- Produces: `PlanningArtifactCandidates`, `PlanningRemoteBaseSnapshot`,
  `PlanningWorkspaceCleanup`, and generic `PlanningWorkspaceOwnership`.
- Preserves: `PlanningWorkspaceIdentity`, `PlanningWorkspaceSnapshot`,
  `PreparedPlanningWorkspace`, and `PlanningWorkspaceLifecycle`, with `Sha`
  property names replaced by `Oid` and exact ownership inputs added.
- Produces: stable `PlanningWorkspaceConflictError`,
  `PlanningWorkspaceCommandError`, and `PlanningWorkspaceResponseError`.
- Later tasks consume only these high-level types; command arrays remain private
  to concrete Git adapters.

- [ ] **Step 1: Rewrite the fake-adapter test for pinned and owned inputs**

Update the fake in `src/git/planning-workspaces.test.ts` so the contract is used
through these calls:

```ts
const base: PlanningRemoteBaseSnapshot = {
  remote: "origin",
  baseBranch: "main",
  baseOid: "a".repeat(40),
  artifactCandidates: { spec: [], plan: [] },
};

const prepared = await workspace.prepare({
  runId: "123e4567-e89b-42d3-a456-426614174000",
  phase: "spec",
  identity,
  base,
});
assert.equal(prepared.workspace.baseOid, base.baseOid);

const resumed = await workspace.resume({
  runId: prepared.workspace.runId,
  phase: "spec",
  identity,
  base,
  saved: prepared.workspace,
});
assert.deepEqual(resumed, prepared.snapshot);

const branchOnly = await workspace.removeWorktree({
  runId: prepared.workspace.runId,
  phase: "spec",
  workspace: prepared.workspace,
});
assert.equal(branchOnly.state, "branch-only");
```

Have the fake's `removeBranch` accept a workspace whose cleanup discriminator is
`worktree-removed`; have `removeWorktree` permit `branch-only | missing` and
`removeBranch` return `missing`. Assert the fake receives saved ownership rather
than reconstructed branch and SHA strings.

- [ ] **Step 2: Run the contract test to prove RED**

Run:

```sh
node --test src/git/planning-workspaces.test.ts
```

Expected: FAIL with TypeScript/runtime export mismatches because the existing
contract has no pinned-base, ownership, or separate resume types.

- [ ] **Step 3: Implement the refined public contract**

Replace the lifecycle surface with this exact shape:

```ts
export interface PlanningWorkspaceLifecycle {
  prepare(input: {
    runId: string;
    phase: PlanningPhaseKind;
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
  }): Promise<PreparedPlanningWorkspace>;

  resume(input: {
    runId: string;
    phase: PlanningPhaseKind;
    identity: PlanningWorkspaceIdentity;
    base: PlanningRemoteBaseSnapshot;
    saved: PlanningWorkspaceOwnership;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "ready" }>>;

  inspect(
    identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot>;

  removeWorktree(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  }): Promise<
    Extract<PlanningWorkspaceSnapshot, { state: "branch-only" | "missing" }>
  >;

  removeBranch(input: {
    runId: string;
    phase: PlanningPhaseKind;
    workspace: PlanningWorkspaceOwnership<{
      state: "worktree-removed";
      pushedHeadOid: string;
    }>;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>>;
}
```

Use `headOid` and `baseOid` throughout. `PreparedPlanningWorkspace` has
`created: true`, `base`, `workspace` with `cleanup.state === "ready"`, and a
ready `snapshot`.

Expand conflict reasons to cover invalid saved identity, branch/path collision,
unsafe registration, base/head mismatch, dirty content, remote-head mismatch,
and configured-root containment. Define operation unions for fetch,
ref-resolution, tree inspection, worktree inspection/add/remove, status,
remote-head inspection, and branch deletion.

`PlanningWorkspaceCommandError` exposes only stable `operation` and `exitCode`
as enumerable fields; retain a frozen `CommandResult` as non-enumerable
`diagnostics`. `PlanningWorkspaceResponseError` exposes stable `operation` and
`reason`. No error message or enumerable field contains command arguments,
remote credentials, stdout, or stderr.

- [ ] **Step 4: Format and validate the refined seam**

Run:

```sh
npx --no-install prettier --write \
  src/git/planning-workspaces.ts \
  src/git/planning-workspaces.test.ts
node --test src/git/planning-workspaces.test.ts
npm run check:contract-tests
npm run check:types
npm run check:architecture
```

Expected: the fake-adapter contract test and all static checks PASS.

- [ ] **Step 5: Commit the contract refinement**

```sh
git add src/git/planning-workspaces.ts src/git/planning-workspaces.test.ts
git commit -m "refactor(git): refine planning workspace evidence"
```

---

### Task 2: Add strict versioned planning state

**Files:**

- Create: `src/workflow/planning-state-types.ts`
- Create: `src/workflow/planning-state-validation.ts`
- Create: `src/workflow/planning-state.ts`
- Create: `src/workflow/planning-state.test.ts`

**Interfaces:**

- Consumes: `PullRequestReference` from `src/host/pull-requests.ts`.
- Consumes: `PlanningGateSnapshot`, `PlanningArtifactKind`, and
  `planningPhasePlan` from `src/workflow/planning-pull-requests.ts`.
- Consumes: remote-base and workspace evidence from
  `src/git/planning-workspaces.ts`.
- Produces: every version-1 evidence and phase discriminator shown in the spec.
- Produces: `createPlanningState`, `parsePlanningState`,
  `validatePlanningState`, `serializePlanningState`, and
  `assertPlanningStateReplacement`.
- Produces: `PlanningStateValidationError` with stable `reason`, JSON `path`,
  and an optional safe `statePath` when filesystem reads supply document
  context.

- [ ] **Step 1: Write valid-state fixtures and round-trip tests**

Start `src/workflow/planning-state.test.ts` with one initial state for each gate
matrix row and fixture builders for all phase states. Use canonical UUIDs,
40-character lowercase object IDs, and ISO timestamps. Assert round trips for:

```ts
for (const phase of [
  pendingPhase,
  workspaceReadyPhase,
  pullRequestOpenPhase,
  remoteBaseCompletePhase,
  mergedPullRequestCompleteReady,
  mergedPullRequestCompleteWorktreeRemoved,
  mergedPullRequestCompleteRemoved,
]) {
  const state = validStateWithPhase(phase);
  assert.deepEqual(parsePlanningState(serializePlanningState(state)), state);
}
```

Also assert `createPlanningState` emits revision `0`, identical creation/update
timestamps, a phase record for every `planningPhasePlan(gates)` item in order,
and only `pending` phase records.

- [ ] **Step 2: Run the state test to prove RED**

Run:

```sh
node --test src/workflow/planning-state.test.ts
```

Expected: FAIL because the planning state modules do not exist.

- [ ] **Step 3: Define the exact state type graph and bounded scalar rules**

Put declarations only in `planning-state-types.ts`. Use `readonly` fields and
the exact discriminator shapes in this plan and the spec. Define:

```ts
export type PlanningArtifactEvidence = Readonly<{
  kind: PlanningArtifactKind;
  path: string;
  commitOid: string;
  source: "remote-base" | "workspace";
}>;

export type PlanningPullRequestEvidence = Readonly<{
  reference: PullRequestReference;
  baseBranch: string;
  headBranch: string;
  headOid: string;
}>;
```

In `planning-state-validation.ts`, apply these exact scalar predicates before
constructing typed output:

```ts
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
```

- IDs must be canonical UUID strings.
- Issue and pull request numbers must be positive safe integers.
- Revisions must be non-negative safe integers.
- `issueTitle` is non-empty, contains no NUL/CR/LF, and is at most 1,024 code
  units.
- Remote and repository identity fields are non-empty single-line strings of at
  most 1,024 code units; provider is exactly `github-gh` or `forgejo-tea`.
- Branches are at most 1,024 code units and reject leading `-`, controls,
  spaces, `..`, `@{`, backslash, `~^:?*[`, empty components, a trailing dot or
  slash, and a leading slash.
- Artifact paths are slash-normalized, repository-relative, at most 4,096 code
  units, and have no empty, `.` or `..` segment, NUL, CR, or LF.
- Worktree paths use the same 4,096-code-unit and control-character bounds, but
  may contain leading `..` segments because the configured worktree root may be
  outside the repository; the Git adapter later proves configured-root
  containment.
- Timestamps must match the regular expression, parse successfully, and equal
  `new Date(value).toISOString()`.

- [ ] **Step 4: Implement strict structural parsing and canonical output**

Use an `exactObject(value, allowedKeys, path)` helper that rejects arrays,
missing required keys, and every unknown own key. Parse every discriminator with
its own exact key set:

```text
pending:             kind,status
workspace-ready:     kind,status,base,workspace
pull-request-open:   kind,status,base,workspace,artifacts,pullRequest
complete/remote:     kind,status,base,artifacts,completion
complete/merged PR:  kind,status,base,workspace,artifacts,pullRequest,completion
```

Apply exact-key checks recursively to `gates`, `artifactCandidates`, artifact
evidence, workspace `identity`, each cleanup variant, pull request evidence,
`reference`, and nested repository identity.

Expose these exact signatures from `planning-state.ts`:

```ts
export function createPlanningState(input: {
  issueNumber: number;
  issueTitle: string;
  gates: PlanningGateSnapshot;
  runId?: string;
  now?: string;
}): PlanningStateV1;

export function validatePlanningState(value: unknown): PlanningStateV1;
export function parsePlanningState(raw: string): PlanningStateV1;
export function serializePlanningState(state: PlanningStateV1): string;
export function assertPlanningStateReplacement(
  current: PlanningStateV1,
  next: PlanningStateV1,
): void;
```

`PlanningStateValidationError` accepts `reason`, JSON `path`, and optional
`statePath`; its message includes only those safe values. `parsePlanningState`
maps `JSON.parse` failures to
`PlanningStateValidationError("invalid-json", "$")` without including raw bytes.
`validatePlanningState` reconstructs objects in the documented key order.
`serializePlanningState` validates again and returns two-space JSON plus exactly
one trailing newline.

- [ ] **Step 5: Add strict-schema and malformed-value tests**

Add table-driven copies of a valid state with one mutation per case. Cover
unknown top-level and nested keys, missing keys, unsupported versions, malformed
UUID/OID/timestamp/branch/path, invalid issue/revision/PR numbers, repeated
artifact kinds, and every forbidden field on each discriminator. Assert the
stable path as well as the reason:

```ts
assert.throws(
  () => validatePlanningState(candidate),
  (error: unknown) =>
    error instanceof PlanningStateValidationError &&
    error.reason === "unknown-key" &&
    error.path === "$.phases[0].workspace.cleanup.extra",
);
```

The named production mutation that makes these tests fail is accepting an
unrecognized or unbounded persisted value into recovery decisions.

- [ ] **Step 6: Implement document-level cross-field invariants**

After structural parsing, enforce all of these checks with stable reason/path
pairs:

1. Phase kinds are unique and exactly equal to
   `planningPhasePlan(gates).map(({ kind }) => kind)` in order.
2. Complete records form a prefix; pending records form a suffix; no more than
   one `workspace-ready` or `pull-request-open` record exists.
3. `artifacts` has exactly the phase's assigned artifact kinds in planner order
   (including an empty array for implementation where applicable).
4. Remote-base completion artifacts all have `source: "remote-base"`, use
   `base.baseOid`, and name a path in the matching
   `base.artifactCandidates[kind]` array.
5. Workspace-source artifacts use `workspace.headOid`; pull request evidence
   uses the workspace branch/head and the base branch.
6. Every workspace run/phase/remote/base tuple agrees with the containing state,
   phase, and base evidence. Ready and open phase records require
   `cleanup.state === "ready"`.
7. A `worktree-removed` or `removed` cleanup record has
   `pushedHeadOid === headOid` and can appear only in merged completion.
8. No two phase records share a branch or normalized worktree path.
9. Candidate arrays and artifact arrays contain no duplicates.
10. `updatedAt` is not earlier than `createdAt`.

- [ ] **Step 7: Add replacement-transition tests**

Test one valid transition for each allowed edge and one rejection for each
immutable or backward edge. The allowed graph is:

```text
pending -> workspace-ready | complete(remote-base)
workspace-ready -> workspace-ready | pull-request-open
pull-request-open -> pull-request-open | complete(merged-pull-request)
complete(merged, ready) -> complete(merged, worktree-removed)
complete(merged, worktree-removed) -> complete(merged, removed)
complete(remote-base) -> same complete(remote-base)
complete(merged, removed) -> same complete(merged, removed)
```

Same-status replacements preserve evidence except that `workspace.headOid` may
advance while `cleanup.state === "ready"`. When pull request or workspace-source
artifact evidence already exists, its `headOid`/`commitOid` must advance in the
same replacement; the pull request reference, base branch, and head branch stay
immutable. Once cleanup reaches `worktree-removed`, the saved head cannot
change. Assert that replacement rejects changes to version, workflow version,
run ID, issue number, issue title, gates, phase sequence, created timestamp,
workspace run/phase/identity/remote/base tuple, pull request identity, or
completion. Require `next.revision === current.revision + 1` and
`next.updatedAt >= current.updatedAt`.

- [ ] **Step 8: Implement replacement validation**

Have `assertPlanningStateReplacement` first strictly validate and normalize both
documents, then compare immutable fields and each phase transition. Use
`PlanningStateValidationError` for invalid next-document structure and a
transition reason/path for illegal state movement; reserve store-level conflict
errors for a changed file, lock, Run ID, or expected revision observed during
I/O.

- [ ] **Step 9: Format and run focused state validation**

Run:

```sh
npx --no-install prettier --write \
  src/workflow/planning-state-types.ts \
  src/workflow/planning-state-validation.ts \
  src/workflow/planning-state.ts \
  src/workflow/planning-state.test.ts
node --test src/workflow/planning-state.test.ts
npm run check:types
npm run check:architecture
```

Expected: every phase/cleanup round trip and rejection test passes, and the
state facade does not create an architecture cycle.

- [ ] **Step 10: Commit strict planning state**

```sh
git add \
  src/workflow/planning-state-types.ts \
  src/workflow/planning-state-validation.ts \
  src/workflow/planning-state.ts \
  src/workflow/planning-state.test.ts
git commit -m "feat(workflow): add strict planning state"
```

---

### Task 3: Add the ownership-ID planning issue lock

**Files:**

- Create: `src/workflow/planning-issue-lock.ts`
- Create: `src/workflow/planning-issue-lock.test.ts`

**Interfaces:**

- Consumes: UUID and timestamp semantics established by planning state; keep
  lock parsing independent from state bytes.
- Produces: `planningIssueLockPath`, `PlanningIssueLockRecord`,
  `PlanningIssueLock`, `PlanningIssueLockDiagnostic`,
  `parsePlanningIssueLockRecord`, `acquirePlanningIssueLock`,
  `assertPlanningIssueLockOwned`, and `releasePlanningIssueLock`.
- Produces: `PlanningIssueLockConflictError` whose diagnostic classification is
  `active | stale | unverifiable | malformed`.
- The state store in Task 4 calls `assertPlanningIssueLockOwned` immediately
  before every mutation.

- [ ] **Step 1: Write exact record and idempotent owner tests**

Create tests that acquire into a temporary run-state directory and assert:

```ts
const lock = await acquirePlanningIssueLock(
  runStateDir,
  {
    issueNumber: 187,
    runId,
  },
  {
    ownershipId,
    pid: 1234,
    hostname: "local.test",
    now: () => new Date("2026-09-07T12:00:00.000Z"),
  },
);

assert.equal(
  lock.path,
  join(runStateDir, "planning-pr-v1", "locks", "issue-187.lock"),
);
assert.equal((await stat(lock.path)).mode & 0o777, 0o600);
await assertPlanningIssueLockOwned(lock, { issueNumber: 187, runId });
await releasePlanningIssueLock(lock);
await releasePlanningIssueLock(lock);
```

Also parse the persisted bytes and assert the exact seven keys: `version`,
`issueNumber`, `runId`, `ownershipId`, `pid`, `hostname`, and `acquiredAt`.

- [ ] **Step 2: Add acquisition-race and non-owner release tests**

Start two acquisitions with distinct ownership IDs via `Promise.allSettled` and
assert exactly one fulfills. Replace the winning lock bytes with a valid record
that changes only `ownershipId`; assert owner verification and release reject,
the file still exists, and the other owner can release its own record. Add the
same preservation assertion for malformed current bytes.

- [ ] **Step 3: Add all existing-lock diagnostic tests**

Inject `hostname`, `processState`, and `now` options and cover:

- same host + `alive` => `active`;
- same host + `dead` => `stale`;
- same host + `unverifiable` => `unverifiable`;
- different host => `unverifiable` without invoking `processState`;
- invalid JSON, unknown keys, or invalid values => `malformed`.

For every case, compute the expected
`createHash("sha256").update(exactBytes).digest("hex")` and assert it equals the
diagnostic fingerprint. Assert safe owner fields include issue number, Run ID,
PID, host, and acquisition timestamp but not `ownershipId`. Assert elapsed time
does not change the classification.

- [ ] **Step 4: Run lock tests to prove RED**

Run:

```sh
node --test src/workflow/planning-issue-lock.test.ts
```

Expected: FAIL because the planning lock module does not exist.

- [ ] **Step 5: Implement exact lock parsing and exclusive acquisition**

Use this record shape and options seam:

```ts
export type PlanningIssueLockRecord = Readonly<{
  version: 1;
  issueNumber: number;
  runId: string;
  ownershipId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}>;

export type PlanningIssueLockOptions = Readonly<{
  ownershipId?: string;
  pid?: number;
  hostname?: string;
  now?: () => Date;
  processState?: (pid: number) => "alive" | "dead" | "unverifiable";
}>;
```

Validate exact keys, positive safe issue/PID values, canonical UUIDs, canonical
ISO timestamp, and host names matching `^[A-Za-z0-9_][A-Za-z0-9._-]{0,252}$`.
Build the path only from the trusted requested issue number.

Create the lock directory, then perform one `open(path, "wx", 0o600)`. Write
canonical compact JSON plus newline, call `handle.sync()`, and close. If writing
or syncing fails after this process created the file, close and unlink that
owned incomplete file before rethrowing. Never rename, archive, or retry over an
existing canonical lock.

- [ ] **Step 6: Implement conflict inspection, ownership verification, and
      release**

On `EEXIST`, read the exact bytes once, hash those bytes, parse them strictly,
and classify with same-host process liveness only. The default liveness check
uses `process.kill(pid, 0)`: success is alive, `ESRCH` is dead, and every other
failure is unverifiable.

Use this verification signature:

```ts
export async function assertPlanningIssueLockOwned(
  lock: PlanningIssueLock,
  expected: { issueNumber: number; runId: string; lockPath?: string },
): Promise<void>;
```

It rereads and strictly parses the canonical file and requires exact issue, Run,
ownership ID, and optional canonical path equality. Release calls the same logic
and unlinks only after it succeeds. An `ENOENT` during release is success; all
malformed or mismatched files remain untouched.

- [ ] **Step 7: Format and validate locking behavior**

Run:

```sh
npx --no-install prettier --write \
  src/workflow/planning-issue-lock.ts \
  src/workflow/planning-issue-lock.test.ts
node --test src/workflow/planning-issue-lock.test.ts
npm run check:types
npm run check:architecture
```

Expected: race, diagnostics, ownership, file-mode, and idempotent release tests
PASS.

- [ ] **Step 8: Commit the planning issue lock**

```sh
git add \
  src/workflow/planning-issue-lock.ts \
  src/workflow/planning-issue-lock.test.ts
git commit -m "feat(workflow): add planning issue lock"
```

---

### Task 4: Add the atomic planning state store

**Files:**

- Create: `src/workflow/planning-state-store.ts`
- Create: `src/workflow/planning-state-store.test.ts`

**Interfaces:**

- Consumes: strict parsing, serialization, and replacement validation from
  `src/workflow/planning-state.ts`.
- Consumes: `PlanningIssueLock` and `assertPlanningIssueLockOwned` from
  `src/workflow/planning-issue-lock.ts`.
- Produces: `planningStatePath`, `PlanningStateStore`, and
  `PlanningStateConflictError`.
- `PlanningStateStore` binds to one configured run-state directory and does not
  expose arbitrary output paths.

- [ ] **Step 1: Write initialization, read, and canonical-byte tests**

Create a temporary store and matching issue lock. Initialize revision zero and
assert the returned state, exact path, mode `0600`, trailing newline, and
`parsePlanningState(raw)` equality. Assert a second initialization reports
`state-exists` and preserves the original bytes. Assert a missing read returns
`undefined`, while malformed existing bytes throw `PlanningStateValidationError`
with its JSON `path`, canonical `statePath`, and a default message that omits
raw contents.

- [ ] **Step 2: Write replacement conflict tests**

For a valid revision-zero state, create a revision-one replacement. Assert
success only with matching `expectedRunId`, `expectedRevision`, issue, and live
lock. Add separate tests for changed Run ID, stale revision, wrong-issue lock,
wrong-Run lock, changed ownership ID, missing lock, malformed lock, malformed
state, and an invalid next transition. In each case assert the previous state
bytes remain unchanged.

- [ ] **Step 3: Write the pre-rename interruption test**

Construct the store with an injected `beforeRename` test hook that throws after
the temporary file has been flushed and closed. Assert:

```ts
await assert.rejects(store.replace(replacementInput), /injected interruption/);
assert.deepEqual(await store.read(187), revisionZero);
assert.deepEqual(
  (await readdir(dirname(store.path(187)))).filter((name) =>
    name.endsWith(".tmp"),
  ),
  [],
);
```

The production mutation caught by this test is writing the canonical file in
place or leaving a partial temporary file after a pre-rename failure.

- [ ] **Step 4: Run store tests to prove RED**

Run:

```sh
node --test src/workflow/planning-state-store.test.ts
```

Expected: FAIL because the planning state store does not exist.

- [ ] **Step 5: Implement path ownership and stable conflicts**

Use the exact path:

```ts
join(runStateDir, "planning-pr-v1", "issues", `issue-${issueNumber}.json`);
```

Expose:

```ts
export class PlanningStateStore {
  constructor(
    runStateDir: string,
    options?: {
      beforeRename?: (temporary: string, target: string) => Promise<void>;
    },
  );
  path(issueNumber: number): string;
  read(issueNumber: number): Promise<PlanningStateV1 | undefined>;
  initialize(input: {
    state: PlanningStateV1;
    lock: PlanningIssueLock;
  }): Promise<PlanningStateV1>;
  replace(input: {
    issueNumber: number;
    expectedRunId: string;
    expectedRevision: number;
    next: PlanningStateV1;
    lock: PlanningIssueLock;
  }): Promise<PlanningStateV1>;
}
```

`PlanningStateConflictError.reason` is one of `state-exists`, `state-missing`,
`run-id-mismatch`, `revision-mismatch`, `lock-path-mismatch`, or
`lock-ownership-mismatch`. Expose safe expected issue/Run/revision fields and
state path; never expose lock ownership ID or document bytes. When a state read
fails strict parsing, rethrow the same validation reason/JSON path with the
canonical file path in `statePath`. Map lock path/identity changes observed by
`assertPlanningIssueLockOwned` to the corresponding store conflict reason.

- [ ] **Step 6: Implement atomic complete-document replacement**

For initialize and replace:

1. Strictly validate the complete candidate before filesystem mutation.
2. Create the controlled issue directory recursively.
3. Reread and strictly parse the current state as required by the operation.
4. Verify expected Run/revision and call
   `assertPlanningStateReplacement(current, next)` for replacement.
5. Reread the canonical planning lock and verify issue, Run, ownership, and
   expected lock path immediately before writing.
6. Create `<target>.<randomUUID()>.tmp` with `open("wx", 0o600)` in the same
   directory.
7. Write `serializePlanningState(next)`, call file `sync()`, and close.
8. Invoke the test hook, then `rename(temporary, target)`.
9. Open and sync the parent directory. Ignore only documented unsupported
   directory-sync error codes (`EINVAL`, `ENOTSUP`, and Windows `EPERM`).
10. In `finally`, unlink a temporary file remaining after any pre-rename
    failure; ignore only `ENOENT`.

Initialization checks for an existing destination under the issue lock and
refuses to rename over it. Reads never rewrite, normalize, or repair bytes.

- [ ] **Step 7: Format and validate store behavior**

Run:

```sh
npx --no-install prettier --write \
  src/workflow/planning-state-store.ts \
  src/workflow/planning-state-store.test.ts
node --test \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-issue-lock.test.ts \
  src/workflow/planning-state-store.test.ts
npm run check:types
npm run check:architecture
```

Expected: state, lock, store, crash-boundary, and conflict tests PASS.

- [ ] **Step 8: Commit the atomic planning state store**

```sh
git add \
  src/workflow/planning-state-store.ts \
  src/workflow/planning-state-store.test.ts
git commit -m "feat(workflow): add atomic planning state store"
```

---

### Task 5: Fetch and pin remote-base artifact evidence

**Files:**

- Create: `src/git/planning-remote-base.ts`
- Create: `src/git/planning-remote-base.test.ts`

**Interfaces:**

- Consumes: `CommandRunner` from `src/process/command.ts`.
- Consumes: `PlanningRemoteBaseSnapshot`, `PlanningWorkspaceCommandError`, and
  `PlanningWorkspaceResponseError` from `src/git/planning-workspaces.ts`.
- Produces: `PlanningRemoteBaseGit`, bound to one repository root and configured
  specs/plans directories.
- Produces: a fetched immutable snapshot consumed by workspace preparation and
  persisted as planning base evidence.

- [ ] **Step 1: Write recording-runner fetch and parse tests**

Use `createStaticCommandRunner` to return a fetch success, a full OID, and a
NUL-delimited tree. Assert exact commands and `cwd`:

```ts
assert.deepEqual(runner.calls, [
  {
    command: "git",
    args: [
      "fetch",
      "--no-tags",
      "--",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ],
    cwd: repoRoot,
  },
  {
    command: "git",
    args: ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"],
    cwd: repoRoot,
  },
  {
    command: "git",
    args: [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      baseOid,
      "--",
      "docs/specs",
      "docs/plans",
    ],
    cwd: repoRoot,
  },
]);
```

Include tree entries with modes `100644`, `100755`, `120000`, and `160000`.
Assert only regular files whose basename contains `-issue-187-` are returned,
with repository-relative slash paths sorted separately under `spec` and `plan`.
Assert multiple candidates remain present rather than selecting one.

- [ ] **Step 2: Add path, output, and command failure tests**

Cover configured directories expressed as repository-relative and absolute
paths. Reject a directory that resolves outside `repoRoot` before any command.
Return empty arrays for absent tree prefixes and no matches. Reject truncated
NUL records, malformed mode/type/OID/path fields, unexpected duplicate entries,
and a non-full `rev-parse` OID as response errors. For each nonzero command
result, assert the correct command operation and that enumerable error fields
and default messages contain no stdout, stderr, refspec, or remote URL.

- [ ] **Step 3: Run remote-base tests to prove RED**

Run:

```sh
node --test src/git/planning-remote-base.test.ts
```

Expected: FAIL because the remote-base adapter does not exist.

- [ ] **Step 4: Implement configured path normalization and strict tree
      parsing**

Use `resolve(repoRoot, configured)` for relative inputs and
`resolve(configured)` for absolute inputs. Compute
`relative(repoRoot, absolute)`, reject an absolute result or a result beginning
with `..`, convert separators to `/`, and pass the repository-relative paths to
Git.

Parse each default `ls-tree -z` record as:

```text
<mode> SP <type> SP <full-object-id> TAB <repository-relative-path> NUL
```

Accept only mode `100644` or `100755` with type `blob`; ignore valid symlink and
gitlink records; reject malformed records globally. Apply the current local
artifact filename rule exactly to `basename(path)`:

```ts
basename(path).includes(`-issue-${issueNumber}-`);
```

Do not read or materialize a working-tree file.

- [ ] **Step 5: Implement fetched snapshot orchestration**

Expose:

```ts
export class PlanningRemoteBaseGit {
  constructor(input: {
    runner: CommandRunner;
    repoRoot: string;
    specsDir: string;
    plansDir: string;
  });

  fetch(input: {
    issueNumber: number;
    remote: string;
    baseBranch: string;
  }): Promise<PlanningRemoteBaseSnapshot>;
}
```

Validate issue, remote, and branch before commands. Use argument arrays and the
explicit branch refspec shown in Step 1. Resolve the remote-tracking commit
once, require a 40- or 64-character lowercase full object ID, and pass only that
OID to tree inspection. Return frozen/copied candidate arrays so moving refs
cannot change the snapshot.

- [ ] **Step 6: Add the stale-clone real-Git test**

Create a temporary bare remote, a seed repository, and a stale clone using
`execFileSync("git", ...)` only inside the test. Commit and push an old base,
clone it, then commit a newer base containing zero, one, and multiple issue
artifact cases in the seed and push again. Run `PlanningRemoteBaseGit.fetch`
from the stale clone and assert:

```ts
assert.equal(snapshot.baseOid, seedGit("rev-parse", "HEAD"));
assert.notEqual(snapshot.baseOid, staleOid);
assert.deepEqual(snapshot.artifactCandidates.spec, expectedSpecs);
assert.deepEqual(snapshot.artifactCandidates.plan, expectedPlans);
```

Delete or modify a corresponding file in the stale checkout before fetch and
assert the candidates still come from the pinned remote tree.

- [ ] **Step 7: Format and validate remote-base behavior**

Run:

```sh
npx --no-install prettier --write \
  src/git/planning-remote-base.ts \
  src/git/planning-remote-base.test.ts
node --test src/git/planning-remote-base.test.ts
npm run check:types
npm run check:architecture
```

Expected: recording-runner and real-Git fetch/discovery tests PASS.

- [ ] **Step 8: Commit remote-base evidence**

```sh
git add src/git/planning-remote-base.ts src/git/planning-remote-base.test.ts
git commit -m "feat(git): pin planning remote base"
```

---

### Task 6: Implement strict workspace creation and resume

**Files:**

- Create: `src/git/planning-worktree-porcelain.ts`
- Create: `src/git/planning-worktree-porcelain.test.ts`
- Create: `src/git/planning-workspace-git.ts`
- Create: `src/git/planning-workspace-git.test.ts`

**Interfaces:**

- Consumes: `CommandRunner` and the refined lifecycle/evidence types.
- Produces: `parsePlanningWorktreePorcelain` with complete attached worktree
  path, branch, and head evidence.
- Produces: `PlanningWorkspaceGit`, bound to one repository root and one
  configured worktree root, implementing `inspect`, fresh `prepare`, and exact
  mutation-free `resume` in this task.
- Task 7 adds cleanup to the same adapter without changing these signatures.

- [ ] **Step 1: Write strict `worktree --porcelain -z` parser tests**

Use actual NUL-delimited records and assert normalized absolute paths, full head
OIDs, and `refs/heads/` stripping. Cover multiple valid records plus each unsafe
response: relative/empty path, missing or duplicate field, abbreviated OID,
invalid branch, detached expected path, bare record, unknown field, duplicate
path, duplicate branch, and an unterminated record. The parser returns all valid
records plus a global malformed flag only if the entire response is safe to
inspect; the adapter maps any malformed flag to a response error before
mutation.

- [ ] **Step 2: Implement the focused porcelain parser**

Expose:

```ts
export type PlanningWorktreeRegistration = Readonly<{
  path: string;
  headOid: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}>;

export function parsePlanningWorktreePorcelain(output: string): Readonly<{
  entries: readonly PlanningWorktreeRegistration[];
  malformed: boolean;
}>;
```

Recognize the documented linked-worktree fields `worktree`, `HEAD`, `branch`,
`detached`, `locked`, and `prunable`; tolerate one optional value for locked and
prunable. Treat locked/prunable expected resources as unsafe later. Reject
unknown or duplicate fields and duplicate identities globally.

- [ ] **Step 3: Write fresh-prepare command and collision tests**

With a recording runner, start from no registration, no branch, and no path.
Assert `prepare` runs inspection, then exactly:

```ts
[
  "worktree",
  "add",
  "-b",
  identity.branch,
  "--",
  absoluteWorktreePath,
  base.baseOid,
];
```

and then reinspects. Assert returned ownership includes the input Run, phase,
identity, remote/base branch/OID, identical initial head OID, and
`cleanup: { state: "ready" }`.

Add separate refusal tests for branch-only collision, existing unregistered
path, expected path registered to another branch, expected branch registered at
another path, detached expected path, locked/prunable registration, malformed
porcelain, and a branch or worktree head different from the pinned base. Assert
none invokes `worktree add`.

- [ ] **Step 4: Write exact mutation-free resume tests**

Create matching saved ownership and assert repeated `resume` returns the same
ready snapshot. Record calls and assert there is no `fetch`, `worktree add`,
`worktree remove`, `update-ref`, `reset`, or filesystem write.

Table-test one mismatch at a time: requested Run, phase, expected identity,
saved remote, base branch, base OID, live registration mapping, live branch
head, live worktree head, or missing saved base commit. Also test branch-only,
missing, unregistered, and detached resources. Every case fails closed with a
specific conflict/response reason.

- [ ] **Step 5: Run workspace tests to prove RED**

Run:

```sh
node --test \
  src/git/planning-worktree-porcelain.test.ts \
  src/git/planning-workspace-git.test.ts
```

Expected: parser tests may pass after Step 2, while adapter tests FAIL because
`PlanningWorkspaceGit` does not exist.

- [ ] **Step 6: Implement safe inspection primitives**

Construct the adapter as:

```ts
export class PlanningWorkspaceGit implements PlanningWorkspaceLifecycle {
  constructor(input: {
    runner: CommandRunner;
    repoRoot: string;
    worktreeRoot: string;
  });
  // interface methods from Task 1
}
```

Normalize `repoRoot` and configured `worktreeRoot` once. Resolve each identity
path against `repoRoot`, then require it to be equal to or below `worktreeRoot`
via `relative(worktreeRoot, absolutePath)`. Validate branch and saved scalar
forms before commands.

Use these evidence sources:

- `git worktree list --porcelain -z` from `repoRoot` for path/branch/head
  registration;
- `git show-ref --verify --quiet refs/heads/<branch>` for local branch
  existence, where exit `1` means absent and other nonzero exits are command
  failures;
- `git rev-parse --verify refs/heads/<branch>^{commit}` for full branch head;
- `git rev-parse --verify <saved-base-oid>^{commit}` to prove saved base exists;
- `git -C <absolute-path> rev-parse --verify HEAD^{commit}` for checkout head;
- `git -C <absolute-path> status --porcelain=v1 -z --untracked-files=all --ignored=matching`
  for current cleanliness.

Use `lstat` only to distinguish absent paths from existing unregistered content;
do not enumerate or modify unregistered directories.

- [ ] **Step 7: Implement fresh prepare and exact resume**

Fresh `prepare` requires a fully validated `PlanningRemoteBaseSnapshot` and
refuses any pre-existing branch, path, or registration. After `worktree add`,
rerun all inspection and require expected branch/path mapping, branch head,
worktree head, and pinned base OID equality before returning evidence.

`resume` first compares requested values to every saved ownership field and base
evidence. It then performs read-only inspection and returns only if the live
path, branch, branch head, worktree head, and saved base commit all match.
Return the status-derived `clean` boolean for later coordination; do not treat a
dirty matching workspace as an identity mismatch during resume.

- [ ] **Step 8: Add real-Git create-at-pinned-base and no-op resume tests**

Use a repository plus local bare remote. Fetch snapshot A, advance the remote to
B without refetching, and call `prepare` with A. Assert branch and worktree HEAD
are A, proving creation does not dereference the moving remote. Then commit in
the phase worktree, update saved `headOid` to that commit, and call resume
twice; assert both return the saved head and leave repository refs and status
unchanged.

Create real branch/path/worktree collisions and assert fresh preparation never
adopts them. Add one real detached checkout case and one saved-head mismatch.

- [ ] **Step 9: Format and validate creation/resume behavior**

Run:

```sh
npx --no-install prettier --write \
  src/git/planning-worktree-porcelain.ts \
  src/git/planning-worktree-porcelain.test.ts \
  src/git/planning-workspace-git.ts \
  src/git/planning-workspace-git.test.ts
node --test \
  src/git/planning-workspaces.test.ts \
  src/git/planning-remote-base.test.ts \
  src/git/planning-worktree-porcelain.test.ts \
  src/git/planning-workspace-git.test.ts
npm run check:types
npm run check:architecture
```

Expected: contract, parser, recording-runner, and real-Git creation/resume tests
PASS.

- [ ] **Step 10: Commit creation and resume**

```sh
git add \
  src/git/planning-worktree-porcelain.ts \
  src/git/planning-worktree-porcelain.test.ts \
  src/git/planning-workspace-git.ts \
  src/git/planning-workspace-git.test.ts
git commit -m "feat(git): prepare and resume planning workspaces"
```

---

### Task 7: Add owned and idempotent workspace cleanup

**Files:**

- Modify: `src/git/planning-workspace-git.ts`
- Modify: `src/git/planning-workspace-git.test.ts`

**Interfaces:**

- Consumes: ready ownership for `removeWorktree` and `worktree-removed`
  ownership with `pushedHeadOid` for `removeBranch`.
- Preserves: prepare, resume, and inspect behavior from Task 6.
- Produces: idempotent `branch-only`/`missing` cleanup snapshots without
  mutating durable state; later workflow coordination persists the cleanup
  discriminator between calls.

- [ ] **Step 1: Write clean, dirty, and retry worktree-removal tests**

For matching ready ownership, assert `removeWorktree` checks registration,
branch/worktree heads, and status before invoking:

```ts
["worktree", "remove", "--", absoluteWorktreePath];
```

Assert no `--force`. Test tracked modifications, staged changes, untracked
files, and ignored files independently; every nonempty `-z` status blocks
removal and leaves both resources intact.

Assert the first successful call returns `branch-only`; a retry with the exact
branch/head and absent checkout also returns `branch-only`; and a retry after
both resources are absent returns `missing`. Refuse an unexpected existing path,
changed head, changed branch mapping, branch checked out elsewhere, detached or
malformed registration, and wrong Run/phase/identity.

- [ ] **Step 2: Write remote proof and compare-and-swap branch tests**

For worktree-removed ownership, assert `removeBranch` first proves the branch is
not checked out, then invokes:

```ts
[
  "ls-remote",
  "--exit-code",
  "--heads",
  "--",
  workspace.remote,
  `refs/heads/${workspace.identity.branch}`,
];
```

Parse exactly one `<full-oid> TAB <exact-ref>` line and require it to equal
`cleanup.pushedHeadOid`. Only then invoke:

```ts
[
  "update-ref",
  "-d",
  `refs/heads/${workspace.identity.branch}`,
  workspace.headOid,
];
```

Assert changed/missing/multiple/malformed remote output, a checked-out branch,
changed local head, and compare-and-swap failure all block or report the
specific typed error. Assert no `git branch -D` or name sweep is used.

- [ ] **Step 3: Write branch-removal retry tests**

After a successful deletion, call `removeBranch` again with the same ownership.
Require remote proof to remain exact, permit the local branch to be absent, and
return the same `missing` snapshot without a second `update-ref`. Assert both
first and repeated results are identical. If the remote head changed between
attempts, fail closed even though the local branch is already absent.

- [ ] **Step 4: Run focused cleanup tests to prove RED**

Run:

```sh
node --test \
  --test-name-pattern="remove|cleanup|dirty|remote" \
  src/git/planning-workspace-git.test.ts
```

Expected: FAIL because cleanup methods do not yet implement the owned and
idempotent behavior.

- [ ] **Step 5: Implement `removeWorktree` ownership checks and idempotency**

Before mutation, validate requested Run/phase against the saved record, prove
configured-root containment, inspect all registrations, and compare exact saved
head. A registered clean matching checkout is removed without force and then
reinspected. An absent checkout with exact branch/head returns `branch-only`; an
absent checkout and absent branch returns `missing`. Any existing unregistered
path or uncertain Git response is a conflict.

Do not alter the caller's ownership object. The coordinator in a later issue
creates the `worktree-removed` state only after this method succeeds.

- [ ] **Step 6: Implement `removeBranch` remote proof and CAS deletion**

Accept only the compile-time `worktree-removed` cleanup input. Revalidate the
saved tuple, path absence, branch registration absence, and local branch head.
Query the configured remote with `ls-remote` and strictly parse exact ref/OID
evidence. Delete only with `git update-ref -d <ref> <expected-old-oid>`.
Reinspect and require the local branch to be absent before returning `missing`.

For an earlier identical successful attempt, still validate the saved tuple and
remote head, observe both local resources absent, skip `update-ref`, and return
`missing`.

- [ ] **Step 7: Add real-Git owned-cleanup tests**

With a local bare remote, create and push a phase branch, remove the worktree,
and delete the local branch through the adapter. Repeat both operations and
assert idempotent snapshots. Recreate fixtures to prove each of these leaves the
workspace/branch untouched:

- tracked, untracked, or ignored content;
- another branch at the saved path;
- the saved branch at another worktree;
- local head advancement after state was saved;
- remote branch advancement after `pushedHeadOid` was saved.

Capture every command and assert no force worktree removal, recursive delete,
clean, reset, merge, rebase, or branch-name sweep occurs.

- [ ] **Step 8: Format and validate the complete Git adapter**

Run:

```sh
npx --no-install prettier --write \
  src/git/planning-workspace-git.ts \
  src/git/planning-workspace-git.test.ts
node --test \
  src/git/planning-workspaces.test.ts \
  src/git/planning-remote-base.test.ts \
  src/git/planning-worktree-porcelain.test.ts \
  src/git/planning-workspace-git.test.ts
npm run check:types
npm run check:architecture
```

Expected: all Git contract, remote-base, parser, creation, resume, and cleanup
tests PASS.

- [ ] **Step 9: Commit owned cleanup**

```sh
git add \
  src/git/planning-workspace-git.ts \
  src/git/planning-workspace-git.test.ts
git commit -m "feat(git): clean up owned planning workspaces"
```

---

### Task 8: Run full validation and audit scope

**Files:**

- Verify only; no production or test file is created in this task.

**Interfaces:**

- Verifies: all issue #187 acceptance criteria across the state, lock,
  remote-base, and workspace seams.
- Verifies: no current run-once, provider, configuration, or dependency wiring
  changed.

- [ ] **Step 1: Run all issue-focused tests together**

```sh
node --test \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-issue-lock.test.ts \
  src/workflow/planning-state-store.test.ts \
  src/git/planning-workspaces.test.ts \
  src/git/planning-remote-base.test.ts \
  src/git/planning-worktree-porcelain.test.ts \
  src/git/planning-workspace-git.test.ts
```

Expected: all focused tests PASS with no warning or skipped destructive-safety
case.

- [ ] **Step 2: Run the repository validation commands from the approved spec**

Run in this exact order:

```sh
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
git diff --check
```

Expected: every command exits with status `0`.

- [ ] **Step 3: Verify compatibility and dependency scope directly**

```sh
git diff --exit-code main...HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json \
  src/config src/cli src/host
git diff --name-only main...HEAD
```

Expected: the first command has no diff. The file list contains only the
approved spec and plan plus the workflow/Git modules and tests named in this
plan. No Nix build is required because npm dependencies do not change; if any
package or lockfile unexpectedly changed, stop, remove the change or run the Nix
build required by `AGENTS.md` before completion.

- [ ] **Step 4: Review error confidentiality and forbidden Git operations**

```sh
rg -n -- "--force|git clean|git reset|rm\(|rmSync|recursive" \
  src/git/planning-*.ts src/workflow/planning-*.ts
rg -n "stdout|stderr|ownershipId|command arguments" \
  src/git/planning-*.ts src/workflow/planning-*.ts
```

Inspect every match. Expected: force/recursive mutation does not occur;
`ownershipId` appears only in lock records and equality checks; raw command
output exists only in non-enumerable diagnostics or private parsing paths, not
in default error messages or enumerable error fields.

- [ ] **Step 5: Record implementation completion evidence**

The implementation worker reports:

- the seven implementation commit hashes;
- focused and full validation command results;
- the changed-file list and confirmation that dependencies/config/runtime wiring
  stayed unchanged;
- confirmation that tests were observed failing before implementation;
- any residual platform risk around directory syncing or Git SHA-256
  repositories.
