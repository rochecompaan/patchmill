# Issue 187 durable planning state and pull request workspaces design

## Status

This specification awaits manual review. Implementation planning must not begin
until the specification is approved.

## Summary

Patchmill will add the local durability and Git infrastructure required by the
`planning-pr-v1` workflow defined in issue #184:

- a strict, versioned state document for one Issue run;
- an atomic state store guarded by an ownership-ID issue lock;
- a Git-backed implementation of `PlanningWorkspaceLifecycle`;
- a fetched, immutable remote-base snapshot with planning-artifact discovery;
- exact resume checks; and
- idempotent cleanup limited to workspaces recorded as Patchmill-owned.

This slice supplies reusable infrastructure only. It does not select phases, run
agents, create or reconcile pull requests, or connect the new components to the
current run-once pipeline.

## Goals

- Reject unsupported, unknown, malformed, or internally contradictory state.
- Preserve one immutable Run identity across every resumed Run attempt.
- Replace state atomically and durably while the caller owns the issue lock.
- Acquire issue locks through one exclusive filesystem operation.
- Authorize release and state mutation by an unguessable ownership ID.
- Diagnose active, stale, unverifiable, and malformed existing locks without
  taking them over automatically.
- Fetch and pin the configured remote base before deciding whether a phase needs
  a workspace.
- Inspect planning artifacts from the pinned base tree, not the current
  checkout.
- Create each new phase branch and worktree at that exact base commit.
- Resume only the workspace identity and commits saved for the same Run and
  phase.
- Make cleanup retries safe after either cleanup step has already succeeded.
- Refuse deletion unless durable ownership and current Git identity agree.

## Non-goals

- Run planning or implementation agents.
- Select the next planning phase or approval policy.
- Create, find, update, merge, or reconcile pull requests.
- Push phase branches.
- Connect the new state, lock, or workspace adapter to `run-once`.
- Replace or migrate the existing `AgentIssueRunState` and Issue run lease.
- Add automatic stale-lock takeover, a lock-repair CLI, or force cleanup.
- Clean, stash, reset, merge, or rebase a phase workspace.
- Remove an unregistered directory or a workspace not proven to be owned.
- Add dependencies or configuration keys.

## Approaches considered

### Focused planning store, lock, and Git adapter (chosen)

Keep the new workflow under its own versioned state namespace. A strict state
module owns domain invariants, a small store owns filesystem atomicity, an
ownership-ID lock serializes issue mutations, and a Git adapter implements the
workspace contract.

This keeps pure validation separate from filesystem and Git effects. It also
allows later phase coordination to consume stable interfaces without changing
the current pipeline in this slice.

### Extend legacy run state and recovery leases

The existing run state is incrementally merged, accepts fields that its recovery
parser does not reject, and has compatibility rules for the current pipeline.
Its lease also performs same-host stale takeover. Retrofitting the stricter
planning contract there would couple the new workflow to legacy checkpoints and
expand issue #187 into a migration. This approach is rejected.

### Reconstruct state and ownership from Git

Deterministic branch and worktree names could be rediscovered after a restart,
but names do not prove which Run created a workspace or which base and head were
saved. This cannot meet immutable Run identity, exact resume, or owned cleanup
requirements and is rejected.

## Architecture and module boundaries

### Planning state

Add focused modules under `src/workflow/`:

- `planning-state.ts` owns the versioned types, strict parser, serializer, and
  cross-field invariants.
- `planning-state-store.ts` owns state paths, initialization, reads, and atomic
  replacement.
- `planning-issue-lock.ts` owns lock records, acquisition, inspection, release,
  and conflict diagnostics.

The files live below the configured run-state directory without adding a new
configuration key:

```text
<runStateDir>/planning-pr-v1/issues/issue-N.json
<runStateDir>/planning-pr-v1/locks/issue-N.lock
```

This namespace avoids collisions with current `issue-N.json` state and locks. It
is already covered by the configured run-state cleanliness exclusion.

### Git infrastructure

Keep the provider-neutral types in `src/git/planning-workspaces.ts`. Refine that
contract so a fetched remote-base snapshot and saved ownership record are
first-class inputs rather than loose SHA strings.

Add focused Git implementation modules under `src/git/`:

- `planning-workspace-git.ts` implements inspection, creation, resume, and
  cleanup through `CommandRunner`.
- `planning-remote-base.ts` fetches and pins the target base and inspects
  artifact candidates in that commit tree.
- A parsing helper may be extracted if robust `git worktree --porcelain` or
  `git ls-tree -z` parsing would push either effect module beyond roughly 200
  meaningful lines.

The adapter binds to one repository root and one configured worktree root.
Callers use lifecycle methods and typed snapshots; they do not assemble Git
command sequences.

## Durable planning state

### Top-level identity

The version `1` document has this structural shape:

```ts
type PlanningStateV1 = {
  version: 1;
  workflowVersion: "planning-pr-v1";
  runId: string;
  issueNumber: number;
  issueTitle: string;
  gates: PlanningGateSnapshot;
  phases: PlanningPhaseStateV1[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};
```

`runId` is an immutable UUID for the Issue run. `revision` starts at zero. The
ordered `phases` array has one record for every phase returned by
`planningPhasePlan(gates)`.

A retry starts a new Run attempt but retains `runId`. A new state file receives
a new `runId`. No update API accepts a replacement Run ID, issue identity, gate
snapshot, workflow version, or phase sequence.

The store does not merge arbitrary partial objects. A caller constructs the next
complete typed state from the current parsed state. Replacement requires the
current `runId` and `revision`; the next document must preserve the immutable
fields and increment `revision` by exactly one.

### Phase records

Reusable phase evidence has these shapes:

```ts
type PlanningBaseEvidence = {
  remote: string;
  baseBranch: string;
  baseOid: string;
  artifactCandidates: { spec: string[]; plan: string[] };
};

type PlanningArtifactEvidence = {
  kind: "spec" | "plan";
  path: string;
  commitOid: string;
  source: "remote-base" | "workspace";
};

type PlanningPullRequestEvidence = {
  reference: PullRequestReference;
  baseBranch: string;
  headBranch: string;
  headOid: string;
};

type PlanningWorkspaceEvidence = {
  runId: string;
  phase: PlanningPhaseKind;
  identity: PlanningWorkspaceIdentity;
  remote: string;
  baseBranch: string;
  baseOid: string;
  headOid: string;
  cleanup:
    | { state: "ready" }
    | { state: "worktree-removed"; pushedHeadOid: string }
    | { state: "removed"; pushedHeadOid: string };
};
```

`PlanningPhaseStateV1` is the following exact discriminator family:

- `pending`: `kind` and `status` only.
- `workspace-ready`: `kind`, `status`, base evidence, and workspace evidence.
- `pull-request-open`: `kind`, `status`, base, workspace, artifact, and pull
  request evidence.
- `complete` with `completion.kind = "remote-base"`: `kind`, `status`, base,
  artifact evidence, and the completion discriminator; it has no workspace or
  pull request.
- `complete` with `completion.kind = "merged-pull-request"`: `kind`, `status`,
  base, workspace, artifact evidence, pull request evidence, and the merge
  object ID in its completion value.

Artifact arrays contain exactly the planning artifact kinds assigned to the
phase and may be empty for implementation. Workspace cleanup retains immutable
identity evidence while moving from `ready` through `worktree-removed` to
`removed`.

This slice defines and tests these state shapes but does not perform pull
request transitions. Later coordination code will supply neutral pull request
references from `PullRequestHost`.

### State invariants

The parser and every write enforce all of these rules:

- Objects at every level contain exactly the documented keys for their
  discriminator. Unknown keys and missing required keys fail.
- Only state version `1` and workflow version `planning-pr-v1` are accepted.
- IDs, timestamps, Git object IDs, branch names, repository-relative paths, and
  artifact kinds have bounded validated forms.
- The stored phase sequence exactly matches `planningPhasePlan(gates)`; phases
  are unique and in order.
- Completed phases form a prefix, pending phases form a suffix, and at most one
  phase is active or waiting for a pull request merge.
- A phase discriminator requires its evidence and forbids evidence belonging to
  another state. For example, `pending` cannot contain a workspace, and a
  pull-request completion requires a merged summary and merge commit.
- A remote-base completion refers only to artifact kinds assigned to that phase
  and paths found in its pinned base snapshot. It has no workspace or pull
  request.
- Workspace ownership always agrees with the containing `runId` and phase.
  Branches and worktree paths cannot be shared by two phase records.
- A workspace base, identity, and ownership tuple never changes. Its saved head
  may advance only before cleanup starts. Cleanup can move only
  `ready -> worktree-removed -> removed`.
- `updatedAt` cannot precede `createdAt`, and revisions cannot move backward or
  skip.

Invalid JSON, unsupported versions, unknown keys, and invariant violations use a
stable `PlanningStateValidationError` with a reason and JSON path. Raw document
contents are not included in the default error message.

## Atomic state store

All mutating store methods require a live `PlanningIssueLock` for the same issue
and Run. Immediately before replacement, the store rereads and strictly parses
both state and lock, verifies the ownership ID, `runId`, and expected revision,
and validates the complete next document.

A write uses this sequence in the destination directory:

1. Create a unique temporary file with exclusive creation and mode `0600`.
2. Write one canonical JSON document plus a trailing newline.
3. Flush and close the temporary file.
4. Rename it over the destination in the same directory.
5. Flush the parent directory where the platform supports directory syncing.
6. Remove a remaining temporary file after a pre-rename failure.

The old or new complete document is therefore visible after interruption; a
partially written canonical file is not. Initialization uses the same sequence
while holding the issue lock and refuses to replace an existing state file.

Read methods never coerce or repair malformed state. A parse failure blocks the
operation with the exact state path for operator inspection.

## Ownership-ID issue lock

### Lock record and acquisition

Each Run attempt receives a fresh random `ownershipId`; this differs from the
stable state `runId`. The version `1` lock record contains:

- issue number and Run ID;
- ownership ID;
- process ID and host name for diagnostics only; and
- an acquisition timestamp.

Acquisition creates the canonical lock file with `open(..., "wx", 0o600)`,
writes and flushes the validated record, and keeps the resulting lock value in
memory. File existence is the atomic exclusion primitive. Process ID, host, and
age never authorize mutation.

Release rereads the lock and removes it only when issue number, Run ID, and
ownership ID all match. A missing lock is an idempotent successful release. A
mismatched or malformed lock is never removed.

### Existing-lock diagnostics

When exclusive creation reports `EEXIST`, Patchmill reads the exact existing
bytes and returns a stable conflict classification:

- `active`: a valid same-host record whose process is alive;
- `stale`: a valid same-host record whose process is proven dead;
- `unverifiable`: a valid remote-host record or a local liveness check that is
  not permitted;
- `malformed`: bytes do not parse as the exact supported lock schema.

Diagnostics contain the lock path, safe parsed owner fields when available, and
a SHA-256 fingerprint of the exact bytes. Elapsed time may be reported but does
not classify or invalidate a lock. This slice never archives, replaces, or
repairs an existing lock; stale and malformed locks require later explicit
operator tooling or manual inspection.

## Remote-base snapshot and artifact discovery

For each phase, the adapter first fetches the configured remote branch using
argument arrays and an explicit branch refspec. It does not rely on a possibly
stale local checkout or `HEAD`. After a successful fetch it resolves the
remote-tracking ref to one full Git object ID and returns an immutable snapshot:

```text
remote + base branch + base object ID + artifact candidates
```

All subsequent artifact inspection and workspace creation for that phase use the
object ID, never the moving ref name.

Artifact discovery normalizes the configured specs and plans directories against
the repository root, requires them to remain inside that root, and uses the
resulting repository-relative tree paths. It runs `git ls-tree -r -z` against
the pinned commit, accepts regular files only, and applies the same issue-number
filename rule used by current local artifact discovery. It returns deterministic
sorted candidate arrays for spec and plan rather than silently choosing the
first match. No file is materialized and the current checkout is not read.

Missing directories and no matching files produce empty candidate arrays.
Multiple candidates remain explicit so later phase coordination can fail closed
or apply its approved resolution policy. Invalid configured paths, malformed Git
output, missing commits, and command failures fail without creating a workspace.

## Workspace creation and resume

### New workspace

A new prepare call requires the remote-base snapshot for the current phase. The
adapter revalidates the snapshot inputs, proves the expected branch is absent,
proves the expected path is absent and unregistered, then runs
`git worktree add` with a new phase branch at the exact pinned base object ID.

After creation it inspects Git again and returns a ready snapshot only when:

- the expected absolute path is a registered worktree;
- that worktree is attached to the exact expected branch;
- the branch is not attached elsewhere;
- branch and worktree `HEAD` equal the pinned base object ID; and
- Git status can be read.

A branch-only collision, unregistered directory, detached checkout, path owned
by another branch, or branch owned by another worktree is a conflict. Fresh
prepare never adopts pre-existing state.

### Resume

Resume accepts the saved workspace record from strictly parsed state, not newly
derived names plus loose commit strings. It verifies all of these values before
returning the existing checkout:

- state Run ID and phase equal the requested Run and phase;
- saved and expected branch and worktree path are identical;
- saved remote and base branch equal current inputs;
- the live registered path and branch map to each other;
- live branch and worktree `HEAD` equal the saved head object ID; and
- the saved pinned base object exists and equals the phase base evidence.

Resume performs no fetch, reset, branch creation, worktree creation, or cleanup.
It reports current cleanliness for the later coordinator to interpret. Missing,
branch-only, mismatched, detached, or unregistered state fails closed. Repeating
a matching resume produces the same snapshot and no mutation.

## Owned and idempotent cleanup

Cleanup methods require the complete saved ownership record from strict state. A
deterministic phase suffix alone is never ownership proof. Before each mutation,
the adapter validates the Run, phase, configured worktree containment, exact
branch/path registration, and expected head object ID.

`removeWorktree`:

- refuses tracked, untracked, or ignored content;
- uses `git worktree remove` without `--force`;
- returns `branch-only` after successful removal;
- returns the same `branch-only` result when the checkout is already absent but
  the exact branch and head remain; and
- returns `missing` when both exact resources were already removed.

`removeBranch`:

- accepts only a `worktree-removed` ownership record;
- proves the branch is not checked out anywhere;
- queries the configured remote and proves that its exact branch ref equals the
  saved pushed head object ID;
- deletes only `refs/heads/<saved-branch>` using an expected-old-object
  compare-and-swap; and
- returns `missing` both after deletion and when an earlier identical attempt
  already removed it.

Unexpected path contents, a differently attached branch, a changed local head, a
changed remote head, or unverifiable Git state blocks cleanup. Cleanup never
uses recursive filesystem deletion, `git clean`, `git reset`, force worktree
removal, or name-pattern sweeps. State persists `worktree-removed` before branch
removal so a crash between steps resumes at the safe boundary.

## Error handling

Use stable typed errors rather than message parsing:

- `PlanningStateValidationError` for schema and invariant failures;
- `PlanningStateConflictError` for Run ID, revision, or lock-ownership changes;
- `PlanningIssueLockConflictError` with active/stale/unverifiable/malformed
  diagnostics;
- `PlanningWorkspaceConflictError` for unsafe live Git identity or cleanup;
- `PlanningWorkspaceCommandError` for failed Git commands; and
- `PlanningWorkspaceResponseError` for malformed Git output.

Errors include safe operation, reason, and expected identity fields. Command
arguments, remote credentials, state bytes, and raw output are not present in
default messages or enumerable fields.

## Data flows

### Start a phase

1. Acquire the issue lock with the stable Run ID and a fresh ownership ID.
2. Reread and strictly parse planning state under the lock.
3. Fetch and pin the configured remote base.
4. Inspect that exact tree for issue planning artifacts.
5. If remote-base artifacts satisfy the phase, persist a remote-base completion
   without creating a branch or worktree.
6. Otherwise create the phase workspace at the pinned object ID.
7. Persist the owned ready workspace by atomic state replacement.
8. Release the lock when the surrounding Run attempt ends.

Steps 5 and later phase decisions are consumers of this infrastructure and are
not wired into production by issue #187.

### Resume or cleanup

1. Read planning state to learn the Run ID, then acquire the issue lock.
2. Reread state under the lock and verify its expected revision.
3. Pass the saved phase ownership record to resume or cleanup.
4. Persist each successful cleanup boundary atomically.
5. Repeating the operation either returns the same verified snapshot or reports
   a focused conflict; it does not adopt or delete different state.

## Verification strategy

The Testing Value Gate supports automated tests here because parsing,
concurrency, crash safety, Git command contracts, and destructive cleanup are
reusable and high-risk behavior.

### State and lock tests

Focused tests will cover:

- round-trip parsing of every phase and cleanup discriminator;
- rejection of unknown top-level and nested keys, unsupported versions,
  malformed values, wrong phase sequences, forbidden fields, duplicate
  identities, invalid progress ordering, and incomplete merge evidence;
- immutable Run identity and monotonic revision enforcement;
- a simulated failure before rename leaving the previous complete document;
- exact-lock ownership required for replacement and release;
- concurrent lock acquisition allowing exactly one owner;
- idempotent release by the owner; and
- active, stale, remote/unverifiable, and malformed lock diagnostics with stable
  reasons and fingerprints.

### Git adapter tests

Recording-runner tests will verify command arguments, working directories,
ordering, exact object-ID use, and error classification.

Real-Git tests with temporary repositories and a local bare remote will prove:

- advancing the remote after the local clone is stale still creates a phase
  workspace at the newly fetched remote base;
- spec and plan candidates are read from the pinned remote tree, including empty
  and multiple-candidate results;
- fresh creation refuses every branch/path collision;
- matching saved resume is a no-op;
- Run, phase, identity, base, or head mismatches refuse resume;
- dirty, untracked, and ignored content blocks worktree removal;
- a different workspace or changed head is never removed;
- repeated worktree and branch cleanup returns the expected idempotent state;
- branch cleanup requires the exact remote head; and
- no cleanup path uses force or recursive deletion.

### Validation commands

Focused implementation validation will use the new state, lock, remote-base, and
Git workspace test files plus the existing workspace contract tests. Final
validation will use:

```sh
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
```

No dependency change is planned, so a Nix build is not required. No new test
will assert static documentation or configuration text; the final diff will
verify that runtime wiring and configuration remain unchanged.

## Compatibility

The new modules remain unreachable from the current run-once workflow. Existing
run state, recovery leases, issue workspaces, labels, artifact publication, host
factories, and CLI behavior do not change.

The `PlanningWorkspaceLifecycle` refinement is limited to the unused foundation
introduced by issue #184 and its contract tests. It makes fetched-base and
ownership evidence explicit before a production consumer exists.

No glossary change is required. This design uses the established Issue run, Run
attempt, and Run recovery state distinction; the new planning state is the
strict Run recovery state for `planning-pr-v1`, not an Event ledger or Pi
session log.

## Acceptance criteria

- State parsing rejects unknown keys, unsupported versions, malformed values,
  and contradictory phase, artifact, pull request, workspace, and cleanup data.
- State initialization and replacement use same-directory atomic rename and
  preserve an immutable Run ID.
- Every state mutation requires the matching ownership-ID issue lock.
- Lock acquisition is exclusive and existing locks produce safe stale-lock
  diagnostics without automatic takeover.
- Each phase uses one fetched, pinned remote-base object ID for artifact
  inspection and new workspace creation.
- Remote-base artifact discovery does not depend on the current checkout and
  does not silently choose among multiple candidates.
- Fresh preparation never adopts an existing branch, path, or worktree.
- Resume is mutation-free and succeeds only for the saved Run, phase, workspace
  identity, base, and head.
- Cleanup retries are idempotent at worktree-removed and branch-removed
  boundaries.
- Cleanup removes only the exact clean phase workspace and branch proven by
  durable Patchmill ownership and live Git evidence.
- Existing production workflow behavior remains unchanged.
