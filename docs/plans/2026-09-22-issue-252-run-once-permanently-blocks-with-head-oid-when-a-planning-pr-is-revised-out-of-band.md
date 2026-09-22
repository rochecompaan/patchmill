# Recover Planning Pull Requests After Safe Head Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Run-once workflow automatically re-adopt a safely revised
planning pull request head, continue normal review or merge handling, and return
an actionable blocked result instead of permanently failing when the revision
cannot be proved safe.

**Architecture:** Split stable planning pull request identity from exact head
validation, then route a head-only mismatch through one focused Git adapter and
one focused Run-once adoption coordinator. The Git adapter fetches and pins the
saved branch, proves host/remote agreement, fast-forward ancestry, artifact-only
changes, regular-file artifacts, and safe local workspace advancement; the
coordinator atomically re-anchors every durable head field before publication or
reconciliation resumes. Publisher and reconciler share that coordinator, while
the phase runner maps typed unsafe-adoption evidence to the structured
diagnostic catalog.

**Tech Stack:** TypeScript ESM, Node.js and `node:test`, real temporary Git
repositories and bare remotes, the existing `planning-pr-v1` state/store,
workspace, publication, reconciliation, and diagnostic contracts, Prettier,
ESLint, TypeScript, and dependency-cruiser; no new dependency.

**Spec:**
`docs/specs/2026-09-21-issue-252-run-once-permanently-blocks-with-head-oid-when-a-planning-pr-is-revised-out-of-band-design.md`

## Global Constraints

- Treat target and head repository, saved base and head branch, Issue/phase
  ownership marker, canonical URL, and optional saved pull request reference as
  stable identity. A mismatch in any of them remains a hard
  `PlanningPullRequestValidationError` and never enters head adoption.
- Preserve exact-head validation for callers that require immutable head
  equality. This issue changes only spec/plan planning pull request publication
  and reconciliation; implementation pull request head equality remains strict.
- A `branch-pushed` phase may adopt a changed head only after exhaustive host
  discovery finds exactly one matching pull request and read-back confirms its
  stable identity. A changed or missing remote branch with no matching pull
  request is blocked, not created over or adopted anonymously.
- Fetch the exact saved remote branch into an internal evidence ref without
  checking it out or updating the remote branch. Require the fetched OID, the
  observed remote branch OID, and the host `headSha` to agree.
- Require `publication.headOid` to be an ancestor of the candidate. A
  force-push, rebase, unrelated history, or otherwise non-fast-forward revision
  is never adopted.
- Diff the recorded and candidate trees with rename detection disabled. Every
  net changed path must be one of the phase's saved artifact paths, and every
  saved artifact path must be a regular file at the candidate. Empty commits and
  multiple safe commits are allowed; a rename, deletion, symlink, submodule, or
  non-artifact change is not.
- Reconcile local workspace evidence without reset, clean, rebase, force-push,
  remote deletion, or branch recreation. A surviving clean worktree or local
  branch may advance only along the proved recorded-to-candidate chain. Preserve
  ignored content and use compare-and-swap for a branch-only ref.
- Re-observe the saved remote branch after local reconciliation. A moved head
  performs no durable state replacement and returns one typed blocker; a later
  Run attempt may evaluate the newer head without an unbounded retry loop.
- One locked, revision-checked `replacePlanningPhase()` call updates
  `publication.headOid`, `workspace.headOid`, every workspace-backed artifact
  OID, and `workspace.cleanup.pushedHeadOid` when present. It preserves base,
  workspace identity, artifact kinds and paths, pull request identity, cleanup
  discriminator, and all unrelated phase evidence.
- Permit the coordinated head-advance edge only for `branch-pushed` to
  `pull-request-open` and nonterminal `pull-request-open` spec/plan phases.
  Reject partial OID updates, cleanup regression, artifact identity changes, and
  completed-phase mutation. Keep workflow/state version 1 with no migration.
- A revised open planning pull request remains `review-pending`. A revised
  merged pull request still must pass existing cleanup, merge/base ancestry or
  recovery, and authoritative merged-base artifact proof before completion.
  Adoption never substitutes branch content for reviewed base evidence.
- Stable unsafe evidence returns `status: "blocked"`, reason
  `planning-head-adoption-blocked`, and `after-action` guidance. Only a head
  that moved during the bounded observation window uses `retry-now`.
- Command failures, invalid input, malformed Git or host responses, host
  transport failures, state conflicts, and unrelated identity failures remain
  hard errors and must not be converted into human-revision blockers.
- Do not use legacy spec or plan approval labels. The planning pull request
  merge remains the human review boundary for `planning-pr-v1`.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If implementation unexpectedly retains an npm dependency metadata change, run
  the Nix build required by `AGENTS.md`.

---

## File and Module Map

### Stable pull request identity

- Modify `src/workflow/planning-pull-request-validation.ts` to expose stable
  identity validation separately while retaining the existing exact validator.
- Modify `src/workflow/planning-pull-request-validation.test.ts` to prove that
  only a head mismatch is accepted by the stable layer and all other identity
  failures retain their existing reasons.

### Remote proof and local workspace reconciliation

- Create `src/git/planning-head-adoption-git.ts` as the focused Git adapter for
  remote observation/fetch, ancestry, net-path and tree proof, local worktree or
  branch fast-forward, and the final remote observation.
- Create `src/git/planning-head-adoption-git.test.ts` for command-level result
  classification, path safety, local checkpoint behavior, and hard-error
  propagation.
- Create `src/git/planning-head-adoption-git.real.test.ts` for real remote,
  worktree, branch-only, ignored-content, non-descendant, and unexpected-path
  behavior.
- Modify `src/git/planning-workspaces.ts` to define the adoption input/result
  contract and add `adoptPlanningHead()` to `PlanningWorkspaceLifecycle`.
- Modify `src/git/planning-workspace-git.ts` to compose the focused adapter
  rather than adding remote-proof and fast-forward responsibilities directly to
  the existing workspace facade.

### Atomic durable adoption

- Create `src/cli/commands/run-once/planning-head-adoption.ts` to coordinate an
  already identity-validated host summary, the focused Git proof/local
  reconciliation, and one durable phase replacement.
- Create `src/cli/commands/run-once/planning-head-adoption.test.ts` for exact,
  adopted, blocked, interrupted, and retry behavior.
- Modify `src/workflow/planning-state-transitions.ts` to recognize only the
  coordinated planning-head advance.
- Modify `src/workflow/planning-state.test.ts` and
  `src/workflow/planning-state-publication-regressions.test.ts` for every
  cleanup discriminator and rejection of partial or terminal rewrites.

### Publication and reconciliation integration

- Modify `src/cli/commands/run-once/planning-phase-cleanup.ts` and
  `src/cli/commands/run-once/planning-phase-cleanup.test.ts` so the exact remote
  pre-cleanup check returns a typed changed-head outcome instead of throwing a
  generic error.
- Modify `src/cli/commands/run-once/planning-phase-publisher.ts` and
  `src/cli/commands/run-once/planning-phase-publisher.test.ts` to discover and
  read back a supervising pull request before adopting a changed `branch-pushed`
  head, share adoption for already-open phases, and stop before pull request
  creation when changed remote evidence is unsupervised.
- Modify `src/cli/commands/run-once/planning-phase-reconciler.ts` and
  `src/cli/commands/run-once/planning-phase-reconciler.test.ts` to adopt revised
  open and merged pull requests before cleanup/status handling while retaining
  all existing merge proof.
- Create `src/cli/commands/run-once/planning-head-adoption.real.test.ts` for the
  complete open-to-merged real-Git regression and interruption recovery.

### Public blocked result

- Modify `src/cli/commands/run-once/planning-phase-runner-planning.ts` and
  `src/cli/commands/run-once/planning-phase-runner.test.ts` to map both
  publication and reconciliation adoption blockers to a nonfatal Run-once
  result.
- Modify `src/cli/commands/run-once/result-diagnostic-types.ts`,
  `src/cli/commands/run-once/result-diagnostic-helpers.ts`,
  `src/cli/commands/run-once/result-diagnostic-planning.ts`, and
  `src/cli/commands/run-once/result-diagnostics.test.ts` to add the stable
  reason, complete evidence labels, safe action, safety warning, and dynamic
  retry policy.

The new Git and Run-once modules keep the 350-line publication adapter, the
284-line reconciler, and the 242-line publisher from acquiring a second
multi-stage responsibility. The state transition module owns only structural
replacement invariants; it does not perform Git or host work.

## Shared Interfaces

Use these names and shapes consistently across tasks.

```ts
// planning-workspaces.ts
export type PlanningHeadAdoptionFailure =
  | "remote-missing"
  | "head-disagreement"
  | "not-descendant"
  | "unexpected-paths"
  | "non-regular-artifact"
  | "head-moved";

export type PlanningHeadAdoptionBlockedEvidence = Readonly<{
  failure: PlanningHeadAdoptionFailure;
  recordedHeadOid: string;
  hostHeadOid?: string;
  fetchedHeadOid?: string;
  remoteHeadOid?: string;
  artifactPaths: readonly string[];
  unexpectedPaths: readonly string[];
  cleanupState: PlanningWorkspaceCleanup["state"];
}>;

export type PlanningHeadAdoptionResult =
  | Readonly<{ kind: "adopted"; headOid: string }>
  | Readonly<{
      kind: "blocked";
      evidence: PlanningHeadAdoptionBlockedEvidence;
    }>;

export type PlanningHeadAdoptionInput = Readonly<{
  issueNumber: number;
  runId: string;
  phase: PlanningPhaseKind;
  workspace: PlanningWorkspaceOwnership;
  hostHeadOid: string;
  artifactPaths: readonly string[];
}>;
```

Add this method to `PlanningWorkspaceLifecycle`:

```ts
adoptPlanningHead(
  input: PlanningHeadAdoptionInput,
): Promise<PlanningHeadAdoptionResult>;
```

`recordedHeadOid` is `workspace.headOid`. The optional OIDs are omitted only
when that observation did not exist; diagnostic rendering must not invent an
OID. `unexpectedPaths` is an empty array for every classification except
`unexpected-paths`.

```ts
// planning-head-adoption.ts
export type PlanningHeadAdoptionBlockedOutcome = Readonly<{
  kind: "head-adoption-blocked";
  pullRequestUrl?: string;
  evidence: PlanningHeadAdoptionBlockedEvidence;
}>;

export type PlanningPullRequestHeadOutcome =
  | Readonly<{
      kind: "ready";
      state: PlanningStateV1;
      phase: PullRequestOpenPlanningPhase;
      adopted: boolean;
    }>
  | Readonly<{
      kind: "head-adoption-blocked";
      state: PlanningStateV1;
      pullRequestUrl?: string;
      evidence: PlanningHeadAdoptionBlockedEvidence;
    }>;

export async function adoptPlanningPullRequestHead(input: {
  state: PlanningStateV1;
  phaseIndex: number;
  validated: ValidatedPlanningPullRequest;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  workspaces: Pick<PlanningWorkspaceLifecycle, "adoptPlanningHead">;
  now?: () => Date;
}): Promise<PlanningPullRequestHeadOutcome>;
```

The coordinator accepts only a `branch-pushed` or `pull-request-open` spec/plan
phase. It persists the pull request reference and URL even when an exact
`branch-pushed` head needs no adoption. For a mismatch it calls
`adoptPlanningHead()`, then builds exactly this coordinated evidence update:

```ts
const workspace = {
  ...phase.workspace,
  headOid: candidateOid,
  cleanup:
    phase.workspace.cleanup.state === "ready" ||
    phase.workspace.cleanup.state === "cleanup-pending"
      ? phase.workspace.cleanup
      : { ...phase.workspace.cleanup, pushedHeadOid: candidateOid },
};
const next: PullRequestOpenPlanningPhase = {
  ...phase,
  status: "pull-request-open",
  workspace,
  publication: { ...phase.publication, headOid: candidateOid },
  artifacts: phase.artifacts.map((artifact) => ({
    ...artifact,
    source: "workspace",
    commitOid: candidateOid,
  })),
  pullRequest: {
    reference: input.validated.reference,
    url: input.validated.url,
  },
};
```

Use `replacePlanningPhase()` once after this object is complete. Never write a
partial head checkpoint.

```ts
// result-diagnostic-types.ts
"planning-head-adoption-blocked": Base & {
  phase: "spec" | "plan";
  pullRequestUrl?: string;
  recordedHeadOid: string;
  hostHeadOid?: string;
  fetchedHeadOid?: string;
  remoteHeadOid?: string;
  adoptionFailure: PlanningHeadAdoptionFailure;
  artifactPaths: readonly string[];
  unexpectedPaths?: readonly string[];
  cleanupState: PlanningWorkspaceCleanup["state"];
};
```

## Testing Value Gate

All planned automated tests pass Patchmill's Testing Value Gate:

- **Behavior rather than implementation:** The tests prove that a production
  deadlock recovers only after stable host identity, fetched Git evidence,
  artifact-only fast-forward history, coherent durable replacement, and normal
  review/merge proof. They do not assert mere source layout.
- **Meaningful regression sensitivity:** They fail if Patchmill accepts a
  force-push, unrelated path, rename, deleted or non-regular artifact, stale
  host/remote observation, dirty/divergent local state, partial OID update, or
  if it returns the original bare `head-oid`/remote-head error.
- **Maintainer value:** Maintainers can rerun the focused suites whenever pull
  request validation, Git adapters, planning workspaces, state transitions,
  publication/reconciliation, or diagnostic contracts change.
- **Reusable/risky behavior:** This is durable recovery and remote Git safety at
  the human review boundary; interruption, destructive cleanup, and public
  blocked-result behavior justify maintained unit and real-Git coverage.

Do not add tests for plan/spec prose, workflow version literals, dependency
versions, static file presence, or unchanged approval-label policy. Verify those
through focused diff inspection, lint, type checks, architecture checks, and the
conditional dependency/Nix command.

---

### Task 1: Separate Stable Pull Request Identity From Exact Head Validation

**Files:**

- Modify: `src/workflow/planning-pull-request-validation.ts:1-126`
- Modify: `src/workflow/planning-pull-request-validation.test.ts`

**Interfaces:**

- Consumes: the existing planning publication identity, host summary, ownership
  marker parser, canonical URL parser, and optional expected reference.
- Produces: new `validatePlanningPullRequestIdentity()` for stable identity and
  the unchanged `validatePlanningPullRequestSummary()` exact-head API. Both
  return `ValidatedPlanningPullRequest`; only the exact API emits `head-oid`.

- [ ] **Step 1: Write the failing stable-versus-exact head test**

  Extend the validator fixture with a summary whose only mutation is
  `headSha: "b".repeat(40)`. Assert stable validation returns canonical
  reference `#188`, while exact validation still throws the existing reason:

  ```ts
  const revised = { ...summary, headSha: "b".repeat(40) };
  assert.equal(
    validatePlanningPullRequestIdentity({
      summary: revised,
      issueNumber: 188,
      phase: "spec",
      publication,
    }).reference.number,
    188,
  );
  assert.throws(
    () =>
      validatePlanningPullRequestSummary({
        summary: revised,
        issueNumber: 188,
        phase: "spec",
        publication,
      }),
    (error: unknown) =>
      error instanceof PlanningPullRequestValidationError &&
      error.reason === "head-oid",
  );
  ```

- [ ] **Step 2: Write the failing stable-identity rejection matrix**

  Reuse the current repository, base/head branch, marker, URL, expected
  reference, malformed body, and merged server-ref cases. For each non-head
  mutation, call `validatePlanningPullRequestIdentity()` and assert the same
  reason as the exact validator. Include target repository, head repository,
  base branch, invalid open head branch, substituted/misnumbered merged pull
  ref, ownership marker, canonical URL, reference, and malformed-summary. Assert
  no confidential body sentinel appears in the thrown error.

- [ ] **Step 3: Run the focused validator test and verify the red state**

  Run:

  ```sh
  node --test src/workflow/planning-pull-request-validation.test.ts
  ```

  Expected before implementation: FAIL because
  `validatePlanningPullRequestIdentity` is not exported.

- [ ] **Step 4: Extract one shared validator with an explicit head policy**

  Add a private input type and implementation such as:

  ```ts
  type PlanningPullRequestValidationInput = {
    summary: PullRequestSummary;
    issueNumber: number;
    phase: PlanningPhaseKind;
    publication: PlanningPublicationEvidence;
    expectedReference?: PullRequestReference;
  };

  function validatePlanningPullRequest(
    input: PlanningPullRequestValidationInput,
    requireExactHead: boolean,
  ): ValidatedPlanningPullRequest {
    // Preserve the existing validation order and error normalization.
    if (requireExactHead && summary.headSha !== publication.headOid)
      fail("head-oid");
  }
  ```

  Export `validatePlanningPullRequestIdentity(input)` with
  `requireExactHead === false`, and keep
  `validatePlanningPullRequestSummary(input)` as the exact wrapper with
  `requireExactHead === true`. Do not remove `head-oid` from the reason union or
  weaken the merged/closed server pull-ref exception.

- [ ] **Step 5: Run validator and publication-repository tests**

  Run:

  ```sh
  node --test \
    src/workflow/planning-pull-request-validation.test.ts \
    src/workflow/planning-publication-repositories.test.ts
  ```

  Expected: PASS. Stable validation accepts only the revised head; exact callers
  and every unrelated identity/error boundary remain unchanged.

- [ ] **Step 6: Commit the validation split**

  ```sh
  git add \
    src/workflow/planning-pull-request-validation.ts \
    src/workflow/planning-pull-request-validation.test.ts
  git commit -m "refactor(run-once): separate planning pull request identity"
  ```

---

### Task 2: Prove and Reconcile a Safe Planning Head With Git

**Files:**

- Create: `src/git/planning-head-adoption-git.ts`
- Create: `src/git/planning-head-adoption-git.test.ts`
- Create: `src/git/planning-head-adoption-git.real.test.ts`
- Modify: `src/git/planning-workspaces.ts:1-185`
- Modify: `src/git/planning-workspace-git.ts:1-176`

**Interfaces:**

- Consumes: `PlanningWorkspaceRepositoryGit` inspection/command boundaries, the
  saved `PlanningWorkspaceOwnership`, saved artifact paths, and the host head
  SHA from Task 1's identity-validated summary.
- Produces: the `PlanningHeadAdoption*` contracts from **Shared Interfaces** and
  `PlanningWorkspaceLifecycle.adoptPlanningHead()`. The adapter never writes
  durable state or calls the host.

- [ ] **Step 1: Write command-level unsafe-evidence tests**

  In `planning-head-adoption-git.test.ts`, use a scripted `CommandRunner` and a
  saved `ready` workspace. Add a table that proves these exact typed outcomes:

  ```ts
  const failures = [
    ["remote-missing", undefined],
    ["head-disagreement", remoteOid],
    ["not-descendant", candidateOid],
    ["unexpected-paths", candidateOid],
    ["non-regular-artifact", candidateOid],
  ] as const;
  ```

  Assert each result includes the recorded/host/fetched/remote OIDs that were
  actually observed, the complete saved artifact path list, cleanup state, and
  unexpected paths only for the diff failure. Assert no worktree `merge` or
  local `update-ref` command runs for any failed remote proof.

- [ ] **Step 2: Write fetch, ancestry, diff, and tree command assertions**

  For a safe candidate, assert the adapter runs the equivalent bounded proof in
  this order:

  ```sh
  git ls-remote --exit-code --heads -- <remote> refs/heads/<saved-branch>
  git fetch --no-tags --force -- <remote> \
    refs/heads/<saved-branch>:refs/patchmill/planning-head-adoption/<run-id>/<phase>
  git rev-parse --verify <evidence-ref>^{commit}
  git ls-remote --exit-code --heads -- <remote> refs/heads/<saved-branch>
  git merge-base --is-ancestor <recorded> <candidate>
  git diff --name-only --no-renames -z <recorded> <candidate> --
  git ls-tree -z <candidate> -- <artifact-path>
  ```

  The exact internal ref may include the Issue number in addition to the saved
  Run ID and phase, but must be validated and collision-free for the active
  phase. Assert the diff parser requires complete NUL-delimited output, rejects
  every path not in the saved set, and accepts zero changed paths for an empty
  descendant commit. Assert `ls-tree` accepts only modes `100644` and `100755`
  with one exact saved path.

- [ ] **Step 3: Write local cleanup-state reconciliation tests**

  Cover every cleanup discriminator:
  - `ready` and `cleanup-pending`: a clean worktree at the recorded head, exact
    candidate, or proved intermediate head advances with `merge --ff-only`; an
    ignored path remains untouched.
  - `worktree-removed`: a `branch-only` ref on the proved chain advances with
    `git update-ref refs/heads/<branch> <candidate> <observed>`; an already
    missing branch is accepted without recreation.
  - `removed`: no local inspection or mutation runs.

  For `ready`, `cleanup-pending`, and `worktree-removed`, add dirty, divergent,
  wrong-owner, wrong-registration, and off-chain cases. Assert they throw the
  existing `PlanningWorkspaceConflictError` path and never invoke reset, clean,
  force, branch deletion, or remote mutation.

- [ ] **Step 4: Write final-observation and hard-error tests**

  Script a different present remote OID only for the final `ls-remote` call.
  Assert the local fast-forward may already have occurred, but the result is
  `kind: "blocked"`, `failure: "head-moved"`, and reports the new remote OID.
  Script a missing final branch and assert `remote-missing`.

  For invalid OIDs/paths, fetch/merge/diff/tree command failures, malformed
  `ls-remote`, `rev-parse`, diff, and tree output, and an untyped runner error,
  assert rejection with the original typed infrastructure/response error. None
  may become `PlanningHeadAdoptionBlockedEvidence`.

- [ ] **Step 5: Write the real-Git adapter regression**

  In `planning-head-adoption-git.real.test.ts`, create a repository, bare
  remote, owned planning worktree, and second checkout. Push an artifact-only
  descendant from the second checkout and assert:

  ```ts
  assert.deepEqual(await workspaces.adoptPlanningHead(input), {
    kind: "adopted",
    headOid: revisedOid,
  });
  assert.equal(git(worktreePath, "rev-parse", "HEAD"), revisedOid);
  ```

  Repeat from `cleanup-pending` with ignored content and assert the ignored file
  still exists. Remove the worktree and prove branch-only CAS advancement, then
  remove the branch and prove `removed` does not recreate it. In isolated cases,
  force-push a non-descendant, push a descendant changing `README.md`, delete an
  artifact, replace it with a symlink, and create a gitlink; assert typed
  blockers and no local mutation.

- [ ] **Step 6: Run focused Git tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/git/planning-head-adoption-git.test.ts \
    src/git/planning-head-adoption-git.real.test.ts
  ```

  Expected before implementation: FAIL because the focused adapter and workspace
  lifecycle method do not exist.

- [ ] **Step 7: Implement the focused adapter and workspace facade method**

  Add the shared types and lifecycle method in `planning-workspaces.ts`. In
  `PlanningWorkspaceGit`, instantiate `PlanningHeadAdoptionGit` with the
  existing `PlanningWorkspaceRepositoryGit` and delegate `adoptPlanningHead()`.

  In the focused adapter:
  1. Validate saved run/phase/workspace ownership and all OIDs, branch, remote,
     internal-ref, and artifact path inputs before mutation.
  2. Observe, fetch, pin, and re-observe the exact saved remote branch.
  3. Return `remote-missing` or `head-disagreement` for stable unsafe evidence;
     throw for command/malformed-response failures.
  4. Classify exit code `1` only from `merge-base --is-ancestor` as
     `not-descendant`.
  5. Parse `diff --name-only --no-renames -z` and return all non-artifact paths
     as sorted `unexpectedPaths`.
  6. Verify every saved artifact as one regular blob at the candidate.
  7. Reconcile the local checkpoint according to cleanup state and verify its
     resulting head when a local ref survives.
  8. Observe the remote once more; return `head-moved` for a different present
     OID and `remote-missing` for disappearance.
  9. Return `{ kind: "adopted", headOid: candidateOid }` only after every check.

  Extend `PlanningWorkspaceOperation` with specific adoption operations instead
  of reporting a fetch/diff/fast-forward failure as an unrelated cleanup
  command. Keep raw command diagnostics non-enumerable through the existing
  error pattern.

- [ ] **Step 8: Run focused Git tests**

  Run:

  ```sh
  node --test \
    src/git/planning-head-adoption-git.test.ts \
    src/git/planning-head-adoption-git.real.test.ts \
    src/git/planning-workspace-git.test.ts
  ```

  Expected: PASS. Safe descendants advance the allowed local checkpoint, unsafe
  evidence is typed without mutation, infrastructure errors propagate, and
  ignored content survives.

- [ ] **Step 9: Commit the Git adoption boundary**

  ```sh
  git add \
    src/git/planning-head-adoption-git.ts \
    src/git/planning-head-adoption-git.test.ts \
    src/git/planning-head-adoption-git.real.test.ts \
    src/git/planning-workspaces.ts \
    src/git/planning-workspace-git.ts
  git commit -m "feat(run-once): prove safe planning head revisions"
  ```

---

### Task 3: Atomically Checkpoint the Adopted Planning Head

**Files:**

- Create: `src/cli/commands/run-once/planning-head-adoption.ts`
- Create: `src/cli/commands/run-once/planning-head-adoption.test.ts`
- Modify: `src/workflow/planning-state-transitions.ts:1-330`
- Modify: `src/workflow/planning-state.test.ts`
- Modify: `src/workflow/planning-state-publication-regressions.test.ts`

**Interfaces:**

- Consumes: Task 1's `ValidatedPlanningPullRequest`, Task 2's
  `adoptPlanningHead()`, the current branch-pushed/open phase, and
  `replacePlanningPhase()`.
- Produces: `PlanningHeadAdoptionBlockedOutcome`,
  `PlanningPullRequestHeadOutcome`, and `adoptPlanningPullRequestHead()` from
  **Shared Interfaces**, plus one narrow state replacement edge for coordinated
  nonterminal head advancement.

- [ ] **Step 1: Write coordinated state-transition acceptance tests**

  Build one valid `pull-request-open` phase for each cleanup state: `ready`,
  `cleanup-pending`, `worktree-removed`, and `removed`. For candidate OID
  `oid("c")`, update publication/workspace/artifact and pushed cleanup OIDs as
  specified in **Shared Interfaces**, increment revision once, and assert
  `assertPlanningStateReplacement()` accepts each replacement.

  Add a `branch-pushed` to `pull-request-open` case that adds canonical pull
  request evidence and advances all head-dependent OIDs in that same revision.
  Assert an existing serialized `planning-pr-v1` state still parses unchanged.

- [ ] **Step 2: Write partial and unsafe state-transition rejection tests**

  Starting from each accepted case, independently leave stale or alter:
  - `publication.headOid`;
  - `workspace.headOid`;
  - one artifact `commitOid` or `source`;
  - `cleanup.pushedHeadOid` when present;
  - artifact kind or path;
  - workspace/base/pull request identity; or
  - cleanup discriminator.

  Assert each replacement throws `PlanningStateValidationError`. Also reject a
  head rewrite on `workspace-ready`, `complete-remote-base`, `complete-merged`,
  and every implementation phase. Reject a coordinated head change combined with
  cleanup progress; adoption and cleanup remain separate durable edges.

- [ ] **Step 3: Write the adoption coordinator tests**

  In `planning-head-adoption.test.ts`, cover:
  1. Exact `branch-pushed`: no Git adoption call, one replacement adds pull
     request evidence, and `adopted === false`.
  2. Exact `pull-request-open`: no Git or state write and the original state is
     returned.
  3. Revised head: the Git method receives saved issue/run/phase/workspace, host
     SHA, and every artifact path; one replacement updates all coordinated
     evidence and reports `adopted === true`.
  4. Typed unsafe result: return `head-adoption-blocked` with the canonical URL
     and exact evidence, with no state write.
  5. Git infrastructure error and state-store conflict: reject unchanged rather
     than returning blocked.

- [ ] **Step 4: Write interruption and retry tests**

  Make `adoptPlanningHead()` report success, then fail the first state-store
  replacement. Assert the coordinator rejects and did not expose an adopted
  durable state. Retry from the original state with the local adapter now
  reporting the candidate as already present; assert the same proof completes
  one replacement. Repeat from `worktree-removed` with an already advanced
  branch and from `removed` with no local branch.

- [ ] **Step 5: Run state and coordinator tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/workflow/planning-state.test.ts \
    src/workflow/planning-state-publication-regressions.test.ts \
    src/cli/commands/run-once/planning-head-adoption.test.ts
  ```

  Expected before implementation: FAIL because published head evidence is
  immutable and the coordinator module does not exist.

- [ ] **Step 6: Implement the narrow coordinated replacement invariant**

  In `planning-state-transitions.ts`, detect a head advance only when current
  and next are spec/plan publication phases on an allowed edge. Compare stable
  workspace fields separately from head-dependent fields. Require:

  ```ts
  const candidate = next.publication.headOid;
  next.workspace.headOid === candidate;
  next.artifacts.every(
    (artifact) =>
      artifact.source === "workspace" && artifact.commitOid === candidate,
  );
  next.workspace.cleanup.state === "ready" ||
    next.workspace.cleanup.state === "cleanup-pending" ||
    next.workspace.cleanup.pushedHeadOid === candidate;
  ```

  Preserve artifact kind/path order, publication repository/base/head branch,
  base evidence, workspace ownership/identity, pull request evidence, and
  cleanup state. Keep existing non-adoption transition behavior byte-for-byte.
  Do not add a workflow version or state field.

- [ ] **Step 7: Implement the focused adoption coordinator**

  Validate phase index/type/status before effects. For exact heads, checkpoint
  only a missing branch-pushed pull request identity. For changed heads, call
  Task 2's adapter and return its typed blocker without replacement, or build
  the complete `PullRequestOpenPlanningPhase` from **Shared Interfaces** and
  call `replacePlanningPhase()` exactly once. Return the state read back from
  the store, not a speculative local object.

  Add small exported constructors for these non-Git observations so publisher,
  reconciler, and cleanup use the same evidence shape:

  ```ts
  export function planningHeadObservationBlocked(input: {
    phase: BranchPushedPlanningPhase | PullRequestOpenPlanningPhase;
    failure: "remote-missing" | "head-disagreement" | "head-moved";
    hostHeadOid?: string;
    remoteHeadOid?: string;
    pullRequestUrl?: string;
  }): PlanningHeadAdoptionBlockedOutcome;
  ```

  The constructor copies recorded head, artifact paths, and cleanup state from
  the durable phase. It never fabricates fetched evidence.

- [ ] **Step 8: Run state and coordinator tests**

  Run:

  ```sh
  node --test \
    src/workflow/planning-state.test.ts \
    src/workflow/planning-state-publication-regressions.test.ts \
    src/workflow/planning-state-cleanup-pending.test.ts \
    src/cli/commands/run-once/planning-head-adoption.test.ts
  ```

  Expected: PASS. Every coordinated edge is accepted, every partial or terminal
  rewrite is rejected, and interrupted local-before-durable adoption is
  repeatable.

- [ ] **Step 9: Commit atomic adoption state handling**

  ```sh
  git add \
    src/cli/commands/run-once/planning-head-adoption.ts \
    src/cli/commands/run-once/planning-head-adoption.test.ts \
    src/workflow/planning-state-transitions.ts \
    src/workflow/planning-state.test.ts \
    src/workflow/planning-state-publication-regressions.test.ts
  git commit -m "feat(run-once): checkpoint adopted planning heads"
  ```

---

### Task 4: Share Head Adoption Across Publication and Reconciliation

**Files:**

- Modify: `src/cli/commands/run-once/planning-phase-cleanup.ts:1-91`
- Modify: `src/cli/commands/run-once/planning-phase-cleanup.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.ts:1-242`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.ts:1-284`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.test.ts`
- Create: `src/cli/commands/run-once/planning-head-adoption.real.test.ts`

**Interfaces:**

- Consumes: Task 1's stable validator, Task 3's shared coordinator/blocker, the
  existing host discovery/read-back API, cleanup checkpoints, merge recovery,
  and merged-base proof.
- Produces: `head-adoption-blocked` members in `PlanningPhasePublicationResult`
  and `PlanningPhaseReconciliation`. Successful open adoption reaches the
  existing `review-pending` path; successful merged adoption reaches the
  existing `merged` path only after all current base proof.

- [ ] **Step 1: Write the typed cleanup remote-change test**

  Change the cleanup callback test double to return `PlanningRemoteHead` rather
  than throwing. For `ready` and `cleanup-pending`, return a different present
  OID and then a missing branch. Assert `finishPlanningPhaseCleanup()` returns:

  ```ts
  {
    kind: "remote-head-changed",
    phase,
    remoteHead: { state: "present", headOid: movedOid },
  }
  ```

  and the corresponding missing shape. Assert no worktree removal or checkpoint
  runs. Retain existing worktree/branch cleanup ordering for an exact remote
  head and for already `worktree-removed`/`removed` phases.

- [ ] **Step 2: Write publisher tests for supervised branch-pushed adoption**

  Replace the current test that expects discovery to be skipped after a remote
  change. For one changed remote head and one matching pull request:
  - exhaustive discovery runs;
  - stable validation and read-back run before adoption;
  - `createPullRequest()` does not run;
  - the adoption coordinator checkpoints pull request identity and revised OIDs
    together; and
  - publication resumes cleanup and returns `published` for an open pull
    request.

  For zero matching pull requests with a changed or missing remote branch,
  assert `kind: "head-adoption-blocked"`, no create/adoption/local cleanup/state
  write, and evidence classification `head-disagreement` or `remote-missing`.
  Keep zero-match exact-remote creation and multiple-match ambiguity unchanged.

- [ ] **Step 3: Write publisher tests for already-open revisions and races**

  Starting from `pull-request-open`, make host `headSha` an artifact-only
  descendant and assert adoption runs before cleanup. Cover `ready`,
  `cleanup-pending`, `worktree-removed`, and `removed` durable states through
  the shared coordinator fixture. After a successful adoption, make the cleanup
  remote check observe another OID and assert the publisher returns
  `head-adoption-blocked` with `failure: "head-moved"` rather than throwing
  `Planning remote head changed`.

  Add a second host revision after cleanup but before the publisher's final
  read-back. Assert the shared coordinator safely adopts it from `removed` and
  the returned state contains the second candidate across publication,
  workspace, artifacts, and cleanup.

- [ ] **Step 4: Write reconciler tests for revised open and merged pull
      requests**

  Extend the fixture with `adoptPlanningHead()`. Add these failing cases:
  - Revised open artifact-only fast-forward: adoption checkpoint precedes
    cleanup, and the result is `review-pending` at the candidate.
  - Revised merged pull request: adoption and cleanup precede the existing base
    fetch, merge ancestry/recovery, and regular-file proof; final artifacts
    point to `mergedBaseOid`, while publication/workspace/cleanup retain the
    adopted branch head.
  - Repeated revision: a later candidate descends from the first adopted head
    and is adopted on the next Run attempt.
  - `branch-pushed` unique discovery: stable read-back plus head adoption and
    pull request identity persist in one replacement.
  - Unsafe Git proof and cleanup race: return `head-adoption-blocked` without
    cleanup or merge completion.
  - Interruption after the adoption checkpoint, worktree removal, the
    worktree-removed checkpoint, branch removal, and the removed checkpoint:
    preserve the last durable edge and resume without repeating an unsafe local
    effect or reverting the adopted OID.

  Keep current `merge-recovery-blocked`, closed-unmerged, missing, ambiguous,
  cleanup-pending, and normal merged event-order assertions.

- [ ] **Step 5: Write hard-boundary integration tests**

  In both publisher and reconciler suites, mutate each stable identity field and
  assert `PlanningPullRequestValidationError` is thrown before
  `adoptPlanningHead()`. Add command, transport, malformed response,
  `PlanningWorkspaceConflictError`, and state-store failure objects and assert
  they reject by object identity. A typed Git unsafe result is the only path to
  `head-adoption-blocked`.

  For branch-pushed discovery, retain `IncompletePullRequestSearchError` as a
  hard host failure and require exactly one read-back reference before adoption.

- [ ] **Step 6: Write the end-to-end real-Git regression before integration**

  In `planning-head-adoption.real.test.ts`, create a repository, bare remote,
  planning worktree, and human checkout. Publish the original planning head,
  build a pull request fixture at that head, then push an artifact-only
  descendant from the human checkout and report it from the host fixture.

  Reconcile while the pull request is open and assert:

  ```ts
  assert.equal(result.outcome.kind, "review-pending");
  assert.equal(result.state.phases[0]!.publication.headOid, revisedOid);
  assert.equal(result.state.phases[0]!.workspace.headOid, revisedOid);
  assert.ok(
    result.state.phases[0]!.artifacts.every(
      (artifact) => artifact.commitOid === revisedOid,
    ),
  );
  ```

  Model merge to the saved base, return a merged host summary at the same
  revised head, and assert completion still anchors artifact evidence to the
  freshly fetched base. Add isolated force-pushed non-descendant and descendant
  `README.md` changes; assert state bytes are unchanged and the typed blocker is
  returned. Inject a store failure after local fast-forward, retry from original
  durable state, and assert the missing checkpoint is repaired without reset or
  force. Before a second retry, push another artifact-only descendant and prove
  the already-advanced local head is accepted as an intermediate on the
  recorded-to-latest chain; repeat with an unsafe second advance and assert it
  blocks rather than overwriting local or durable evidence.

- [ ] **Step 7: Run integration tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-phase-cleanup.test.ts \
    src/cli/commands/run-once/planning-phase-publisher.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-head-adoption.real.test.ts
  ```

  Expected before implementation: FAIL because publisher/reconciler still call
  exact validation, cleanup still throws generic remote-head errors, and no
  integration path invokes the adoption coordinator.

- [ ] **Step 8: Implement typed cleanup precondition handling**

  Change `remoteHead` to return `Promise<PlanningRemoteHead>`. Inside
  `finishPlanningPhaseCleanup()`, compare that observation with
  `phase.publication.headOid` immediately before worktree removal. Return
  `remote-head-changed` with the untouched phase and observation on mismatch; do
  not checkpoint or mutate local state. Publisher and reconciler translate
  present mismatch to `head-moved` and absence to `remote-missing` through Task
  3's shared constructor.

- [ ] **Step 9: Integrate stable validation and adoption in the publisher**

  In `branch-pushed`, inspect the remote and perform exhaustive discovery before
  deciding whether creation is safe. Only create when the remote exactly equals
  the recorded head and no pull request exists. For one discovered or newly
  created pull request, stable-validate the first summary, read it back by the
  canonical reference, stable-validate with `expectedReference`, and call
  `adoptPlanningPullRequestHead()`.

  For `pull-request-open`, stable-validate each host read and call the same
  coordinator before cleanup or return. Replace every bare
  `Planning remote head changed` branch with a typed result. Propagate hard
  validation, host, Git, workspace, and store failures.

- [ ] **Step 10: Integrate stable validation and adoption in the reconciler**

  For `branch-pushed`, preserve zero/multiple/one discovery classification. On
  zero matches, inspect the remote: return ordinary `missing` only when it still
  equals the recorded head; otherwise return the typed unsupervised-head
  blocker. For one match, stable-validate discovery and read-back, then let the
  coordinator atomically add pull request identity and adopt if needed.

  For an existing open phase, stable-validate the host summary and call the
  coordinator before cleanup. Refresh local `state` and `phase` from its ready
  result. After adoption, leave the existing open/closed/merged classification,
  merge-recovery module, fetched-base checks, and completion replacement
  unchanged.

- [ ] **Step 11: Run integration and adjacent regression tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-head-adoption.test.ts \
    src/cli/commands/run-once/planning-phase-cleanup.test.ts \
    src/cli/commands/run-once/planning-phase-publisher.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts \
    src/cli/commands/run-once/planning-head-adoption.real.test.ts
  ```

  Expected: PASS. Revised open and merged pull requests recover, interruption is
  idempotent, cleanup races are typed, and all unrelated identity and
  infrastructure failures remain hard.

- [ ] **Step 12: Commit publication and reconciliation integration**

  ```sh
  git add \
    src/cli/commands/run-once/planning-phase-cleanup.ts \
    src/cli/commands/run-once/planning-phase-cleanup.test.ts \
    src/cli/commands/run-once/planning-phase-publisher.ts \
    src/cli/commands/run-once/planning-phase-publisher.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.ts \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-head-adoption.real.test.ts
  git commit -m "fix(run-once): re-adopt revised planning pull requests"
  ```

---

### Task 5: Return an Actionable Nonfatal Head-Adoption Blocker

**Files:**

- Modify: `src/cli/commands/run-once/planning-phase-runner-planning.ts:1-253`
- Modify: `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-types.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-helpers.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-planning.ts`
- Modify: `src/cli/commands/run-once/result-diagnostics.test.ts`

**Interfaces:**

- Consumes: Task 4's identical publisher/reconciler `head-adoption-blocked`
  evidence and the existing `blocked()`/ `runOnceFailure()` boundary.
- Produces: stable reason `planning-head-adoption-blocked`, the context from
  **Shared Interfaces**, complete diagnostic details, safe operator guidance,
  `after-action` for stable evidence, and `retry-now` only for `head-moved`.

- [ ] **Step 1: Add the exhaustive diagnostic context fixture first**

  Add `planning-head-adoption-blocked` to `RUN_ONCE_REASON_CODES`,
  `PlanningDiagnosticReasonCode`, and `RunOnceDiagnosticContextByReason`. Add
  labels for `recordedHeadOid`, `hostHeadOid`, `fetchedHeadOid`,
  `remoteHeadOid`, `adoptionFailure`, `artifactPaths`, `unexpectedPaths`, and
  `cleanupState`.

  Add this representative exhaustive fixture:

  ```ts
  "planning-head-adoption-blocked": {
    issueNumber: 252,
    status: "blocked",
    phase: "spec",
    pullRequestUrl: "https://example.test/pulls/248",
    recordedHeadOid: "a".repeat(40),
    hostHeadOid: "b".repeat(40),
    fetchedHeadOid: "b".repeat(40),
    remoteHeadOid: "b".repeat(40),
    adoptionFailure: "unexpected-paths",
    artifactPaths: ["docs/specs/issue-252.md"],
    unexpectedPaths: ["src/unsafe.ts"],
    cleanupState: "removed",
  },
  ```

- [ ] **Step 2: Write diagnostic policy tests**

  For each stable failure (`remote-missing`, `head-disagreement`,
  `not-descendant`, `unexpected-paths`, `non-regular-artifact`), assert:
  - summary identifies blocked planning head adoption;
  - details preserve every available OID/path and omit unavailable observations;
  - action command is `patchmill run-once --issue 252`;
  - action tells the operator to preserve/reapply the revision on the saved
    branch as a fast-forward descendant with net changes limited to saved
    artifact paths and to repair host/remote agreement;
  - safety warns against editing planning state, force-restoring the obsolete
    head, or discarding revised artifacts; and
  - retry kind is `after-action`.

  For `head-moved`, assert the same safe context but
  `retry.kind === "retry-now"` and guidance says the bounded observation raced,
  so a new Run attempt may evaluate the latest head.

- [ ] **Step 3: Write phase-runner mapping tests for both callers**

  Stub reconciliation with `head-adoption-blocked` and assert the runner returns
  `kind: "blocked"`, stable reason `planning-head-adoption-blocked`, unchanged
  durable state, empty questions/commits/validation, and every diagnostic field.

  Stub publication with the same outcome and assert identical public failure
  mapping before any attempt to classify the pull request as review-pending.
  Include a branch-pushed blocker without `pullRequestUrl`/host/fetched OIDs and
  assert optional fields stay absent rather than becoming placeholder strings.

- [ ] **Step 4: Run runner and diagnostic tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected before implementation: FAIL because the stable reason and mapping do
  not exist and publisher blockers are not handled by the runner.

- [ ] **Step 5: Implement one shared runner mapping helper**

  Add a private function in `planning-phase-runner-planning.ts` that accepts
  state, phase, and `PlanningHeadAdoptionBlockedOutcome`, then returns:

  ```ts
  {
    kind: "blocked",
    state,
    result: blocked(
      "planning-head-adoption-blocked",
      runOnceFailure("planning-head-adoption-blocked", {
        issueNumber: state.issueNumber,
        status: "blocked",
        phase,
        ...(outcome.pullRequestUrl === undefined
          ? {}
          : { pullRequestUrl: outcome.pullRequestUrl }),
        recordedHeadOid: outcome.evidence.recordedHeadOid,
        ...(outcome.evidence.hostHeadOid === undefined
          ? {}
          : { hostHeadOid: outcome.evidence.hostHeadOid }),
        ...(outcome.evidence.fetchedHeadOid === undefined
          ? {}
          : { fetchedHeadOid: outcome.evidence.fetchedHeadOid }),
        ...(outcome.evidence.remoteHeadOid === undefined
          ? {}
          : { remoteHeadOid: outcome.evidence.remoteHeadOid }),
        adoptionFailure: outcome.evidence.failure,
        artifactPaths: outcome.evidence.artifactPaths,
        ...(outcome.evidence.unexpectedPaths.length === 0
          ? {}
          : { unexpectedPaths: outcome.evidence.unexpectedPaths }),
        cleanupState: outcome.evidence.cleanupState,
      }),
    ),
  };
  ```

  Use it in both the reconciliation switch and the publication result branch. Do
  not map thrown errors through this helper.

- [ ] **Step 6: Implement the diagnostic catalog entry and dynamic retry**

  Add a custom catalog definition rather than weakening the generic static
  `definition()` helper. Use `contextDetails()` and `issueCommand()` for safe
  details/actions. Set policy text equivalent to:

  ```ts
  summary: "Planning head revision could not be adopted safely";
  explanation: "The planning pull request head changed, but Patchmill could not prove one fast-forward, artifact-only revision with agreeing host and remote evidence.";
  action: "Preserve or reapply the revision on the saved planning branch so it is a fast-forward descendant of the recorded head, its net changes are limited to the reported artifact paths, and host and remote heads agree; then rerun the Issue.";
  safety: "Do not hand-edit planning state, force-restore the obsolete head, or discard revised artifacts.";
  ```

  Return `retry-now` only when `context.adoptionFailure === "head-moved"`;
  otherwise return `after-action`. Keep all untrusted branch/path/OID/URL text
  in details, never interpolated into a command.

- [ ] **Step 7: Run runner, diagnostics, and result-output tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts \
    src/cli/commands/run-once/result-output.test.ts \
    src/cli/commands/run-once/terminal-diagnostics.test.ts
  ```

  Expected: PASS. Unsafe adoption is a structured nonfatal blocker with complete
  recovery evidence; head races invite a bounded retry; stable unsafe evidence
  requires operator action.

- [ ] **Step 8: Commit public blocked-result behavior**

  ```sh
  git add \
    src/cli/commands/run-once/planning-phase-runner-planning.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/result-diagnostic-types.ts \
    src/cli/commands/run-once/result-diagnostic-helpers.ts \
    src/cli/commands/run-once/result-diagnostic-planning.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  git commit -m "feat(run-once): explain blocked planning head adoption"
  ```

---

### Task 6: Run Full Regression and Scope Verification

**Files:**

- Verify: `src/workflow/planning-pull-request-validation.ts`
- Verify: `src/git/planning-head-adoption-git.ts`
- Verify: `src/git/planning-workspaces.ts`
- Verify: `src/git/planning-workspace-git.ts`
- Verify: `src/workflow/planning-state-transitions.ts`
- Verify: `src/cli/commands/run-once/planning-head-adoption.ts`
- Verify: `src/cli/commands/run-once/planning-phase-cleanup.ts`
- Verify: `src/cli/commands/run-once/planning-phase-publisher.ts`
- Verify: `src/cli/commands/run-once/planning-phase-reconciler.ts`
- Verify: `src/cli/commands/run-once/planning-phase-runner-planning.ts`
- Verify: `src/cli/commands/run-once/result-diagnostic-types.ts`
- Verify: `src/cli/commands/run-once/result-diagnostic-helpers.ts`
- Verify: `src/cli/commands/run-once/result-diagnostic-planning.ts`
- Verify: focused unit and real-Git tests from Tasks 1-5
- Verify unchanged: workflow/state version, implementation pull request head
  validation, approval-label policy, merged-base authority, dependencies, and
  unrelated Git/host/state error behavior

**Interfaces:**

- Consumes: Tasks 1-5's commits and the implementation-carried spec/plan.
- Produces: fresh focused, Run-once, repository, lint, build, type,
  architecture, dependency/Nix-condition, and final-scope evidence. This task
  creates no validation-only commit when no tracked file changes.

- [ ] **Step 1: Run the focused issue regression command**

  Run exactly:

  ```sh
  node --test \
    src/workflow/planning-pull-request-validation.test.ts \
    src/workflow/planning-state.test.ts \
    src/workflow/planning-state-publication-regressions.test.ts \
    src/git/planning-head-adoption-git.test.ts \
    src/git/planning-head-adoption-git.real.test.ts \
    src/git/planning-workspace-git.test.ts \
    src/cli/commands/run-once/planning-head-adoption.test.ts \
    src/cli/commands/run-once/planning-phase-cleanup.test.ts \
    src/cli/commands/run-once/planning-phase-publisher.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.test.ts \
    src/cli/commands/run-once/planning-phase-reconciler.real.test.ts \
    src/cli/commands/run-once/planning-head-adoption.real.test.ts \
    src/cli/commands/run-once/planning-phase-runner.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected: PASS with no failed, cancelled, or skipped issue-specific tests.

- [ ] **Step 2: Run the complete Run-once workflow suite**

  Run:

  ```sh
  npm run test:run-once
  ```

  Expected: PASS. Normal planning publication/cleanup, open review waits,
  merged-base completion, merge-history recovery, implementation handling,
  diagnostics, and unrelated Run-once behavior remain green.

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

  Expected for this issue: the explicit skip message. If npm dependency metadata
  changed and remains necessary, `nix build` must run and exit `0` before
  completion.

- [ ] **Step 5: Review final scope and safety invariants**

  Run:

  ```sh
  git status --short
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- \
    src/workflow/planning-pull-request-validation.ts \
    src/git/planning-head-adoption-git.ts \
    src/git/planning-workspaces.ts \
    src/git/planning-workspace-git.ts \
    src/workflow/planning-state-transitions.ts \
    src/cli/commands/run-once/planning-head-adoption.ts \
    src/cli/commands/run-once/planning-phase-cleanup.ts \
    src/cli/commands/run-once/planning-phase-publisher.ts \
    src/cli/commands/run-once/planning-phase-reconciler.ts \
    src/cli/commands/run-once/planning-phase-runner-planning.ts \
    src/cli/commands/run-once/result-diagnostic-types.ts \
    src/cli/commands/run-once/result-diagnostic-planning.ts
  git diff --quiet origin/main...HEAD -- \
    src/workflow/planning-state-types.ts \
    src/workflow/planning-state-validation.ts \
    package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: the quiet diff command exits `0`; the worktree is clean; the carried
  spec and plan plus scoped source/tests are present; state shape/version and
  dependencies are unchanged. Confirm from the final diff that stable identity
  is always checked before adoption, only a host/remote-agreeing artifact-only
  fast-forward can advance, no unsafe proof mutates durable state, every durable
  head field advances together, cleanup cannot act after a race, open revisions
  remain behind merge review, merged revisions still require authoritative base
  evidence, and implementation pull request validation remains exact.

- [ ] **Step 6: Record verification evidence without a new commit**

  Update the Task 6 Issue todo body with each exact command and outcome, any
  residual risk, and whether the conditional Nix build ran. Set that todo to the
  configured terminal status. Do not amend implementation commits or create a
  validation-only commit when verification changes no tracked file.

---

## Self-Review Notes

- **Spec coverage:** Task 1 separates stable identity from exact head equality
  without weakening any identity reason. Task 2 owns exact branch fetch,
  host/remote agreement, fast-forward, net-path, regular-file, local checkpoint,
  and final-observation proof. Task 3 owns the one coordinated durable edge and
  interruption-safe replacement. Task 4 shares adoption across branch-pushed,
  open, and merged publication/reconciliation while retaining review, cleanup,
  merge, and merged-base boundaries. Task 5 exposes all unsafe classifications
  as one actionable nonfatal reason with the required retry split. Task 6 runs
  every final command from the spec and the repository-specific Nix condition.
- **Module boundaries:** Remote/local Git policy lives in one focused adapter;
  stable host identity stays in the workflow validator; durable shape rules stay
  in state transitions; adoption orchestration stays in one Run-once module;
  publisher/reconciler remain callers; and public policy remains in the
  diagnostic catalog. No generic helper bucket is introduced.
- **Type consistency:** `PlanningHeadAdoptionFailure`, blocked evidence OID/path
  fields, coordinator outcomes, publisher/reconciler union members, runner
  context, and diagnostic fixture use the same names and literal unions.
  Successful adoption always returns a `PullRequestOpenPlanningPhase`; merged
  completion remains the existing shape.
- **Testing Value Gate:** New tests cover the production deadlock, remote Git
  safety, local destructive boundaries, durable state atomicity, interruption
  repair, open/merged review semantics, hard-error classification, and public
  operator recovery. Static prose, version, dependency, and policy facts use
  direct verification instead of brittle tests.
- **Placeholder scan:** Every code-changing task names exact files, interfaces,
  red/green commands, expected behavior, implementation boundaries, and a
  Conventional Commit message. No implementation decision is deferred.
