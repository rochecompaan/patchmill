# Reconcile Merged Revised Planning Heads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Run-once workflow safely complete a planning pull request whose
head changed from recorded head `A` to reviewed head `B`, then merged and lost
its source branch before Patchmill could adopt `B`.

**Architecture:** Keep stable pull-request identity validation as the first
trust boundary, then dispatch by the validated host status. Open pull requests
continue through strict source-head adoption and publication cleanup; merged
pull requests instead prove their saved artifacts from the forge merge commit
and a freshly fetched target-base snapshot before using a narrowly authorized
terminal cleanup mode that never consults or changes the deleted source branch.
The existing current-base recovery and structured blocker become the fail-closed
path for typed terminal evidence insufficiency.

**Tech Stack:** TypeScript ESM, Node.js and `node:test`, real temporary Git
repositories and bare remotes, the existing `planning-pr-v1` state/store,
planning pull-request validation, publication Git, workspace lifecycle, remote
base, and diagnostic contracts, Prettier, ESLint, TypeScript, and
dependency-cruiser; no new dependency.

**Spec:**
`docs/specs/2026-09-26-issue-271-run-once-blocks-when-a-revised-planning-pr-is-merged-before-head-adoption-design.md`

## Global Constraints

- Validate the saved planning pull request with
  `validatePlanningPullRequestIdentity()` before branching on status or doing
  Git, cleanup, or durable-state effects.
- Preserve all current checks for target and head repository identity,
  publication-repository policy, saved base branch, saved head branch,
  Issue/phase ownership marker, canonical URL, and saved pull-request reference.
- The only deleted-branch identity exception remains the existing exact
  `refs/pull/<number>/head` form for merged or closed pull requests. It must use
  the saved pull-request number and must remain invalid for an open pull
  request.
- A revised open planning pull request keeps the existing strict adoption proof:
  source/host/fetched-head agreement, fast-forward ancestry, artifact-only
  changes, regular saved artifacts, coherent local recovery, and one atomic
  durable adoption.
- A closed-unmerged planning pull request remains blocked and merge evidence
  cannot authorize it.
- A merged planning pull request must not call source-branch head adoption or
  inspect the source branch as a prerequisite.
- Fetch the saved remote and target base into the normal pinned base snapshot.
  Require the forge merge commit to be an ancestor of the fetched base and
  require every saved artifact path to be a regular file at both commits.
- Only typed `ancestry/not-ancestor` or `tree/non-regular-file` insufficiency
  may enter current-base recovery. Command failures, malformed Git output,
  invalid object IDs or inputs, host failures, and untyped errors remain hard
  failures.
- Current-base recovery requires exactly one candidate for every saved artifact
  kind, requires each candidate to equal its saved path, and verifies all saved
  paths as regular files at the fetched base. It never adopts a discovered path.
- Normal proof or current-base recovery must succeed before any local terminal
  cleanup or completion checkpoint.
- Terminal cleanup may omit only the source-remote equality precondition. It
  must preserve Run ID, phase, branch, worktree, local-head, cleanliness,
  ignored-content, ordered cleanup-checkpoint, and compare-safe local branch
  removal checks, and it must never delete or change a remote ref.
- Failed proof leaves local resources and durable completion unchanged. Ignored
  content continues to produce the existing `cleanup-pending` outcome, and a
  retry repeats identity and terminal evidence before resuming cleanup.
- Successful completion keeps `publication.headOid` and `workspace.headOid` at
  original head `A`, stores the forge merge commit in `completion.mergeOid`,
  stores the fetched base in `completion.mergedBaseOid`, and anchors every
  artifact as `source: "remote-base"` at that fetched-base OID.
- Use the existing revision-checked `replacePlanningPhase()` path and existing
  `planning-pr-v1` state/completion shape; no schema migration or workflow
  version change is allowed.
- Expected terminal evidence insufficiency returns stable reason
  `planning-merge-recovery-blocked` with `after-action` guidance for a normal
  reviewed target-base repair. Guidance must not ask for source-branch
  recreation, force-restoration of `A`, state editing, or arbitrary candidate
  selection.
- Do not change implementation pull-request reconciliation.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If implementation unexpectedly retains an npm dependency metadata change, run
  the Nix build required by `AGENTS.md`.

---

## Testing Value Gate

The planned tests pass Patchmill's Testing Value Gate:

- **Behavior, not configuration:** they execute status selection, merge/base
  proof, cleanup checkpoints, durable completion, diagnostics, and real Git
  branch deletion rather than asserting static source text.
- **Meaningful regression:** the real-Git test fails on the current
  `planning-head-adoption-blocked` / `remote-missing` behavior, while unit tests
  fail if proof again moves after cleanup or merged reconciliation consults the
  source branch.
- **Maintainer value:** reruns protect the human-review boundary, destructive
  cleanup ordering, exact saved artifact paths, and the artifact provenance
  consumed by implementation preparation.
- **Reusable/risky behavior:** pull-request identity, typed Git failure
  classification, state checkpoints, and post-merge cleanup are reusable,
  safety-sensitive production behavior.

No tests are planned for dependency versions, lockfile text, workflow YAML, or
this plan document. Direct `git diff --check`, lint, type, build, architecture,
and existing-suite verification cover those concerns.

## File and Module Map

### Terminal merge evidence

- Modify `src/cli/commands/run-once/planning-merge-recovery.ts` to compose
  normal merge/base proof with the existing exact current-base recovery and
  expose the typed trigger that caused fallback.
- Modify `src/cli/commands/run-once/planning-merge-recovery.test.ts` to cover
  normal proof order, both allowed typed fallback triggers, exact-path recovery,
  and hard-error propagation.

### Cleanup authorization

- Modify `src/cli/commands/run-once/planning-phase-cleanup.ts` to require an
  explicit `publication` or `merged-terminal` authorization. Only publication
  cleanup observes the remote source head.
- Modify `src/cli/commands/run-once/planning-phase-cleanup.test.ts` and
  `src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts` to protect
  both modes, every cleanup discriminator, ignored-content preservation, and
  retry checkpoints.
- Modify `src/cli/commands/run-once/planning-phase-publisher.ts` to select
  publication cleanup explicitly without changing publication behavior.

### Status-aware reconciliation

- Modify `src/cli/commands/run-once/planning-phase-reconciler.ts` to validate
  identity, classify the host status, retain strict adoption for open pull
  requests, stop immediately for closed-unmerged pull requests, and perform
  terminal proof before merged cleanup and completion.
- Modify `src/cli/commands/run-once/planning-phase-reconciler.test.ts` to cover
  event order, no source-head effects for merged pull requests, stable identity
  failures, evidence blockers, cleanup retries, and unchanged durable `A`
  provenance.
- Modify `src/cli/commands/run-once/planning-head-adoption.real.test.ts` to add
  the required real-Git `A -> B -> merge -> source deletion -> reconcile`
  regression without an intervening open reconciliation.
- Re-run `src/workflow/planning-pull-request-validation.test.ts`; the existing
  exact server pull-ref tests are the identity contract and require no product
  change.

### Actionable blocker

- Modify `src/cli/commands/run-once/planning-phase-runner-planning.ts` and
  `src/cli/commands/run-once/planning-phase-runner.test.ts` to carry canonical
  pull-request, recorded/host head, forge merge, fetched base, normal-proof
  trigger, and current-base recovery evidence into the existing stable reason.
- Modify `src/cli/commands/run-once/result-diagnostic-types.ts`,
  `src/cli/commands/run-once/result-diagnostic-planning.ts`, and
  `src/cli/commands/run-once/result-diagnostics.test.ts` to generalize the
  blocker from only rewritten ancestry to all expected terminal merged-evidence
  insufficiency and prescribe feasible target-base repair.

`planning-phase-reconciler.ts` is already 334 lines, so normal proof and
fallback classification stay in `planning-merge-recovery.ts` rather than adding
another multi-stage responsibility to the reconciler. The cleanup module remains
the single owner of local removal checkpoints; its discriminated authorization
makes the one skipped remote precondition explicit and prevents a boolean from
silently weakening publication cleanup.

## Shared Interfaces

Use these names and shapes consistently across tasks.

```ts
// planning-merge-recovery.ts
export type PlanningMergeProofInsufficiency =
  | Readonly<{
      source: "merge-ancestry";
      failure: "not-ancestor";
    }>
  | Readonly<{
      source: "merge-commit-tree" | "fetched-base-tree";
      failure: "non-regular-file";
    }>;

export type PlanningMergedArtifactProof =
  | Readonly<{
      kind: "verified";
      evidenceSource: "merge-and-base" | "current-base";
    }>
  | Readonly<{
      kind: "blocked";
      trigger: PlanningMergeProofInsufficiency;
      recovery: Extract<PlanningMergeRecoveryResult, { kind: "blocked" }>;
    }>;

export async function verifyPlanningMergedArtifacts(input: {
  mergeOid: string;
  artifacts: readonly PlanningArtifactEvidence[];
  base: PlanningRemoteBaseSnapshot;
  git: Pick<
    PlanningPublicationOperations,
    "assertAncestor" | "assertRegularFiles"
  >;
}): Promise<PlanningMergedArtifactProof>;
```

`verifyPlanningMergedArtifacts()` runs `assertAncestor(mergeOid, base.baseOid)`,
then one regular-file assertion for all saved paths at `mergeOid`, then one at
`base.baseOid`. It converts only the exact typed failures shown above into a
call to the existing `verifyPlanningMergeRecoveryEvidence()`. A successful
fallback returns `evidenceSource: "current-base"`; blocked fallback retains both
the normal-proof trigger and current-base candidate/tree failure.

```ts
// planning-phase-cleanup.ts
export type PlanningPhaseCleanupAuthorization =
  | Readonly<{
      kind: "publication";
      remoteHead: (
        phase: PlanningPhaseCleanupCandidate,
      ) => Promise<PlanningRemoteHead>;
    }>
  | Readonly<{ kind: "merged-terminal" }>;

export async function finishPlanningPhaseCleanup(input: {
  phase: PullRequestOpenPlanningPhase;
  workspaces: PlanningWorkspaceLifecycle;
  authorization: PlanningPhaseCleanupAuthorization;
  checkpoint: (phase: PullRequestOpenPlanningPhase) => Promise<void>;
}): Promise<PlanningPhaseCleanupOutcome>;
```

For `ready` and `cleanup-pending`, `publication` retains the current exact
remote head observation and `remote-head-changed` outcome. `merged-terminal`
proceeds directly to `removeWorktree()`. Both modes retain the same worktree
result validation, ignored-content checkpoint, `worktree-removed` checkpoint,
compare-safe `removeBranch()`, and `removed` checkpoint.

```ts
// planning-phase-reconciler.ts
export type PlanningMergeRecoveryBlockedOutcome = Readonly<{
  kind: "merge-recovery-blocked";
  pullRequest: Extract<PullRequestSummary, { status: "merged" }>;
  recordedHeadOid: string;
  baseBranch: string;
  baseOid: string;
  evidence: Extract<PlanningMergedArtifactProof, { kind: "blocked" }>;
}>;
```

The phase runner derives `#${pullRequest.number}` and `pullRequest.headSha` from
this outcome. It does not trust or infer artifact paths from host data.

```ts
// result-diagnostic-types.ts
"planning-merge-recovery-blocked": Base & {
  phase: "spec" | "plan";
  pullRequestUrl: string;
  pullRequestReference: string;
  recordedHeadOid: string;
  hostHeadOid: string;
  baseBranch: string;
  forgeMergeOid: string;
  fetchedBaseOid: string;
  evidenceSource:
    | "merge-ancestry"
    | "merge-commit-tree"
    | "fetched-base-tree";
  evidenceFailure: "not-ancestor" | "non-regular-file";
  recoveryFailure:
    | "missing"
    | "ambiguous"
    | "path-mismatch"
    | "non-regular-file";
  artifactKinds: readonly ("spec" | "plan")[];
  expectedPaths: readonly string[];
  observedCandidates: readonly string[];
};
```

## Task 1: Classify normal merged proof and current-base recovery

**Files:**

- Modify: `src/cli/commands/run-once/planning-merge-recovery.ts`
- Modify: `src/cli/commands/run-once/planning-merge-recovery.test.ts`

**Interfaces:**

- Consumes: `PlanningPublicationGitError`, saved `PlanningArtifactEvidence[]`,
  `PlanningRemoteBaseSnapshot`, and the existing
  `verifyPlanningMergeRecoveryEvidence()` exact candidate/path check.
- Produces: `PlanningMergeProofInsufficiency`, `PlanningMergedArtifactProof`,
  and
  `verifyPlanningMergedArtifacts(input): Promise<PlanningMergedArtifactProof>`
  exactly as defined in Shared Interfaces.

- [ ] **Step 1: Add failing normal-proof ordering coverage**

Extend `planning-merge-recovery.test.ts` with a call log for `assertAncestor()`
and `assertRegularFiles()`. Pass spec and plan artifacts and assert this exact
sequence and result:

```ts
assert.deepEqual(calls, [
  ["ancestor", mergeOid, rewrittenBaseOid],
  ["regular", mergeOid, specArtifact.path, planArtifact.path],
  ["regular", rewrittenBaseOid, specArtifact.path, planArtifact.path],
]);
assert.deepEqual(result, {
  kind: "verified",
  evidenceSource: "merge-and-base",
});
```

- [ ] **Step 2: Run the focused test to verify the new API is absent**

Run:

```sh
node --test src/cli/commands/run-once/planning-merge-recovery.test.ts
```

Expected: FAIL because `verifyPlanningMergedArtifacts` is not exported.

- [ ] **Step 3: Add failing typed-fallback tests**

Add table-driven cases for:

```ts
new PlanningPublicationGitError("ancestry", "not-ancestor");
new PlanningPublicationGitError("tree", "non-regular-file");
```

For the tree case, throw once at `mergeOid` and separately once at
`rewrittenBaseOid`. Assert successful exact current-base evidence returns:

```ts
{ kind: "verified", evidenceSource: "current-base" }
```

For a missing, ambiguous, mismatched, or non-regular current-base result, assert
`kind: "blocked"`, the precise trigger source/failure, and the existing recovery
arrays. In particular, a merge-object tree failure must use
`source: "merge-commit-tree"`, while a fetched-base tree failure must use
`source: "fetched-base-tree"`.

- [ ] **Step 4: Add hard-failure preservation tests**

Exercise these errors at ancestry and both tree checks:

```ts
new PlanningPublicationGitError("ancestry", "command-failed");
new PlanningPublicationGitError("ancestry", "invalid-input");
new PlanningPublicationGitError("tree", "command-failed");
new PlanningPublicationGitError("tree", "malformed-response");
new Error("transport");
```

Assert object identity on rejection and assert current-base recovery was not
called. This prevents malformed or infrastructure evidence from becoming a
human-repair blocker.

- [ ] **Step 5: Implement the minimal proof coordinator**

In `planning-merge-recovery.ts`, add a narrow classifier equivalent to:

```ts
function typedInsufficiency(
  error: unknown,
  source: PlanningMergeProofInsufficiency["source"],
): PlanningMergeProofInsufficiency | undefined {
  if (!(error instanceof PlanningPublicationGitError)) return undefined;
  if (
    source === "merge-ancestry" &&
    error.operation === "ancestry" &&
    error.reason === "not-ancestor"
  )
    return { source, failure: "not-ancestor" };
  if (
    source !== "merge-ancestry" &&
    error.operation === "tree" &&
    error.reason === "non-regular-file"
  )
    return { source, failure: "non-regular-file" };
  return undefined;
}
```

Run normal checks in order. On an allowed trigger, call
`verifyPlanningMergeRecoveryEvidence({ artifacts, base, git })`; return
`current-base` on verification or `{ kind: "blocked", trigger, recovery }` on
insufficiency. Re-throw every unclassified error unchanged.

- [ ] **Step 6: Run and format the focused proof files**

Run:

```sh
npx prettier --write \
  src/cli/commands/run-once/planning-merge-recovery.ts \
  src/cli/commands/run-once/planning-merge-recovery.test.ts
node --test src/cli/commands/run-once/planning-merge-recovery.test.ts
```

Expected: PASS for normal proof, all three typed trigger sources, exact
recovery, blocked recovery, and hard failures.

- [ ] **Step 7: Commit the focused proof change**

```sh
git add \
  src/cli/commands/run-once/planning-merge-recovery.ts \
  src/cli/commands/run-once/planning-merge-recovery.test.ts
git commit -m "fix(run-once): classify merged planning evidence"
```

## Task 2: Add an explicit terminal cleanup authorization

**Files:**

- Modify: `src/cli/commands/run-once/planning-phase-cleanup.ts`
- Modify: `src/cli/commands/run-once/planning-phase-cleanup.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.ts`

**Interfaces:**

- Consumes: the existing `PlanningWorkspaceLifecycle.removeWorktree()` and
  `removeBranch()` ownership checks and durable cleanup checkpoints.
- Produces: `PlanningPhaseCleanupAuthorization` and the revised
  `finishPlanningPhaseCleanup()` input from Shared Interfaces. Existing
  publisher and reconciler behavior remains publication-authorized until Task 3
  selects terminal authorization after proof.

- [ ] **Step 1: Write failing terminal cleanup tests**

In `planning-phase-cleanup.test.ts`, invoke cleanup with:

```ts
authorization: {
  kind: "merged-terminal";
}
```

Cover `ready`, `cleanup-pending`, `worktree-removed`, and `removed` phase
workspaces. Make any remote observer throw
`new Error("source branch must not be inspected")` and assert it is never
invoked. Assert `ready` and `cleanup-pending` still call `removeWorktree`,
checkpoint `worktree-removed`, call `removeBranch`, and checkpoint `removed`;
the later discriminators resume only their missing steps.

- [ ] **Step 2: Add failing safety and ignored-content tests**

Assert terminal authorization:

- propagates dirty-worktree, changed-local-head, ownership, or registration
  conflicts from `removeWorktree()` without a checkpoint;
- returns and checkpoints the existing `cleanup-pending` result when ignored
  content remains;
- leaves `removeBranch()` compare-safe and does not add any remote-delete call;
- resumes after either checkpoint failure with the existing idempotent command
  sequence.

Keep the current publication tests for missing/moved source heads and malformed
remote observations. They must continue to stop before local mutation.

- [ ] **Step 3: Run cleanup tests to verify the authorization is absent**

Run:

```sh
node --test \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts
```

Expected: FAIL because cleanup still requires the unconditional `remoteHead`
callback and does not accept `authorization`.

- [ ] **Step 4: Implement the discriminated cleanup input**

Move the callback under `authorization.kind === "publication"`. For `ready` or
`cleanup-pending`, perform the current observation validation and exact
`publication.headOid` comparison only in that branch. For `merged-terminal`,
enter the unchanged `removeWorktree()` switch directly. Do not alter later
checkpoint shapes or `pushedHeadOid`; both remain pinned to recorded publication
head `A`.

- [ ] **Step 5: Update existing callers explicitly**

In `planning-phase-publisher.ts` and the pre-Task-3 reconciler call, replace the
old top-level callback with:

```ts
authorization: {
  kind: "publication",
  remoteHead: (published) =>
    input.git.inspectRemoteHead({
      remote: published.base.remote,
      branch: published.workspace.identity.branch,
    }),
},
```

Update direct unit-test callers the same way. This step is a type-enforced
no-behavior-change migration for publication cleanup.

- [ ] **Step 6: Run focused cleanup and publisher tests**

Run:

```sh
npx prettier --write \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-reconciler.ts
node --test \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts
```

Expected: PASS with strict publication behavior unchanged and terminal cleanup
skipping only remote source-head observation.

- [ ] **Step 7: Commit the cleanup authorization**

```sh
git add \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-reconciler.ts
git commit -m "fix(run-once): authorize terminal planning cleanup"
```

## Task 3: Reconcile merged status before head adoption

**Files:**

- Modify: `src/cli/commands/run-once/planning-phase-reconciler.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.test.ts`
- Modify: `src/cli/commands/run-once/planning-head-adoption.real.test.ts`
- Test: `src/workflow/planning-pull-request-validation.test.ts`

**Interfaces:**

- Consumes: stable `ValidatedPlanningPullRequest`, strict
  `adoptPlanningPullRequestHead()` for open status only,
  `verifyPlanningMergedArtifacts()`, terminal cleanup authorization, and
  `replacePlanningPhase()`.
- Produces: status-aware reconciliation and the revised
  `PlanningMergeRecoveryBlockedOutcome` from Shared Interfaces. The merged path
  never adopts `B`; durable publication/workspace provenance remains `A`.

- [ ] **Step 1: Write the failing merged revised-head unit regression**

In `planning-phase-reconciler.test.ts`, make the saved pull-request-open phase
record head `A`; return a merged summary with head `B`,
`headBranch: "refs/pull/188/head"`, and a forge merge commit. Make both
`adoptPlanningHead()` and `inspectRemoteHead()` fail if called. Assert the
successful event order is:

```ts
[
  "get",
  "fetch:saved-origin:saved-main",
  `ancestor:${mergeOid}:${mergedBaseOid}`,
  `regular:${mergeOid}:docs/specs/example.md`,
  `regular:${mergedBaseOid}:docs/specs/example.md`,
  "remove-worktree",
  "replace:pull-request-open:worktree-removed",
  "remove-branch",
  "replace:pull-request-open:removed",
  "replace:complete:complete",
];
```

Assert completion anchors artifacts to `mergedBaseOid` while
`publication.headOid`, `workspace.headOid`, and cleanup `pushedHeadOid` remain
`A`.

- [ ] **Step 2: Add failing status and identity sequencing tests**

Add focused assertions that:

- a revised open summary still calls `adoptPlanningHead()` before publication
  cleanup and returns `planning-head-adoption-blocked` evidence when its source
  branch is missing;
- a closed-unmerged summary returns `closed-unmerged` after validation without
  adoption, merge proof, or cleanup;
- target/head repository, base/head branch, ownership marker, URL, and expected
  reference mismatches throw `PlanningPullRequestValidationError` before fetch,
  adoption, or cleanup;
- only exact `refs/pull/188/head` works for the merged summary; an open summary
  or `refs/pull/189/head` fails identity validation.

The focused validator test already covers the last rule; retain it and add the
reconciler event assertion so future status reordering cannot bypass validation.

- [ ] **Step 3: Add failing proof-before-cleanup and retry tests**

For `not-ancestor` and normal merge/base `non-regular-file` triggers, assert
current-base recovery runs before cleanup. When recovery is blocked, assert no
`removeWorktree`, `removeBranch`, cleanup checkpoint, or completion replacement
occurs. When it verifies, assert cleanup begins afterward.

Add retry cases for:

- terminal cleanup returning `cleanup-pending`, followed by a retry that repeats
  host identity, base fetch, and terminal proof before another cleanup attempt;
- interruption at each cleanup checkpoint;
- state already at `worktree-removed` or `removed`;
- a failed completion replacement after cleanup, followed by a retry from
  `removed` that repeats proof and writes completion without restoring the
  source branch.

- [ ] **Step 4: Add failing branch-pushed merged discovery coverage**

Use a `branch-pushed` phase whose unique discovered/read-back pull request is
already merged at changed head `B`. Assert reconciliation runs merged proof
while durable state remains `branch-pushed`; blocked proof must leave that state
unchanged. After successful proof, it checkpoints only the stable pull-request
reference/URL as `pull-request-open` while preserving all recorded `A` head
evidence, then performs terminal cleanup. It must not invoke head adoption. This
closes the same ordering race if merge occurs before the pull-request identity
checkpoint rather than only after it.

- [ ] **Step 5: Run the reconciler test to observe the current blocker**

Run:

```sh
node --test src/cli/commands/run-once/planning-phase-reconciler.test.ts
```

Expected: FAIL because the current reconciler attempts head adoption and/or
publication cleanup before selecting merged proof.

- [ ] **Step 6: Refactor reconciliation into status-specific paths**

After stable validation, use an exhaustive status switch with these effects:

```ts
switch (validated.summary.status) {
  case "open":
    return reconcileOpenPlanningPullRequest({
      input,
      state,
      phase,
      validated,
      now,
    });
  case "closed-unmerged":
    return { state, outcome: { kind: "closed-unmerged", pullRequest } };
  case "merged":
    return reconcileMergedPlanningPullRequest({
      input,
      state,
      phase,
      validated,
      now,
    });
}
```

For merged status:

1. fetch the saved target base;
2. call `verifyPlanningMergedArtifacts()` while durable phase state remains
   unchanged;
3. return `merge-recovery-blocked` with `recordedHeadOid` on blocked proof;
4. after successful proof, convert a discovered `branch-pushed` phase to
   `pull-request-open` by persisting only the validated reference and canonical
   URL, leaving publication, workspace, artifact, and cleanup head evidence
   unchanged;
5. call `finishPlanningPhaseCleanup()` with
   `{ authorization: { kind: "merged-terminal" } }`;
6. return existing `cleanup-pending` when ignored content remains; and
7. perform the unchanged completion replacement only after cleanup succeeds.

Step 4 uses the already-allowed `branch-pushed -> pull-request-open-ready`
transition; do not add a state-transition exception. If execution stops after
that checkpoint, the next Run attempt revalidates identity and repeats merged
proof before cleanup.

Keep open adoption and its remote-head blocker conversion byte-for-byte in the
open branch. Do not add a merged flag or deleted-branch behavior to
`planning-head-adoption.ts` or `planning-head-adoption-git.ts`.

- [ ] **Step 7: Add the real-Git merge-before-adoption regression**

In `planning-head-adoption.real.test.ts`, add a second test that:

1. publishes saved head `A`;
2. revises the source branch to `B` from the `human` clone;
3. records `B` at `refs/pull/188/head` in the bare remote with
   `git(remote, "update-ref", "refs/pull/188/head", revisedOid)` to model the
   immutable server pull ref;
4. merges `B` into `main` without first calling `reconcilePlanningPhase()`;
5. pushes `main` and deletes `refs/heads/planning/spec` from the remote;
6. reports a merged host summary with head SHA `B`, exact server pull ref, and
   forge merge commit; and
7. reconciles durable state still pinned to `A`.

Assert the source branch is actually absent with:

```ts
assert.equal(
  git(
    remote,
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads/planning/spec",
  ),
  "",
);
```

Pass facades whose `adoptPlanningHead()` and source `inspectRemoteHead()` fail
if called. Assert merged completion, local cleanup, `remote-base` artifact
provenance, merge/base OIDs, and unchanged recorded `A` publication/workspace
heads.

- [ ] **Step 8: Run focused status, validation, and real-Git tests**

Run:

```sh
npx prettier --write \
  src/cli/commands/run-once/planning-phase-reconciler.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-head-adoption.real.test.ts
node --test \
  src/cli/commands/run-once/planning-merge-recovery.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-head-adoption.real.test.ts \
  src/workflow/planning-pull-request-validation.test.ts
```

Expected: PASS, including the deleted source branch regression and unchanged
open/identity safety checks.

- [ ] **Step 9: Commit status-aware reconciliation**

```sh
git add \
  src/cli/commands/run-once/planning-phase-reconciler.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-head-adoption.real.test.ts
git commit -m "fix(run-once): reconcile merged revised planning heads"
```

## Task 4: Generalize the terminal evidence blocker

**Files:**

- Modify: `src/cli/commands/run-once/planning-phase-runner-planning.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-types.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-planning.ts`
- Modify: `src/cli/commands/run-once/result-diagnostics.test.ts`

**Interfaces:**

- Consumes: `PlanningMergeRecoveryBlockedOutcome` with its normal-proof trigger
  and current-base recovery failure.
- Produces: the exact `planning-merge-recovery-blocked` diagnostic context from
  Shared Interfaces, preserving stable reason and `after-action` retry policy.

- [ ] **Step 1: Write the failing phase-runner mapping test**

Update the merge-recovery fixture in `planning-phase-runner.test.ts` so its
merged pull-request stub includes `number: 1` and `headSha: oid("b")`, then add:

```ts
recordedHeadOid: oid("a"),
evidence: {
  kind: "blocked",
  trigger: { source: "merge-commit-tree", failure: "non-regular-file" },
  recovery: {
    kind: "blocked",
    failure: "missing",
    artifactKinds: ["spec"],
    expectedPaths: ["docs/specs/example.md"],
    observedCandidates: [],
  },
},
```

Assert diagnostic context includes canonical URL, `#1`, recorded head, host
head, base branch/OID, merge OID, trigger source/failure, recovery failure,
artifact kinds/paths, and `observedCandidates: ["(none)"]`.

- [ ] **Step 2: Write failing catalog tests for every expected blocker**

In `result-diagnostics.test.ts`, exercise:

- ancestry `not-ancestor` followed by missing current-base evidence;
- merge-commit `non-regular-file` followed by path mismatch;
- fetched-base `non-regular-file` followed by non-regular recovery evidence.

For each, assert summary and explanation describe terminal merged evidence
rather than only rewritten history, retry is `after-action`, and the action says
to restore exactly one regular artifact at each saved path through a normal
reviewed change on the reported target base before rerunning the Issue. Assert
safety text explicitly forbids source-branch recreation, planning-state edits,
forced stale-history restoration, and arbitrary candidate choice.

- [ ] **Step 3: Run runner and diagnostic tests to verify the old context
      fails**

Run:

```sh
node --test \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/result-diagnostics.test.ts
```

Expected: FAIL because the existing context lacks pull-request reference,
recorded/host heads, trigger source/failure, and distinct recovery failure.

- [ ] **Step 4: Implement the complete typed diagnostic context**

Revise `result-diagnostic-types.ts` to the Shared Interfaces shape. In
`planning-phase-runner-planning.ts`, map:

```ts
pullRequestReference: `#${result.outcome.pullRequest.number}`,
recordedHeadOid: result.outcome.recordedHeadOid,
hostHeadOid: result.outcome.pullRequest.headSha,
evidenceSource: result.outcome.evidence.trigger.source,
evidenceFailure: result.outcome.evidence.trigger.failure,
recoveryFailure: result.outcome.evidence.recovery.failure,
```

Map artifact and candidate arrays from `evidence.recovery`; retain explicit
`["(none)"]` for no observed candidate. Do not include untrusted pull-request
body text in diagnostics.

- [ ] **Step 5: Generalize diagnostic wording without changing the reason**

Keep key `planning-merge-recovery-blocked`, but use:

- summary: `Planning merge evidence needs reviewed base repair`;
- explanation: the immutable merge commit and freshly fetched target base could
  not prove every saved regular-file artifact, and exact current-base recovery
  was insufficient;
- action: restore exactly one regular artifact at each reported saved path
  through a normal reviewed change on the configured target base, then rerun;
- safety: do not recreate the deleted source branch, hand-edit state,
  force-restore stale history, or choose an ambiguous candidate; and
- retry: existing `after-action` policy.

- [ ] **Step 6: Run and format focused public-result tests**

Run:

```sh
npx prettier --write \
  src/cli/commands/run-once/planning-phase-runner-planning.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/result-diagnostic-types.ts \
  src/cli/commands/run-once/result-diagnostic-planning.ts \
  src/cli/commands/run-once/result-diagnostics.test.ts
node --test \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/result-diagnostics.test.ts
```

Expected: PASS with stable reason, complete context, feasible target-base
repair, and `after-action` retry semantics.

- [ ] **Step 7: Commit the blocker update**

```sh
git add \
  src/cli/commands/run-once/planning-phase-runner-planning.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/result-diagnostic-types.ts \
  src/cli/commands/run-once/result-diagnostic-planning.ts \
  src/cli/commands/run-once/result-diagnostics.test.ts
git commit -m "fix(run-once): report merged planning evidence blockers"
```

## Task 5: Run full verification

**Files:**

- Verify only; no planned source or dependency changes.

**Interfaces:**

- Consumes: all behavior and tests from Tasks 1-4.
- Produces: fresh focused, Run-once, repository-wide, formatting, type, build,
  and architecture evidence suitable for final review.

- [ ] **Step 1: Run the focused regression set**

```sh
node --test \
  src/cli/commands/run-once/planning-merge-recovery.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup.test.ts \
  src/cli/commands/run-once/planning-phase-cleanup-pending.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-head-adoption.real.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/result-diagnostics.test.ts \
  src/workflow/planning-pull-request-validation.test.ts
```

Expected: PASS. Confirm the real-Git regression actually deletes the source
branch and never performs open-head adoption.

- [ ] **Step 2: Run the required Run-once and repository suites**

```sh
npm run test:run-once
npm test
```

Expected: both commands PASS.

- [ ] **Step 3: Run static, build, type, and architecture validation**

```sh
npm run lint
npm run build
npm run check:types
npm run check:architecture
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 4: Confirm dependency metadata and worktree scope**

```sh
git status --short
git diff --name-only HEAD~4..HEAD
```

Expected: only the planned Run-once source/tests and this carried plan are
changed; `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` are
absent. Therefore the dependency-triggered Nix build is not required. If any of
those files appears, either remove the accidental change or run the Nix build
required by `AGENTS.md` before completion.

- [ ] **Step 5: Preserve final verification evidence**

Record exact command results and any residual risks in the implementation
handoff. Do not create an empty validation commit; if verification requires a
source fix, rerun the affected focused test and all commands in Steps 2-3, then
commit that fix with an accurate Conventional Commit message.

## Self-Review Coverage Matrix

| Spec requirement                                    | Plan coverage                    |
| --------------------------------------------------- | -------------------------------- |
| Validate stable pull-request identity before status | Task 3 Steps 2 and 6             |
| Keep strict adoption for revised open heads         | Task 3 Steps 2 and 6             |
| Skip source adoption/inspection for merged heads    | Task 3 Steps 1, 6, and 7         |
| Merge and fetched-base regular-file proof           | Task 1 Steps 1 and 5             |
| Typed ancestry/tree fallback only                   | Task 1 Steps 3-5                 |
| Exact saved path/kind current-base recovery         | Task 1 Steps 3 and 5             |
| Proof before cleanup and no mutation on blocker     | Task 3 Steps 3 and 6             |
| Terminal cleanup skips only remote equality         | Task 2 Steps 1-5                 |
| Cleanup pending and interruption-safe retries       | Task 2 Step 2 and Task 3 Step 3  |
| Preserve recorded `A`; anchor artifacts at base     | Task 3 Steps 1, 6, and 7         |
| Exact server pull-ref identity remains narrow       | Task 3 Step 2 and validator test |
| Actionable post-merge blocker                       | Task 4 Steps 1-5                 |
| Real-Git merge-before-adoption regression           | Task 3 Step 7                    |
| Full required validation; no dependency change      | Task 5                           |
