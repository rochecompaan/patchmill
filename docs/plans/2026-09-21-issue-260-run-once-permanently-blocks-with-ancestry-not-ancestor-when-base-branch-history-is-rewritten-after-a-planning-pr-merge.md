# Recover Planning Merges After Base-History Rewrites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merged planning phase recover from an exact
`ancestry/not-ancestor` result after a base-history rewrite when the freshly
fetched base still contains every saved artifact at its exact regular-file path,
while returning an actionable blocker when that proof is insufficient.

**Architecture:** Isolate rewritten-merge artifact proof in a focused module
that classifies snapshot candidates and verifies all expected paths at the
pinned fetched base. The reconciler invokes it only for the typed non-ancestor
result, then persists the existing merged-completion shape with the forge merge
OID as provenance and the fetched base OID as the effective anchor; the phase
runner maps insufficient proof into the structured diagnostic catalog.
Implementation preparation validates all prior artifacts but checks ancestry
only from the newest completed planning phase's effective base anchor.

**Tech Stack:** TypeScript ESM, Node.js and `node:test`, real Git repositories
and a bare remote for integration coverage, existing planning
state/reconciliation and structured-diagnostic contracts, Prettier, ESLint, and
the TypeScript build; no new dependency.

**Spec:**
`docs/specs/2026-09-21-issue-260-run-once-permanently-blocks-with-ancestry-not-ancestor-when-base-branch-history-is-rewritten-after-a-planning-pr-merge-design.md`

## Global Constraints

- Enter recovery only for a `PlanningPublicationGitError` whose `operation` is
  exactly `ancestry` and whose `reason` is exactly `not-ancestor`, thrown by the
  post-merge merge-commit-to-fetched-base check.
- Preserve hard failures for invalid input, command failures, malformed
  responses, fetch failures, untyped errors, and every unrelated operation or
  reason.
- Recovery requires exactly one candidate for every saved phase artifact, that
  candidate must equal the saved path, and every saved path must be a regular
  file at the pinned fetched base OID.
- Candidate order must never select an artifact. A sole candidate at another
  path is a mismatch, not a rename to adopt.
- Do not inspect the stale merge object or old workspace blobs during recovery.
  The fetched base candidate set plus regular-file proof is the recovery
  boundary.
- Keep normal merged reconciliation unchanged: when ancestry succeeds, verify
  regular files at both the forge merge commit and fetched base before
  completing.
- Successful recovery retains `completion.mergeOid` as forge provenance, sets
  `completion.mergedBaseOid` to the fetched base OID, and rewrites every phase
  artifact to `source: "remote-base"` at that same OID through one locked,
  revisioned phase replacement.
- Failed recovery leaves the phase `pull-request-open`, with completed cleanup
  evidence but without a completion replacement, and returns stable reason
  `planning-merge-recovery-blocked` with `after-action` retry guidance.
- The blocker must report Issue, phase, pull request, saved base branch, forge
  merge OID, fetched base OID, evidence failure, saved artifact kinds and paths,
  and observed candidates, including an explicit `(none)` value for missing
  candidates.
- Recovery guidance must direct operators to restore exactly one regular
  artifact at each reported saved path through normal reviewed base-branch
  changes, then rerun `patchmill run-once --issue N`. It must warn against
  editing planning state, arbitrarily choosing a candidate, or restoring stale
  history merely to satisfy the old SHA.
- For implementation ancestry, use only the newest completed planning phase's
  effective anchor: `phase.base.baseOid` for `remote-base` completion and
  `phase.completion.mergedBaseOid` for `merged-pull-request` completion.
  Original planning bases, forge `mergeOid` values, and superseded earlier
  anchors remain provenance only.
- Continue candidate-matching and regular-file verification for every artifact
  from every completed planning phase on the fresh implementation base.
- Keep planning state version 1 and the existing completion schema unchanged. Do
  not change pull-request identity, cleanup ordering, review gates, labels, or
  workspace ownership behavior.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If implementation unexpectedly retains an npm dependency metadata change, run
  the Nix build required by `AGENTS.md`.

---

## File and Module Map

### Focused recovery proof

- Create `src/cli/commands/run-once/planning-merge-recovery.ts` to own
  saved-path candidate classification, one batched regular-file proof at the
  fetched base, and the narrow `tree/non-regular-file` blocker conversion.
- Create `src/cli/commands/run-once/planning-merge-recovery.test.ts` for exact,
  combined-artifact, missing, ambiguous, mismatched, non-regular, and hard-error
  behavior.

### Reconciliation and public blocker

- Modify `src/cli/commands/run-once/planning-phase-reconciler.ts` to catch only
  the exact post-merge ancestry mismatch, call the focused proof, return a typed
  insufficient-evidence outcome, and persist recovered completion.
- Modify `src/cli/commands/run-once/planning-phase-reconciler.test.ts` to
  protect normal verification order, exact recovery classification, durable
  evidence, no stale-object/workspace inspection, no premature completion, and
  hard-error propagation.
- Modify `src/cli/commands/run-once/planning-phase-runner-planning.ts` and
  `src/cli/commands/run-once/planning-phase-runner.test.ts` to map the typed
  reconciliation outcome to `planning-merge-recovery-blocked` with complete
  diagnostic context.
- Modify `src/cli/commands/run-once/result-diagnostic-types.ts`,
  `src/cli/commands/run-once/result-diagnostic-helpers.ts`,
  `src/cli/commands/run-once/result-diagnostic-planning.ts`, and
  `src/cli/commands/run-once/result-diagnostics.test.ts` to add the stable
  reason, context labels, safe action, safety text, and `after-action` retry
  contract.

### Implementation-base validation

- Modify `src/cli/commands/run-once/planning-implementation-base.ts` to derive
  one newest effective planning anchor while retaining all-artifact proof.
- Create `src/cli/commands/run-once/planning-implementation-base.test.ts` for
  multi-phase anchor and artifact behavior rather than growing the already-large
  phase-runner test module.
- Modify the existing anchor assertions in
  `src/cli/commands/run-once/planning-phase-runner.test.ts` to expect the new
  single-anchor contract at both pending and resumed implementation boundaries.

### Real-Git regression

- Modify `src/cli/commands/run-once/planning-phase-reconciler.real.test.ts` in
  two red/green stages: Task 2 makes its existing reviewed-squash scenario amend
  and force-push the base commit before proving reconciliation re-anchors to the
  rewritten OID; Task 3 then proves that recovered state passes the
  implementation-base gate without consulting stale ancestry.

The new recovery module separates evidence policy from the reconciler's host,
cleanup, fetch, and persistence orchestration. The 239-line reconciler and
1,228-line phase-runner test file should not absorb candidate-classification
helpers or a large new test matrix. `planning-implementation-base.ts` remains a
small focused gate, with its new behavior covered directly beside it.

## Shared Interfaces

Use these names and shapes consistently across tasks.

```ts
// planning-merge-recovery.ts
export type PlanningMergeRecoveryFailure =
  | "missing"
  | "ambiguous"
  | "path-mismatch"
  | "non-regular-file";

export type PlanningMergeRecoveryResult =
  | Readonly<{ kind: "verified" }>
  | Readonly<{
      kind: "blocked";
      failure: PlanningMergeRecoveryFailure;
      artifactKinds: readonly ("spec" | "plan")[];
      expectedPaths: readonly string[];
      observedCandidates: readonly string[];
    }>;

export async function verifyPlanningMergeRecoveryEvidence(input: {
  artifacts: readonly PlanningArtifactEvidence[];
  base: PlanningRemoteBaseSnapshot;
  git: Pick<PlanningPublicationOperations, "assertRegularFiles">;
}): Promise<PlanningMergeRecoveryResult>;
```

For `missing`, `ambiguous`, and `path-mismatch`, the blocked arrays identify the
single artifact whose candidate proof failed. For `non-regular-file`, they list
all phase artifacts passed to the one batched `assertRegularFiles` call because
the existing Git error intentionally does not claim which path failed. This
keeps diagnostics complete without inventing a culprit.

```ts
// planning-phase-reconciler.ts
export type PlanningMergeRecoveryBlockedOutcome = Readonly<{
  kind: "merge-recovery-blocked";
  pullRequest: Extract<PullRequestSummary, { status: "merged" }>;
  baseBranch: string;
  baseOid: string;
  evidence: Extract<PlanningMergeRecoveryResult, { kind: "blocked" }>;
}>;
```

Add `PlanningMergeRecoveryBlockedOutcome` as one member of the existing
`PlanningPhaseReconciliation` union. The existing `merged` outcome remains
unchanged for both normal and recovered completion. The caller can advance
identically after durable replacement; only insufficient evidence needs a new
public outcome.

```ts
// result-diagnostic-types.ts
export type RunOnceDiagnosticContextByReason = {
  // existing contexts
  "planning-merge-recovery-blocked": Base & {
    phase: "spec" | "plan";
    pullRequestUrl: string;
    baseBranch: string;
    forgeMergeOid: string;
    fetchedBaseOid: string;
    evidenceFailure: PlanningMergeRecoveryFailure;
    artifactKinds: readonly ("spec" | "plan")[];
    expectedPaths: readonly string[];
    observedCandidates: readonly string[];
  };
};
```

At the runner boundary, preserve real candidate arrays when nonempty and render
an empty missing set explicitly:

```ts
observedCandidates:
  result.outcome.evidence.observedCandidates.length === 0
    ? ["(none)"]
    : result.outcome.evidence.observedCandidates,
```

For implementation ancestry, keep anchor derivation private to the focused gate:

```ts
function effectivePlanningAnchor(
  phase: Extract<
    PlanningPhaseStateV1,
    { kind: "spec" | "plan"; status: "complete" }
  >,
): string {
  return phase.completion.kind === "merged-pull-request"
    ? phase.completion.mergedBaseOid
    : phase.base.baseOid;
}
```

Iterating phases in durable order and assigning this value to one `newestAnchor`
variable makes supersession explicit. Artifact candidate and path collection
still occurs for every completed planning phase.

## Testing Value Gate

All planned automated tests pass Patchmill's Testing Value Gate:

- They prove behavior rather than source layout: a production deadlock recovers
  only with exact current-base evidence, durable state is re-anchored, public
  output becomes actionable, and implementation can advance without stale
  ancestry checks.
- They can fail for meaningful regressions: broad error catching, arbitrary
  candidate selection, rename adoption, stale merge inspection, missing regular
  files, premature state replacement, incomplete diagnostics, repeated wedges,
  or weakened all-prior-artifact validation.
- Maintainers can rerun them whenever Git error classification, remote-base
  discovery, reconciliation, planning diagnostics, or implementation-base
  validation changes.
- The behavior is reusable and high-risk because it controls whether reviewed
  planning evidence can be trusted after history rewrites and whether an Issue
  run becomes permanently blocked.

Do not add tests for plan/spec prose, static dependency versions, the mere
presence of the new module, or the unchanged state-schema version. Verify those
directly with diff inspection, lint, type checks, architecture checks, and the
conditional dependency/Nix command.

---

### Task 1: Build the Focused Current-Base Recovery Proof

**Files:**

- Create: `src/cli/commands/run-once/planning-merge-recovery.ts`
- Create: `src/cli/commands/run-once/planning-merge-recovery.test.ts`

**Interfaces:**

- Consumes: `PlanningArtifactEvidence[]`, one pinned
  `PlanningRemoteBaseSnapshot`, and `assertRegularFiles()` from
  `PlanningPublicationOperations`.
- Produces: `PlanningMergeRecoveryFailure`, `PlanningMergeRecoveryResult`, and
  `verifyPlanningMergeRecoveryEvidence()` exactly as defined in **Shared
  Interfaces**. It performs no fetch, ancestry check, state mutation, workspace
  read, host call, or diagnostic rendering.

- [ ] **Step 1: Write table-driven candidate-classification tests**

  In `planning-merge-recovery.test.ts`, define saved spec and plan artifacts and
  a base snapshot fixture. Add one table covering zero candidates, multiple
  candidates, and a sole different path:

  ```ts
  for (const [name, candidates, failure] of [
    ["missing", [], "missing"],
    [
      "ambiguous",
      ["docs/specs/issue-260.md", "docs/specs/issue-260-copy.md"],
      "ambiguous",
    ],
    ["mismatched", ["docs/specs/issue-260-renamed.md"], "path-mismatch"],
  ] as const) {
    const result = await verifyPlanningMergeRecoveryEvidence({
      artifacts: [specArtifact],
      base: snapshot({ spec: candidates, plan: [] }),
      git: { assertRegularFiles: async () => assert.fail("must not inspect") },
    });
    assert.deepEqual(
      result,
      {
        kind: "blocked",
        failure,
        artifactKinds: ["spec"],
        expectedPaths: [specArtifact.path],
        observedCandidates: candidates,
      },
      name,
    );
  }
  ```

  The assertions must prove candidate order is never used to select an artifact
  and a rename is not adopted.

- [ ] **Step 2: Write the exact combined-artifact proof test**

  Supply exact spec and plan candidates in the opposite order from the saved
  artifacts, record calls, and assert there is exactly one Git call pinned to
  `base.baseOid` with saved artifact order:

  ```ts
  assert.deepEqual(calls, [
    {
      commitOid: rewrittenBaseOid,
      paths: [specArtifact.path, planArtifact.path],
    },
  ]);
  assert.deepEqual(result, { kind: "verified" });
  ```

  This protects combined planning phases and prevents per-candidate or
  unpinned-tree inspection.

- [ ] **Step 3: Write typed non-regular and hard-error tests**

  Make `assertRegularFiles()` throw each representative error. Assert only
  `new PlanningPublicationGitError("tree", "non-regular-file")` becomes:

  ```ts
  {
    kind: "blocked",
    failure: "non-regular-file",
    artifactKinds: ["spec", "plan"],
    expectedPaths: [specArtifact.path, planArtifact.path],
    observedCandidates: [specArtifact.path, planArtifact.path],
  }
  ```

  Assert `tree/command-failed`, `tree/invalid-input`, `tree/malformed-response`,
  `ancestry/not-ancestor`, and an untyped `Error("inspection failed")` reject
  with the original object. No broad catch-to-block behavior is allowed.

- [ ] **Step 4: Run the focused test and verify the red state**

  Run:

  ```sh
  node --test src/cli/commands/run-once/planning-merge-recovery.test.ts
  ```

  Expected before implementation: FAIL because the module and exported contract
  do not exist.

- [ ] **Step 5: Implement candidate proof and the narrow tree-error boundary**

  Implement one ordered pass over saved artifacts. Return on the first candidate
  failure; otherwise call `assertRegularFiles()` once with all saved paths.
  Catch only this exact condition:

  ```ts
  if (
    error instanceof PlanningPublicationGitError &&
    error.operation === "tree" &&
    error.reason === "non-regular-file"
  ) {
    return {
      kind: "blocked",
      failure: "non-regular-file",
      artifactKinds: input.artifacts.map((artifact) => artifact.kind),
      expectedPaths: paths,
      observedCandidates: input.artifacts.flatMap(
        (artifact) => input.base.artifactCandidates[artifact.kind],
      ),
    };
  }
  throw error;
  ```

  Do not inspect artifact bytes, compare the old workspace, fetch again, or
  catch another Git failure.

- [ ] **Step 6: Run the focused proof tests**

  Run:

  ```sh
  node --test src/cli/commands/run-once/planning-merge-recovery.test.ts
  ```

  Expected: PASS. Exact combined evidence yields one regular-file call; every
  insufficiency has the correct typed result; infrastructure errors propagate.

- [ ] **Step 7: Commit the focused evidence verifier**

  ```sh
  git add \
    src/cli/commands/run-once/planning-merge-recovery.ts \
    src/cli/commands/run-once/planning-merge-recovery.test.ts
  git commit -m "feat(run-once): verify rewritten planning merge evidence"
  ```

---

### Task 2: Reconcile Rewritten Merges and Publish an Actionable Blocker

**Files:**

- Modify: `src/cli/commands/run-once/planning-phase-reconciler.ts:1-239`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.real.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-planning.ts:16-104`
- Modify: `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-types.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-helpers.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-planning.ts`
- Modify: `src/cli/commands/run-once/result-diagnostics.test.ts`

**Interfaces:**

- Consumes: Task 1's `verifyPlanningMergeRecoveryEvidence()`, the existing
  `PlanningPublicationGitError`, fetched snapshot, phase artifacts, locked
  `replacePlanningPhase()` path, `runOnceFailure()`, and generic diagnostic
  materializer.
- Produces: the `merge-recovery-blocked` reconciliation outcome and stable
  public reason `planning-merge-recovery-blocked` with the exact context from
  **Shared Interfaces**. Successful recovery continues to return the existing
  `merged` outcome after persistence.

- [ ] **Step 1: Extend reconciler fixtures with exact fetched candidates**

  Add an `artifactCandidates` fixture override while preserving the current
  normal-path defaults. Import `PlanningPublicationGitError`. Record full
  regular-file inputs, not only the commit OID, so assertions can distinguish
  merge-object proof from fetched-base proof:

  ```ts
  async assertRegularFiles(value: { commitOid: string; paths: string[] }) {
    events.push(`regular:${value.commitOid}:${value.paths.join(",")}`);
    if (input.regularError) throw input.regularError;
  }
  ```

  Keep existing normal merged assertions and update only their event spelling.

- [ ] **Step 2: Write the failing successful-recovery reconciler test**

  Make the merged pull request report `mergeOid`, return a fetched snapshot at
  `mergedBaseOid` with the exact saved candidate, and make only the ancestry
  call throw `new PlanningPublicationGitError("ancestry", "not-ancestor")`.
  Assert the event order ends with:

  ```ts
  [
    `ancestor:${mergeOid}:${mergedBaseOid}`,
    `regular:${mergedBaseOid}:docs/specs/example.md`,
    "replace:complete:complete",
  ];
  ```

  Assert no `regular:${mergeOid}` event and no event containing the old
  workspace `headOid`. Assert durable state retains `mergeOid`, sets
  `mergedBaseOid`, and rewrites artifact source/commit to the fetched base.

- [ ] **Step 3: Write failing blocked and exact-error-boundary tests**

  For an exact ancestry mismatch plus an ambiguous candidate set, assert the
  outcome is:

  ```ts
  {
    kind: "merge-recovery-blocked",
    pullRequest: mergedPullRequest,
    baseBranch: "saved-main",
    baseOid: mergedBaseOid,
    evidence: {
      kind: "blocked",
      failure: "ambiguous",
      artifactKinds: ["spec"],
      expectedPaths: ["docs/specs/example.md"],
      observedCandidates: [
        "docs/specs/example.md",
        "docs/specs/example-copy.md",
      ],
    },
  }
  ```

  Assert cleanup checkpoints remain durable but no complete replacement occurs.
  Add a table for `ancestry/command-failed`, `ancestry/invalid-input`,
  `ancestry/malformed-response`, `tree/command-failed` during recovery, an
  untyped error, `PlanningWorkspaceCommandError("fetch", result)`, and
  `PlanningWorkspaceResponseError("tree-inspection", "malformed-record")`. Every
  value must reject unchanged, without a completion replacement. Retain a
  normal-ancestor assertion proving both merge and base regular-file checks
  still run in order.

- [ ] **Step 4: Make the existing real-Git squash test reproduce the rewrite**

  Keep the planning workspace content as `planning A` and reviewed squash
  content as `reviewed B`. Capture and push the reviewed commit as
  `forgeMergeOid`, then amend only its message and force-push the new
  `rewrittenBaseOid`:

  ```ts
  const forgeMergeOid = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "origin", "main");
  git(repo, "commit", "--amend", "-m", "rewritten reviewed squash merge");
  const rewrittenBaseOid = git(repo, "rev-parse", "HEAD");
  assert.notEqual(rewrittenBaseOid, forgeMergeOid);
  git(repo, "push", "--force", "origin", "main");
  ```

  Make the host summary continue reporting `mergeCommit: forgeMergeOid`. Assert
  reconciliation returns `kind: "merged"` at `rewrittenBaseOid`, artifact
  evidence points there, completion retains the forge OID and uses the rewritten
  base OID, and no command inspects the planning workspace blob OID. Do not add
  the implementation-base assertion yet; Task 3 adds that as its own red test.

- [ ] **Step 5: Add the stable diagnostic contract and catalog test first**

  Add `planning-merge-recovery-blocked` to `RUN_ONCE_REASON_CODES`,
  `PlanningDiagnosticReasonCode`, and `RunOnceDiagnosticContextByReason`. Add
  labels for `baseBranch`, `forgeMergeOid`, `fetchedBaseOid`, `evidenceFailure`,
  `artifactKinds`, `expectedPaths`, and `observedCandidates` in
  `result-diagnostic-helpers.ts`.

  Add this representative context to the exhaustive fixture in
  `result-diagnostics.test.ts`:

  ```ts
  "planning-merge-recovery-blocked": {
    issueNumber: 260,
    status: "blocked",
    phase: "spec",
    pullRequestUrl: "https://example.test/pulls/260",
    baseBranch: "main",
    forgeMergeOid: "a".repeat(40),
    fetchedBaseOid: "b".repeat(40),
    evidenceFailure: "missing",
    artifactKinds: ["spec"],
    expectedPaths: ["docs/specs/issue-260.md"],
    observedCandidates: ["(none)"],
  },
  ```

  Add a focused assertion that the materialized diagnostic has
  `retry.kind === "after-action"`, offers `patchmill run-once --issue 260`,
  mentions normal reviewed changes and exactly one regular artifact at the saved
  path, and warns against state editing, arbitrary candidate selection, and
  restoring stale history.

- [ ] **Step 6: Write the failing phase-runner blocker mapping test**

  Stub reconciliation with the new outcome and assert the runner returns
  `kind: "blocked"`, leaves the returned state unchanged, uses reason
  `planning-merge-recovery-blocked`, and carries every diagnostic field. For a
  missing candidate, assert the runner maps the empty internal list to
  `observedCandidates: ["(none)"]` so redirected and terminal diagnostics do not
  omit the fact.

- [ ] **Step 7: Run focused tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected before implementation: FAIL because the exact ancestry mismatch still
  rejects in both mocked and real Git, the reconciliation union has no blocker
  outcome, and the diagnostic reason is absent.

- [ ] **Step 8: Implement the narrow reconciliation branch**

  Wrap only the post-fetch ancestry assertion. Use a boolean to distinguish the
  recovered proof from the normal path:

  ```ts
  let recoveredAtCurrentBase = false;
  try {
    await input.git.assertAncestor({
      ancestorOid: pullRequest.mergeCommit,
      descendantOid: snapshot.baseOid,
    });
  } catch (error) {
    if (
      !(error instanceof PlanningPublicationGitError) ||
      error.operation !== "ancestry" ||
      error.reason !== "not-ancestor"
    )
      throw error;
    const evidence = await verifyPlanningMergeRecoveryEvidence({
      artifacts: phase.artifacts,
      base: snapshot,
      git: input.git,
    });
    if (evidence.kind === "blocked")
      return {
        state,
        outcome: {
          kind: "merge-recovery-blocked",
          pullRequest,
          baseBranch: phase.base.baseBranch,
          baseOid: snapshot.baseOid,
          evidence,
        },
      };
    recoveredAtCurrentBase = true;
  }
  ```

  Run the existing merge-commit and fetched-base regular-file calls only when
  `recoveredAtCurrentBase` is false. Then use the existing single completion
  replacement for both paths. Do not catch replacement failures and do not
  return `merged` before replacement resolves.

- [ ] **Step 9: Implement runner mapping and diagnostic policy**

  Add the new switch case in `planning-phase-runner-planning.ts`, using
  `runOnceFailure("planning-merge-recovery-blocked", context)`. Populate
  `forgeMergeOid` from `pullRequest.mergeCommit`, `fetchedBaseOid` from the
  outcome, and apply the explicit `(none)` mapping from **Shared Interfaces**.

  In `result-diagnostic-planning.ts`, add a catalog definition with:

  ```ts
  summary: "Planning merge recovery needs reviewed base evidence",
  explanation:
    "The forge merge commit is no longer an ancestor of the fetched base, and the fetched base does not provide exact regular-file evidence for every saved planning artifact.",
  action:
    "Restore exactly one regular artifact at each reported saved path through normal reviewed changes on the configured base branch, then rerun the Issue.",
  command: "run-once",
  safety:
    "Do not hand-edit planning state, arbitrarily choose a candidate, or restore stale history merely to satisfy the old merge SHA.",
  retry: after(
    "Retry after reviewed base changes restore the reported artifact evidence.",
  ),
  ```

  Keep all evidence values in diagnostic details; do not interpolate branch,
  path, OID, URL, or candidate text into a shell command.

- [ ] **Step 10: Run focused reconciliation, runner, diagnostic, and real-Git
      tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-merge-recovery.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected: PASS. Normal merges retain both tree checks; exact rewrites recover
  in mocks and a real repository; insufficient evidence blocks without
  completion; all other failures remain hard errors; the blocker is actionable
  and exhaustive.

- [ ] **Step 11: Commit reconciliation and public blocker behavior**

  ```sh
  git add \
    src/cli/commands/run-once/planning-phase-reconciler.ts \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts \
    src/cli/commands/run-once/planning-phase-runner-planning.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/result-diagnostic-types.ts \
    src/cli/commands/run-once/result-diagnostic-helpers.ts \
    src/cli/commands/run-once/result-diagnostic-planning.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  git commit -m "fix(run-once): recover rewritten planning merges"
  ```

---

### Task 3: Validate Only the Newest Effective Planning Anchor

**Files:**

- Modify: `src/cli/commands/run-once/planning-implementation-base.ts:1-65`
- Create: `src/cli/commands/run-once/planning-implementation-base.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.real.test.ts`

**Interfaces:**

- Consumes: completed planning phases before `phaseIndex`, each phase's existing
  completion discriminant, the fresh implementation-base snapshot, and existing
  `assertAncestor()`/`assertRegularFiles()` operations.
- Produces: unchanged public function
  `assertPlanningImplementationBase(...): Promise<void>`, now with one ancestry
  call for the newest effective planning anchor and unchanged candidate/path
  proof across all completed planning artifacts, plus the real-Git proof that a
  recovered phase clears this gate.

- [ ] **Step 1: Create direct multi-phase anchor tests**

  Build a state with an older `remote-base` spec completion and a newer
  `merged-pull-request` plan completion. Give both artifacts exact candidates.
  Record Git calls and assert:

  ```ts
  assert.deepEqual(ancestorCalls, [
    {
      ancestorOid: newestPlan.completion.mergedBaseOid,
      descendantOid: implementationBase.baseOid,
    },
  ]);
  assert.deepEqual(regularCalls, [
    {
      commitOid: implementationBase.baseOid,
      paths: [specPath, planPath],
    },
  ]);
  ```

  Explicitly assert the older remote-base OID, newer phase's original base OID,
  and forge merge OID never appear as ancestry inputs.

- [ ] **Step 2: Add remote-base and all-prior-artifact tests**

  Add a case where the newest completed phase has
  `completion.kind === "remote-base"`; assert its `phase.base.baseOid` is the
  sole anchor. Add a table proving a missing, ambiguous, or sole mismatched
  candidate from either an old or new completed phase still throws the matching
  `PlanningImplementationBaseError` before regular-file verification. Add a
  non-regular/command-error pass-through assertion so reducing ancestry anchors
  does not weaken tree proof.

- [ ] **Step 3: Update phase-runner boundary assertions**

  In the existing pending and resumed implementation tests, replace expectations
  of `[originalBaseOid, mergeOid, mergedBaseOid]` with the sole `mergedBaseOid`.
  Rename the history-rewrite case to state that the **newest effective** anchor
  is still fail-closed if it is later rewritten away. Keep assertions that
  workspace preparation/resume and implementation dispatch do not run after that
  failure.

- [ ] **Step 4: Extend the recovered real-Git test through the implementation
      gate**

  Import `assertPlanningImplementationBase`, retain the `PlanningRemoteBaseGit`
  instance used by reconciliation, fetch the remote again, and append:

  ```ts
  const implementationBase = await remoteBase.fetch({
    issueNumber: 188,
    remote: "origin",
    baseBranch: "main",
  });
  await assertPlanningImplementationBase({
    state: result.state,
    phaseIndex: 1,
    base: implementationBase,
    git: publication,
  });
  ```

  The call must eventually pass even though `forgeMergeOid` is not an ancestor
  of `rewrittenBaseOid`. This extension is red under the current implementation
  gate, which still checks the forge merge OID.

- [ ] **Step 5: Run focused tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-implementation-base.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts
  ```

  Expected before implementation: FAIL because the gate checks original,
  forge-merge, merged-base, and earlier phase anchors instead of one newest
  effective anchor; the real-Git failure occurs at the stale forge merge OID.

- [ ] **Step 6: Implement effective-anchor supersession**

  Add the private `effectivePlanningAnchor()` from **Shared Interfaces**.
  Replace the anchor `Set` with one `newestAnchor: string | undefined`; while
  iterating completed planning phases in durable order, assign the current
  phase's effective anchor and continue collecting/candidate-matching every
  artifact. After the loop:

  ```ts
  if (newestAnchor !== undefined)
    await input.git.assertAncestor({
      ancestorOid: newestAnchor,
      descendantOid: input.base.baseOid,
    });
  ```

  Keep one batched regular-file call for all deduplicated saved paths. Update
  the function comment to describe the newest effective anchor plus all-artifact
  invariant; do not change error reasons or the caller contract.

- [ ] **Step 7: Run implementation-base, runner, and real-Git tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-implementation-base.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts
  ```

  Expected: PASS. Only the newest effective anchor controls ancestry, every
  prior artifact still requires an exact candidate and a regular file on the
  fresh base, and the amended/force-pushed real repository clears the next-phase
  gate.

- [ ] **Step 8: Commit effective implementation-base validation**

  ```sh
  git add \
    src/cli/commands/run-once/planning-implementation-base.ts \
    src/cli/commands/run-once/planning-implementation-base.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts
  git commit -m "fix(run-once): use effective planning base anchor"
  ```

---

### Task 4: Run Full Regression and Scope Verification

**Files:**

- Verify: `src/cli/commands/run-once/planning-merge-recovery.ts`
- Verify: `src/cli/commands/run-once/planning-phase-reconciler.ts`
- Verify: `src/cli/commands/run-once/planning-phase-runner-planning.ts`
- Verify: `src/cli/commands/run-once/planning-implementation-base.ts`
- Verify: `src/cli/commands/run-once/result-diagnostic-types.ts`
- Verify: `src/cli/commands/run-once/result-diagnostic-helpers.ts`
- Verify: `src/cli/commands/run-once/result-diagnostic-planning.ts`
- Verify: focused unit and real-Git tests from Tasks 1-3
- Verify unchanged: planning state schema/version, pull-request identity,
  cleanup ordering, review/label policy, dependencies, and unrelated Git error
  behavior

**Interfaces:**

- Consumes: Tasks 1-3's commits and the implementation-carried spec/plan.
- Produces: fresh focused, Run-once, repository, lint, build, type,
  architecture, dependency/Nix-condition, and final-scope evidence. This task
  creates no validation-only commit when no tracked file changes.

- [ ] **Step 1: Run the focused recovery regression command**

  Run exactly:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-merge-recovery.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/planning-implementation-base.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected: PASS with no failed, cancelled, or skipped issue-specific tests.

- [ ] **Step 2: Run the complete Run-once workflow suite**

  Run:

  ```sh
  npm run test:run-once
  ```

  Expected: PASS. Normal merge reconciliation, planning cleanup, publication,
  diagnostics, implementation preparation/resume, and unrelated Run-once
  behavior remain green.

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

  Expected for this issue: the skip message. If npm dependency metadata changed
  and remains necessary, `nix build` must run and exit `0` before completion.

- [ ] **Step 5: Review final scope and invariants**

  Run:

  ```sh
  git status --short
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- \
    src/cli/commands/run-once/planning-merge-recovery.ts \
    src/cli/commands/run-once/planning-phase-reconciler.ts \
    src/cli/commands/run-once/planning-phase-runner-planning.ts \
    src/cli/commands/run-once/planning-implementation-base.ts \
    src/cli/commands/run-once/result-diagnostic-types.ts \
    src/cli/commands/run-once/result-diagnostic-helpers.ts \
    src/cli/commands/run-once/result-diagnostic-planning.ts
  git diff --quiet origin/main...HEAD -- \
    src/workflow/planning-state-types.ts \
    src/workflow/planning-state-validation.ts \
    package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: the quiet diff command exits `0`; the worktree is clean; the carried
  spec and plan plus scoped source/tests are present; state and dependency files
  are unchanged. Confirm from the final diff that only exact
  `ancestry/not-ancestor` enters recovery, normal merges still inspect both
  commits, blocked recovery cannot replace completion, successful recovery uses
  one fetched-base replacement, implementation checks only the newest effective
  anchor, and all prior artifacts remain verified.

- [ ] **Step 6: Record verification evidence without a new commit**

  Update the Task 4 Issue todo body with each exact command and outcome, any
  residual risk, and whether the conditional Nix build ran. Set that todo to the
  configured terminal status. Do not amend implementation commits or create a
  validation-only commit when verification changes no tracked file.

---

## Self-Review Notes

- **Spec coverage:** Task 1 owns exact candidate and regular-file proof. Task 2
  limits entry to the typed ancestry mismatch, preserves normal behavior,
  persists the existing completion shape, blocks insufficient evidence with
  complete actionable context, propagates all infrastructure failures, and
  reproduces recovery with real Git. Task 3 removes stale ancestry requirements
  while retaining every prior artifact check and extends the real-Git regression
  through the implementation boundary. Task 4 runs every command from the spec
  and enforces the repository's conditional Nix requirement.
- **Module boundaries:** Candidate policy lives in a focused recovery module;
  the reconciler retains orchestration and persistence; the phase runner owns
  public outcome translation; diagnostic files own operator policy; and the
  implementation-base gate owns anchor supersession. No generic helper bucket or
  unrelated refactor is introduced.
- **Type consistency:** `PlanningMergeRecoveryFailure`, blocked evidence fields,
  reconciliation outcome fields, runner diagnostic context, and catalog fixture
  use the same names and literal unions. Successful normal and recovered paths
  both retain the existing `merged` outcome and state schema.
- **Testing Value Gate:** New tests cover production safety, liveness, durable
  evidence, error classification, public diagnostics, and a real Git history
  rewrite. Static document, dependency, and schema-version assertions are
  deliberately handled by direct verification instead of brittle tests.
- **Placeholder scan:** Every code-changing task names exact files, interfaces,
  red/green commands, expected behavior, minimal implementation boundaries, and
  a Conventional Commit message. No implementation decision is deferred.
