# Issue 188 execute and publish planning pull request phases design

## Status

This specification awaits document review.

## Summary

Issue #188 is the publication slice of the `planning-pr-v1` workflow approved in
issue #180. Issues #184 through #187 provide the phase rules, pull request host
adapters, strict Run recovery state, issue lock, remote-base inspection, and
owned phase workspaces.

This change adds three focused services:

1. An artifact phase runner that invokes spec and plan agents in the supplied
   phase workspace and checkpoints each verified artifact commit.
2. A planning phase publisher that safely pushes one exact phase head, finds or
   creates its planning pull request, persists each observed remote effect, and
   completes checkpointed local cleanup.
3. A reconciler that classifies review-pending, merged, closed-unmerged,
   missing, and ambiguous remote states and verifies a merge against the saved
   base branch before completing the phase.

The services operate on one caller-selected phase while the caller owns the
issue #187 lock. This slice does not select an issue, acquire the top-level
lock, route the legacy run-once pipeline, or enforce the implementation pull
request.

## Goals

- Run spec and plan agents only inside the current phase workspace.
- Support a phase that creates both spec and plan, in that order.
- Reuse unambiguous artifacts found in the phase's pinned remote base.
- Validate every returned artifact path and commit before publication.
- Push only the exact saved phase head without force-updating remote work.
- Persist a checkpoint immediately after every observed remote mutation.
- Recover an interrupted push or pull request create without duplication.
- Adopt exactly one pull request with matching repositories, branches, head
  object ID, issue, phase, and ownership marker.
- Remove the local worktree and branch through the owned, idempotent issue #187
  cleanup operations after pull request identity is durable.
- Distinguish an open review, a verified merge, a closed-unmerged pull request,
  a proven missing pull request, and ambiguous discovery.
- Preserve human artifact edits by accepting merged-base contents rather than
  requiring the planning branch's original artifact blob.
- Leave phase state unchanged for host failures that do not prove absence.

## Non-goals

- Top-level run-once issue selection, planning state initialization, or issue
  lock acquisition and release.
- New lifecycle-label behavior or migration from approval labels and artifact
  comments.
- Implementation-agent execution, implementation pull request validation, or
  direct-landing policy.
- Replacing a closed-unmerged planning pull request.
- Automatic pull request merge, force-push, rebase, or remote branch deletion.
- Compatibility migration, configuration deprecations, or user documentation.
- Live GitHub or Forgejo mutations in automated tests.

## Existing constraints

This design retains the predecessor contracts:

- `planningPhasePlan()` determines the phase sequence from the immutable gate
  snapshot.
- `phaseWorkspaceIdentity()` supplies deterministic phase branches and paths.
- `PlanningRemoteBaseGit` fetches and pins the saved remote and base branch and
  returns all matching artifact candidates.
- `PlanningWorkspaceLifecycle` creates, resumes, and removes only a workspace
  proven to belong to the same Issue run and phase.
- `PullRequestHost` supplies normalized, exhaustive provider operations.
- `planningPullRequestTitle()`, `planningPullRequestBody()`, and the
  `planning-pr-v1` marker supply provider-neutral planning pull request text.
- `PlanningStateStore.replace()` performs strict, revision-checked, atomic state
  replacement only while the matching ownership-ID issue lock is held.

The issue #187 state is not yet connected to production. Issue #188 may refine
its version-1 phase variants before first use, but it must retain strict
parsing, immutable Run identity, atomic replacement, and the existing workspace
ownership rules.

## Approaches considered

### Focused runner, publisher, and reconciler (chosen)

Keep agent execution, remote mutation, and remote observation in separate
modules. The publisher owns mutation order, while the reconciler owns status
classification and merged-base proof. Both consume the same strict phase state.

This makes every interruption boundary independently testable and prevents
provider or Git details from leaking into phase selection.

### Extend legacy `stage-advancement.ts`

The legacy module combines local artifact discovery, approval labels, artifact
comments, and current Run recovery state. Adding planning pull request state
would couple the new workflow to behavior that issue #180 explicitly replaces
and would make recovery depend on two state models. Reject this approach.

### One phase coordinator with inline Git and host commands

A single coordinator would reduce the number of call sites, but it would mix
agent execution, push conflict handling, pull request adoption, cleanup, and
merge verification. Interruption tests would become order-sensitive tests of a
large module. Reject this approach; a later integration slice can compose the
focused services.

## Architecture and affected components

### `src/cli/commands/run-once/planning-phase-artifacts.ts`

Owns spec and plan agent sequencing in a caller-supplied workspace. It reuses
the current prompt builders, planning Pi profile, result parser, artifact path
builders, and blocked-result contract.

It does not push, call a host, publish issue comments, mutate labels, or remove
a workspace.

### `src/cli/commands/run-once/planning-phase-publisher.ts`

Owns the ordered publication transaction: validate, resolve repository identity,
push, discover or create, persist pull request identity, and invoke checkpointed
local cleanup.

It accepts `PullRequestHost`, `PlanningWorkspaceLifecycle`,
`PlanningStateStore`, and the caller-owned `PlanningIssueLock` as dependencies.
It contains no GitHub- or Forgejo-specific parsing.

### `src/cli/commands/run-once/planning-phase-reconciler.ts`

Owns remote status classification and merged-base verification. It shares exact
pull request identity validation with the publisher, but performs no create or
push.

### Focused shared helpers

- A small Git publication adapter under `src/git/` owns remote-head inspection,
  exact non-force push, commit ancestry, and regular-file checks.
- A pure helper under `src/workflow/` validates a normalized planning pull
  request summary and its marker against saved publication identity.
- `src/host/factory.ts` gains a dedicated `createPullRequestHost()` factory that
  constructs the existing GitHub or Forgejo planning adapter with the configured
  repository root, remote, and login. This factory does not make the service
  reachable from the legacy pipeline.
- `src/cli/commands/run-once/prompts.ts` gains explicit planning review context
  so dedicated, same-phase, and implementation-carried artifacts receive
  accurate instructions while legacy prompt behavior remains unchanged.
- The issue #187 planning state types, parser, replacement rules, and tests gain
  the publication checkpoints described below.

Each effect module should remain focused and target fewer than 200 meaningful
lines. Extract Git validation and pull request identity helpers before allowing
publisher or reconciler code to grow substantially beyond that target.

## Durable phase state refinements

The state must distinguish a locally committed workspace from a remotely pushed
head. Reusing `workspace-ready` for both would make it impossible to prove that
a push was checkpointed.

### Workspace artifact progress

A `workspace-ready` phase gains an `artifacts` array. It contains an ordered,
unique subset of the artifact kinds assigned to the phase. A base artifact uses
`source: "remote-base"`; an artifact committed in the workspace uses
`source: "workspace"` and the current saved workspace head.

The partial array allows a phase that owns both artifacts to checkpoint the spec
before invoking the plan agent. Every state replacement updates all
workspace-sourced artifact commit IDs to the newly verified workspace head,
because that head contains the complete phase result so far.

### Pushed branch checkpoint

Add a `branch-pushed` phase variant containing:

```ts
type PlanningPublicationEvidence = {
  targetRepository: RepositoryIdentity;
  headRepository: RepositoryIdentity;
  baseBranch: string;
  headBranch: string;
  headOid: string;
};
```

The variant also retains the pinned base, owned workspace, and complete artifact
evidence. The publication fields must agree with the workspace branch, saved
base branch, and workspace head.

This variant means the remote head was observed at the exact object ID. A crash
between the remote push and state replacement is recovered by observing that
same remote head and writing the checkpoint before any host create call.

### Pull request checkpoint and cleanup

`pull-request-open` retains the publication evidence and adds the canonical
`PullRequestReference` and URL read from a validated host summary. Its workspace
cleanup may be `ready`, `worktree-removed`, or `removed`; cleanup is expected to
finish while the pull request is still open.

The allowed transitions are:

```text
workspace-ready
  -> workspace-ready
  -> branch-pushed
  -> pull-request-open/ready
  -> pull-request-open/worktree-removed
  -> pull-request-open/removed
  -> complete/merged-pull-request
```

Every transition is idempotent at its current state. Remote-base completion
remains the alternate transition directly from `pending` when every assigned
artifact is already satisfied.

### Merged-base evidence

A merged completion adds the fetched base tip used for verification:

```ts
completion: {
  kind: "merged-pull-request";
  mergeOid: string;
  mergedBaseOid: string;
}
```

Its workspace cleanup must already be `removed`. Its artifact evidence uses
`source: "remote-base"` and `commitOid: mergedBaseOid`, while retaining the
expected artifact paths. This intentionally replaces workspace-source evidence
at the merge transition. It records the content Patchmill will trust after human
review rather than pretending the original branch commit survived a squash or
human edit.

Strict validation continues to reject unknown fields, skipped transitions,
repository or branch disagreement, incomplete artifacts, cleanup regression, and
mutable publication identity.

## Artifact phase execution

The phase runner receives the issue, planned phase, pinned base snapshot, owned
ready workspace, and a callback that atomically replaces planning state under
the caller's lock.

### Base artifact resolution

For each assigned artifact kind:

- No candidate means the phase must create that artifact.
- One candidate records remote-base artifact evidence.
- More than one candidate is ambiguous and blocks before workspace or agent
  mutation.

If all assigned artifacts have one candidate, the caller records
`complete/remote-base` and does not create a workspace or planning pull request.
If only some exist, the phase workspace starts from the pinned base and agents
create only the missing kinds.

### Agent order and prompt context

Missing artifacts run in phase assignment order, so spec always precedes plan.
The prompt identifies one of these contexts:

- `dedicated-pull-request`: this artifact will be reviewed in the current
  planning pull request.
- `same-phase-pull-request`: a spec and plan share the current plan pull
  request; the spec is not described as already approved.
- `merged-base`: a prior dedicated spec is available from the merged base.
- `implementation-pull-request`: the ungated artifact will later travel with
  implementation code.
- `legacy-label`: preserves existing legacy prompt text.

The reusable runner may prepare artifacts assigned to an implementation phase,
but this issue publishes only `spec` and `plan` planning phases.

Each agent still commits only its own artifact and returns the existing
`spec-created` or `plan-created` result. Its prompt requires the configured
planning skill's self-review or plan validation to pass before commit. A blocked
result stops the phase before the next agent and leaves all previously
checkpointed work intact.

### Post-agent validation and checkpoint

Before accepting each agent result, Patchmill verifies:

1. The returned path is repository-relative, contained by the configured spec or
   plan directory mirrored into the phase workspace, and names a regular file
   rather than a symlink or submodule.
2. The returned commit exists, equals the live phase workspace `HEAD`, and
   descends from the previously saved phase head.
3. The artifact is a regular file in that commit.
4. The changes since the previous saved head are limited to the expected
   artifact path.
5. The worktree has no tracked, untracked, or ignored residue that would make
   owned cleanup unsafe.

The runner then replaces state with the new workspace head and artifact evidence
before starting another agent or returning to the publisher. This checkpoint
makes a successfully returned artifact commit resumable. A process interruption
while an agent is active may leave uncheckpointed local work; the strict
workspace adapter preserves it and blocks rather than resetting or silently
adopting it.

## Safe branch publication

The publisher accepts only a `workspace-ready` planning phase with complete
artifact evidence. It revalidates the clean workspace, saved head, artifact
files, and commit ancestry before any remote mutation.

It resolves target and configured push-remote identities through
`PullRequestHost` before pushing. Provider rules remain authoritative: GitHub
requires a same-repository head, while Forgejo may use a same-host, cross-owner
head. The resolved identities become immutable publication evidence.

The Git adapter inspects `refs/heads/<phase-branch>` on the configured remote:

- An absent ref permits a non-force push of the exact saved object ID.
- A ref already equal to the saved object ID is an interrupted-push recovery and
  requires no mutation.
- Any different object ID blocks. Patchmill does not force-update or adopt it.

After a push, Patchmill reads the remote ref again and requires it to equal the
saved workspace head. It immediately writes `branch-pushed` state. If that state
write fails, no pull request call or local cleanup follows. A retry observes the
exact remote head and writes the same checkpoint.

## Exact pull request discovery and creation

For a `branch-pushed` phase, the publisher searches all states using the saved
target repository, base branch, head repository, and head branch. A successful
host search is exhaustive by the issue #184 contract.

The result rules are exact:

- Zero matches permits one create attempt with the deterministic title, body,
  artifact paths, and ownership marker.
- One match is adoptable only after full summary and marker validation.
- More than one match is `ambiguous`, even if only one appears desirable.
- An incomplete search, malformed marker, duplicate marker, unsupported marker,
  or identity mismatch blocks before create.

For both an adopted and newly created pull request, Patchmill reads the exact
reference through `getPullRequest()` and validates:

- target and head repository identity;
- exact saved base and head branches;
- exact pushed head object ID;
- issue number and phase in the single `planning-pr-v1` marker; and
- a canonical reference and URL for the returned pull request.

The publisher then writes `pull-request-open/ready`. The status name denotes the
published waiting phase; the read-back summary may already report merged or
closed, which the reconciler classifies immediately after cleanup.

Patchmill never rewrites an adopted pull request body. Human text may change as
long as the one exact ownership marker remains valid.

A create error leaves durable `branch-pushed` state and the local workspace.
Because every retry performs exhaustive discovery before create, a pull request
created despite an interrupted response is adopted rather than duplicated. A
failure to persist the read-back identity also retains the workspace and skips
cleanup.

## Checkpointed local cleanup

Cleanup starts only after pull request identity is durable. The publisher uses
the issue #187 ownership record and lifecycle methods:

1. Validate the saved pull request and exact pushed remote head.
2. Remove the clean worktree without force.
3. Persist `pull-request-open/worktree-removed`.
4. Remove the local branch only after proving the remote branch still equals the
   pushed head.
5. Persist `pull-request-open/removed`.
6. Keep the remote head branch for the pull request.

A retry after either local mutation invokes only the idempotent operation
allowed by the saved cleanup discriminator. A dirty workspace, changed local
head, changed remote head, or state-write failure blocks advancement and never
uses force removal.

## Reconciliation

Reconciliation occurs before another phase workspace may be created. It first
finishes any checkpointed cleanup. It then reads a saved pull request by exact
reference, or performs exact discovery when only `branch-pushed` evidence
exists.

The public outcome is one of:

```ts
type PlanningPhaseReconciliation =
  | { kind: "review-pending"; pullRequest: PullRequestSummary }
  | { kind: "merged"; pullRequest: PullRequestSummary; baseOid: string }
  | { kind: "satisfied-by-base"; artifacts: PlanningArtifactEvidence[] }
  | { kind: "closed-unmerged"; pullRequest: PullRequestSummary }
  | { kind: "missing"; reference?: PullRequestReference }
  | { kind: "ambiguous"; pullRequests: PullRequestSummary[] };
```

`review-pending` stops normally for human review. `merged` and
`satisfied-by-base` are the only outcomes that permit the caller to consider the
phase complete. `closed-unmerged`, `missing`, and `ambiguous` are blocking
outcomes; this slice returns them without creating a replacement workspace or
pull request.

Only `PullRequestNotFoundError` from `getPullRequest()` becomes `missing`.
Authentication, authorization, rate-limit, transport, incomplete-search, invalid
JSON, malformed-response, and identity errors propagate with no phase state
replacement. Callers must not infer not-found from messages or exit text.

Every fetched or discovered summary is revalidated against immutable publication
evidence and the marker before its status is interpreted.

## Merged pull request verification

A normalized `merged` status does not complete the phase by itself. Patchmill:

1. Requires the workspace cleanup discriminator to be `removed`.
2. Fetches the phase's saved remote and saved base branch, producing a new
   pinned remote-base tip.
3. Verifies that the host-reported merge object ID is an ancestor of that exact
   fetched tip.
4. Verifies every expected artifact path is a regular file at the merge object
   and at the fetched base tip.
5. Creates remote-base artifact evidence at the fetched tip.
6. Atomically records merged completion with both `mergeOid` and
   `mergedBaseOid`.

The check uses the saved base branch, not the current checkout or a newly
configured branch. A missing merge object, non-ancestor merge, missing artifact,
or non-regular artifact blocks completion.

Patchmill does not compare merged artifact blobs with the old workspace commit.
A reviewer may edit the spec or plan before merge, including through squash or
rebase merge behavior. The verified merged-base files become authoritative and
are inherited by the next phase workspace, preserving those human edits.

## Side-effect checkpoints

The required observable order for a new planning pull request is:

```text
validate artifact phase
resolve target and head repositories
inspect/push exact remote head
persist branch-pushed
find exact pull requests
create only when none exists
read back and validate exact pull request
persist pull-request-open/ready
remove worktree
persist pull-request-open/worktree-removed
remove local branch
persist pull-request-open/removed
classify review status
```

Every successful observed remote mutation is followed immediately by a
representable state checkpoint. The unavoidable crash gap between a remote
mutation and its local checkpoint is closed by observation before repetition:
exact remote-head inspection recovers push, and exhaustive exact discovery plus
the ownership marker recovers pull request creation.

No later remote or destructive local side effect runs after a checkpoint write
failure.

## Error handling

Use stable typed failures or reconciliation outcomes:

- Artifact path, commit, cleanliness, and changed-file violations block while
  preserving the owned workspace.
- A remote branch at another object ID blocks without force-push.
- Incomplete discovery and conflicting marker or pull request identity block
  before create.
- Closed-unmerged, missing, and ambiguous outcomes block phase advancement.
- Non-not-found host failures stop the Run attempt without changing phase state.
- A state conflict or lock-ownership failure stops all further effects.
- Cleanup conflicts preserve local work and the last durable cleanup boundary.
- Merge ancestry or artifact verification failures leave the phase published but
  incomplete.

Error messages and enumerable fields must not expose pull request bodies,
command output, credentials, remote URLs with credentials, state bytes, or Pi
transcripts.

## Verification strategy

These behaviors pass the Testing Value Gate because they protect external side
effects, recovery, parsing, strict state transitions, and destructive Git
operations.

### Artifact runner tests

Recording Pi and Git seams cover:

- spec-only, plan-only, and same-phase spec-then-plan execution;
- reuse of zero, one, and mixed remote-base artifacts;
- rejection of multiple candidates before workspace creation;
- a blocked spec stopping before plan execution;
- checkpointing a verified spec before starting the plan agent;
- path escape, wrong directory, symlink, submodule, missing commit, wrong head,
  non-descendant commit, unrelated changes, and dirty residue;
- accurate dedicated, same-phase, merged-base, implementation-carried, and
  unchanged legacy prompt wording.

### Publisher and recovery tests

A recording state store, host, Git publisher, and workspace adapter assert exact
ordering and inject failure after every effect. Tests cover:

- a new push followed by `branch-pushed` persistence;
- interruption after push but before persistence;
- a matching remote head as idempotent push recovery;
- a conflicting remote head without force-push;
- one exact existing pull request adopted without create;
- zero matches creating once and reading back;
- interruption after create but before pull request persistence;
- incomplete search, wrong or duplicate marker, identity mismatch, and multiple
  exact matches blocking create;
- state-write failure preventing every later side effect;
- interruption before and after each cleanup checkpoint;
- dirty workspace and changed local or remote head blocking cleanup.

Each remote side effect therefore has both a durable state assertion and a
recovery test.

### Reconciler tests

Tests cover every reconciliation union member and prove:

- open is review-pending;
- merged requires merge ancestry and every expected artifact on the saved base
  branch;
- closed-unmerged, missing, and ambiguous block advancement;
- only typed proven absence becomes missing;
- authentication, rate-limit, transport, incomplete-search, JSON, malformed
  response, and identity failures leave phase state byte-for-byte unchanged;
- an open or merged pull request cannot advance before cleanup completes;
- a human-edited merged artifact is accepted from the fetched base even when its
  blob differs from the pushed workspace artifact.

Real-Git tests use temporary repositories and a local bare remote for push
conflicts, interrupted push recovery, cleanup, merge ancestry, and merged
artifact checks. Host tests remain fake or recording tests and create no live
pull requests.

### Final validation

Implementation validation will run focused new tests and the predecessor state,
workspace, host, prompt, and legacy planning tests, followed by:

```sh
npm run test:run-once
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
git diff --check
```

No dependency change is planned, so a Nix build is not required. If npm
dependency metadata changes unexpectedly, the repository-required Nix build must
also run.

## Compatibility

The new services and pull request factory are not routed from the existing
run-once pipeline in this slice. Legacy planning continues to use its current
state, labels, comments, and prompt mode. The `planning-pr-v1` state remains in
its separate issue #187 namespace.

No glossary or ADR change is required. The design uses the established terms
Issue run, Run attempt, Run recovery state, phase workspace, and planning pull
request.

## Acceptance criteria

- Spec and plan agents run in the supplied phase workspace, validate through
  their configured planning workflow before commit, and checkpoint only
  independently verified artifact commits before push.
- One phase can create spec then plan while retaining the first commit across a
  retry.
- Unambiguous remote-base artifacts are reused; multiple candidates block.
- Exact push recovery and exact pull request adoption prevent duplicate remote
  effects after interruption.
- Every push, pull request creation, worktree removal, and branch removal has a
  durable checkpoint and an interruption recovery test.
- Every created or adopted planning pull request contains exactly one matching
  `planning-pr-v1` ownership marker.
- Cleanup completes before review or merge can unlock another phase.
- Open, merged, closed-unmerged, missing, and ambiguous states remain distinct.
- Closed-unmerged, missing, and ambiguous states cannot advance or create a
  replacement pull request.
- Only proven not-found becomes `missing`; every other host failure leaves phase
  state unchanged.
- Merge completion proves the host merge object and expected regular-file
  artifacts on the saved base branch.
- Merged-base artifact evidence, rather than the original workspace blob,
  preserves human edits in merged planning pull requests.
- Top-level selection and locking, implementation pull request enforcement, and
  compatibility documentation remain out of scope.
