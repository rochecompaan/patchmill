# Recover Stale Planning Issue Locks Automatically Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a later same-host Run attempt safely preserve and replace a
planning issue lock whose owner process is provably dead, then continue normal
post-lock validation without operator filesystem surgery.

**Architecture:** Change the canonical `issue-N.lock` representation to a
non-empty ownership directory containing one strict mode-`0600` owner record,
and keep the record format, parser, liveness classification, ownership
assertion, and release API semantics in `planning-issue-lock.ts`. Acquisition
stages a complete private sibling directory and atomically renames it into the
canonical path; POSIX rename of a non-empty directory onto an existing non-empty
directory fails, so acquisition is the compare-and-swap boundary and can never
clobber a live owner. A focused takeover helper serializes recovery with a
crash-recoverable per-Issue transition directory of the same form, re-observes
the canonical lock under that transition owner, archives a stale owner by
atomically renaming the whole canonical directory to a deterministic,
non-overwriting archive path, and creates the replacement through the same
staged-directory rename. Carry structured takeover evidence on the acquired lock
so the planning pipeline can emit one warning before any post-lock mutation.

**Tech Stack:** TypeScript ESM, Node.js `node:fs/promises`, SHA-256 and UUIDs
from `node:crypto`, `node:test`, the existing Run-once progress/JSONL and
structured-diagnostic contracts, Astro/Starlight Markdown documentation,
Prettier, ESLint, TypeScript, and dependency-cruiser; no new dependency.

**Spec:**
`docs/specs/2026-09-22-issue-255-run-once-cannot-recover-from-its-own-crashed-run-s-stale-issue-lock-design.md`

**Maintainer decision (2026-09-27):** The repository owner authorized revising
this plan, the spec, and the lock representation to an atomic
canonical-directory/indirection protocol (issue #255 approval comments). This
revision supersedes the earlier hard-link/inode-verify/unlink archival sequence:
Node/POSIX provides no atomic inode-conditional unlink, so a compare-then-unlink
sequence can delete a replacement owner between the check and the unlink.
Wherever an older section below still describes a canonical regular file or a
hard-link/unlink archive, this revision wins.

**Maintainer decision (2026-09-27, retry authorization):** The repository owner
answered "Yes" to the 2026-09-27 blocked-run question on issue #255: the
governed workflow may continue this implementation with a longer worker deadline
and must then run all required review gates. Concretely:

- Continue from the committed branch state (`467196b`, `8b0d4fa`). First audit
  which plan steps those commits already satisfy; do not redo completed work or
  re-ask decided questions.
- The earlier worker hit a 30-minute child timeout during validation before the
  Codex, thermo-nuclear, and validation-readiness gates launched. Set a
  per-child deadline of at least two hours
  (`timeoutMs`/`maxRuntimeMs` >= 7200000) on implementation and fix-up worker
  launches for this issue so plan Task 4 validation and every required review
  gate can finish.
- The timed-out worker belonged to the previous run and cannot be resumed across
  runs; launch a fresh worker that resumes from the branch instead.

## Global Constraints

- Only a valid lock from the current host whose PID probe returns `dead`
  authorizes takeover. Lock age never authorizes recovery.
- Preserve the exact stale bytes, SHA-256 fingerprint, fully parsed former
  owner, canonical source path, and deterministic archive path.
- Serialize takeover with a non-empty per-Issue transition ownership directory;
  stage and flush its strict owner record before atomically renaming the whole
  directory into the canonical transition path.
- Active transition owners return the existing successful
  `stopped / issue-locked` outcome. Unverifiable or malformed canonical locks
  and transition owners remain blocked and untouched.
- Reclaim a stale transition owner only by atomically moving its whole directory
  to a deterministic, non-overwriting archive derived from the validated Issue
  number and transition ownership ID.
- The canonical lock is a non-empty ownership directory `issue-N.lock/`
  containing exactly one strict mode-`0600` owner record. Never create or mutate
  canonical owner bytes in place, and never unlink individual records out of a
  canonical or transition directory; ownership changes only through
  whole-directory atomic renames.
- Re-read and fingerprint the canonical owner record after transition ownership
  is established. Never remove a lock based on the observation that triggered
  takeover.
- Reclaim a stale canonical lock only by atomically renaming the whole canonical
  directory to its deterministic archive path derived from the validated Issue
  number and observed ownership ID.
- Treat a legacy regular file at the canonical path (written before this
  revision) as a valid lock representation: classify it from its bytes, and
  reclaim it only by atomically renaming the whole file to its deterministic
  archive path. All Patchmill acquisitions use exclusive creation, so no
  protocol participant renames over an occupied canonical path.
- Existing archive destinations are never overwritten. A changed canonical
  owner, archive collision, replacement race, permission failure, or unexpected
  liveness error fails closed while preserving the available source/archive
  evidence.
- The replacement lock keeps the requested Run ID, receives a fresh ownership
  ID, is a canonical ownership directory whose owner record has mode `0600`, and
  remains the sole authority used by `PlanningStateStore`, ownership assertions,
  and release.
- Planning state, issue labels/comments, Git state, phase workspaces, and host
  state are not mutated until replacement ownership exists and the existing
  post-lock checks pass.
- Emit one warning after either acquisition site when takeover evidence is
  present. Include Issue, former Run ID, hostname, PID, acquisition time,
  fingerprint, source path, and archive path in progress/JSONL data; never emit
  raw lock bytes.
- Keep `issue-lock-stale` as a stable historical/defensive reason, but remove
  guidance that tells operators to hand-move an ordinary same-host stale lock.
- Do not add `patchmill unlock`, a force flag, state-schema changes, Run-ID or
  phase changes, selection/result/exit-code changes, legacy lease behavior, or
  automatic archive deletion.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If implementation unexpectedly retains an npm dependency metadata change, run
  the Nix build required by `AGENTS.md`.

---

## File and Module Map

### Transition and archival protocol

- Create `src/workflow/planning-issue-lock-takeover.ts` to own transition path
  derivation, complete-directory staging, transition classification/recovery,
  atomic whole-directory stale-lock archival, replacement coordination, and
  transition retirement.
- Create `src/workflow/planning-issue-lock-takeover.test.ts` for transition
  ownership, delayed-contender, archive-collision, interruption-boundary, and
  filesystem failure behavior.

### Canonical lock integration

- Modify `src/workflow/planning-issue-lock.ts` to represent the canonical lock
  as a non-empty ownership directory, expose takeover evidence on a successfully
  acquired lock, give diagnostics an explicit lock resource, replace the
  regular-file exclusive open with staged-directory atomic creation, and enter
  guarded takeover only for an authoritative `stale` observation.
- Modify `src/workflow/planning-issue-lock.test.ts` for exact-byte replacement,
  classification preservation, concurrent rescuers, replacement races, and
  ownership/release behavior.
- Modify `src/workflow/planning-state-store.test.ts` only where needed to retain
  the state store's ownership-ID authority with a reclaimed lock.

### Pipeline observability and operator contract

- Modify `src/cli/commands/run-once/planning-pipeline-issue.ts` to emit takeover
  progress immediately after both the provisional and authoritative-Run-ID
  acquisition sites.
- Modify `src/cli/commands/run-once/planning-pipeline.ts` to pass the attempt's
  progress reporter and deterministic test clock into `runPlanningIssue()`.
- Modify `src/cli/commands/run-once/planning-pipeline.test.ts` and
  `src/cli/commands/run-once/planning-pipeline-progress.test.ts` to prove event
  order, exact warning data, console rendering, and JSONL output without raw
  bytes.
- Modify `src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts`
  and `test-support/run-once/planning-provider-{scenario,recovery-control}.ts`
  so the provider regression installs a dead lock and proves automatic archival
  and continuation instead of manually moving the lock.
- Modify `src/cli/commands/run-once/planning-pipeline-diagnostics.ts`,
  `src/cli/commands/run-once/result-diagnostic-types.ts`,
  `src/cli/commands/run-once/result-diagnostic-planning.ts`, and
  `src/cli/commands/run-once/result-diagnostics.test.ts` to distinguish a
  canonical conflict from transition ownership and retain safe defensive stale
  guidance.
- Modify `site/src/content/docs/using-patchmill/run-once.md` to document
  automatic same-host recovery, archive retention, the warning, and remaining
  fail-closed cases.

The new helper keeps transition-directory and archival mechanics out of the
274-line canonical lock module. Pipeline warning emission stays beside the two
acquisition boundaries rather than teaching generic progress reporters about
planning locks. No broad lock utility or unrelated recovery refactor is added.

## Shared Interfaces and On-Disk Layout

Use these public shapes consistently:

```ts
// planning-issue-lock.ts
export type PlanningIssueLockResource =
  | "canonical-lock"
  | "takeover-transition";

export type PlanningIssueLockTakeoverEvidence = Readonly<{
  owner: PlanningIssueLockRecord;
  fingerprint: string;
  sourcePath: string;
  archivePath: string;
}>;

export type PlanningIssueLock = Readonly<{
  path: string;
  record: PlanningIssueLockRecord;
  takeover?: PlanningIssueLockTakeoverEvidence;
}>;

export type PlanningIssueLockDiagnostic = Readonly<{
  classification: "active" | "stale" | "unverifiable" | "malformed";
  resource: PlanningIssueLockResource;
  path: string;
  fingerprint: string;
  owner?: Readonly<{
    issueNumber: number;
    runId: string;
    pid: number;
    hostname: string;
    acquiredAt: string;
  }>;
}>;
```

`takeover.owner` is the complete parsed former record, including `ownershipId`;
public conflict diagnostics continue omitting ownership IDs from their reduced
`owner` object. Use these deterministic paths after validating the Issue number
and UUIDs:

```text
planning-pr-v1/locks/issue-N.lock/owner.record
planning-pr-v1/locks/issue-N.takeover/owner.lock
planning-pr-v1/archive/issue-locks/issue-N/<staleOwnershipId>/owner.record
planning-pr-v1/archive/issue-lock-transitions/issue-N/<transitionOwnershipId>/owner.lock
```

Stage a canonical lock under a unique sibling such as
`.issue-N.lock.<ownershipId>.tmp`, stage a transition under a unique sibling
such as `.issue-N.takeover.<transitionOwnershipId>.tmp`, and retire a normally
released lock or transition by renaming the complete canonical directory to a
private sibling before removing only that private path.

Keep the takeover helper independent of the public lock module with a narrow,
generic adapter rather than a runtime import cycle:

```ts
// planning-issue-lock-takeover.ts
export type PlanningLockObservation<Record> = Readonly<{
  classification: "active" | "stale" | "unverifiable" | "malformed";
  path: string;
  bytes: Buffer;
  fingerprint: string;
  record?: Record;
}>;

export type PlanningIssueLockTakeoverAdapter<Record, Lock> = Readonly<{
  observe(path: string): Promise<PlanningLockObservation<Record> | undefined>;
  serialize(record: Record): Buffer;
  createCanonical(): Promise<Lock>;
  conflict(
    observation: PlanningLockObservation<Record>,
    resource: "canonical-lock" | "takeover-transition",
  ): never;
}>;

export async function takeOverStalePlanningIssueLock<
  Record extends { ownershipId: string },
  Lock,
>(input: {
  runStateDir: string;
  issueNumber: number;
  canonicalPath: string;
  triggeringObservation: PlanningLockObservation<Record>;
  transitionOwner: Record;
  adapter: PlanningIssueLockTakeoverAdapter<Record, Lock>;
}): Promise<{
  lock: Lock;
  evidence?: Readonly<{
    owner: Record;
    fingerprint: string;
    sourcePath: string;
    archivePath: string;
  }>;
}>;
```

The helper may add private filesystem/checkpoint adapters for deterministic unit
tests, but production callers expose only the concrete lock options. It must not
import `PlanningIssueLockConflictError`; `planning-issue-lock.ts` converts
observations to the existing public error through `conflict()`.

The takeover warning uses the existing generic progress envelope:

```ts
{
  level: "warning",
  stage: "planning-lock",
  message: "stale planning lock reclaimed",
  consoleMessage:
    `⚠ reclaimed stale planning lock for issue #${issueNumber}; ` +
    `archived evidence at ${archivePath}`,
  issueNumber,
  data: {
    kind: "planning-lock-takeover",
    oldRunId: evidence.owner.runId,
    hostname: evidence.owner.hostname,
    pid: evidence.owner.pid,
    acquiredAt: evidence.owner.acquiredAt,
    fingerprint: evidence.fingerprint,
    sourcePath: evidence.sourcePath,
    archivePath: evidence.archivePath,
  },
}
```

Do not put `bytes`, serialized owner JSON, or another raw-content field in the
event.

## Testing Value Gate

All planned automated tests pass Patchmill's Testing Value Gate:

- **Behavior rather than implementation:** They prove single ownership under
  concurrent rescue, exact evidence preservation, crash recovery at protocol
  boundaries, no displacement of live/unverifiable/malformed owners, continued
  post-lock workflow execution, and public warning behavior.
- **Meaningful regression sensitivity:** They fail if takeover uses age,
  overwrites an archive, trusts an obsolete fingerprint, removes a replacement,
  leaves a dead transition as a permanent wedge, bypasses ownership-ID checks,
  mutates before locking, or omits the operator-visible warning.
- **Maintainer value:** Maintainers can rerun focused lock tests whenever
  filesystem behavior, process liveness, planning state authority, pipeline
  acquisition, progress, or diagnostics change.
- **Reusable/risky behavior:** This protocol protects unattended concurrency,
  crash recovery, exact forensic evidence, and the mutation authority for all
  strict planning state, so maintained unit and provider integration coverage is
  justified.

Do not add automated tests for documentation prose, static path spelling,
dependency versions, or the unchanged state-schema version. Verify those with
Markdown lint/formatting, focused diff inspection, architecture checks, and the
conditional dependency/Nix command.

---

### Task 1: Build Crash-Recoverable Takeover Transition Ownership

**Files:**

- Create: `src/workflow/planning-issue-lock-takeover.ts`
- Create: `src/workflow/planning-issue-lock-takeover.test.ts`

**Interfaces:**

- Consumes: the generic `PlanningLockObservation`, transition owner record,
  validated Issue number, canonical lock path, and adapter callbacks from
  **Shared Interfaces and On-Disk Layout**.
- Produces: `takeOverStalePlanningIssueLock()` with one acquired replacement or
  one typed conflict/error, optional exact stale-lock evidence, a complete
  transition directory protocol, and no dependency on the public lock module.

- [ ] **Step 1: Write failing transition staging and single-owner tests**

  Build a temporary-directory adapter with strict JSON owner records. Start two
  `takeOverStalePlanningIssueLock()` calls for the same stale observation and
  assert only one transition directory rename succeeds. The loser must inspect
  the winner's complete `owner.lock` and report
  `resource: "takeover-transition"`, `classification: "active"`; it must never
  call `createCanonical()` or mutate the canonical/archive paths.

  Assert the winning canonical transition path is a non-empty directory whose
  only entry is a mode-`0600` `owner.lock`, and that no canonical path is ever
  intentionally visible before the owner record has been written and flushed.

- [ ] **Step 2: Write failing transition classification and reclamation tests**

  Install transition directories whose owner is active, same-host dead,
  remote-host/unverifiable, malformed JSON, and structurally malformed (missing
  record, extra entry, or non-regular record). Assert:

  ```ts
  active        -> conflict("takeover-transition", "active")
  stale         -> archive whole directory, retry transition acquisition
  unverifiable  -> conflict("takeover-transition", "unverifiable")
  malformed     -> conflict("takeover-transition", "malformed")
  ```

  For a stale transition, assert the directory is moved intact to
  `archive/issue-lock-transitions/issue-N/<ownershipId>`, the canonical
  transition path is reacquired with the contender's ownership ID, and the old
  archive is never removed. For malformed structure, fingerprint a stable sorted
  inventory; for malformed record bytes, fingerprint the exact bytes.

- [ ] **Step 3: Write failing delayed-contender and retirement tests**

  Pause one contender after observing a stale transition. Let a second contender
  move it to the deterministic archive and acquire a newer transition. Resume
  the first contender and assert its move targets the already-populated old
  archive, fails closed, and cannot displace the newer canonical directory.

  For normal release, assert the helper verifies the transition ownership ID,
  renames the whole directory to the private `.retired` path, and removes only
  that private path. A changed owner or pre-existing retirement destination must
  remain untouched and reject; release must never empty or recursively delete
  the canonical directory in place.

- [ ] **Step 4: Write failing stale-lock archival and boundary-state tests**

  Under an acquired transition, re-observe the canonical lock and cover:
  - disappearance: call ordinary exclusive creation without takeover evidence;
  - changed active/unverifiable/malformed bytes: return that new conflict and
    leave bytes unchanged;
  - changed same-host stale owner: archive only the new authoritative bytes;
  - exact stale owner: move its whole canonical directory to the ownership-ID
    archive path with one atomic rename;
  - pre-existing archive from an interrupted or completed takeover: the archive
    destination already exists and is never replaced, so fail closed; and
  - replacement rename failure because a canonical directory already exists:
    classify/propagate the replacement conflict and never remove it.

  Construct the durable filesystem states for interruption before archival,
  after evidence creation but before source removal, after source removal but
  before replacement, after replacement, and before transition retirement.
  Assert another same-host attempt either recovers to one replacement owner or
  safely reports the live replacement; none remains permanently wedged.

- [ ] **Step 5: Run the focused helper test and verify the red state**

  Run:

  ```sh
  node --test src/workflow/planning-issue-lock-takeover.test.ts
  ```

  Expected before implementation: FAIL because the takeover helper and exported
  protocol do not exist.

- [ ] **Step 6: Implement staged transition ownership and atomic archives**

  Validate every Issue number and ownership UUID before path derivation. Create
  archive parents without following unchecked lock text. Stage a mode-`0700`
  directory with exactly one mode-`0600` owner file, call the file handle's
  `sync()`, close it, and `rename()` the complete directory to the canonical
  transition path.

  Classify existing transitions through the adapter's strict owner observation.
  Move a proven stale transition directory to its deterministic non-empty
  archive and retry. Treat `EEXIST`, `ENOTEMPTY`, changed ownership, malformed
  structure, and every unexpected filesystem result as a fail-closed outcome;
  never recursively remove an unowned canonical transition.

  For canonical stale owners, archive by atomically renaming the whole canonical
  ownership directory to its deterministic, non-overwriting archive path; the
  atomic move preserves the exact owner record bytes and cannot strand a
  half-copied archive. Do not use a hard-link/inode-verify/unlink sequence:
  Node/POSIX provides no atomic inode-conditional unlink, so compare-then-unlink
  can delete a replacement owner. Re-read the canonical path under transition
  ownership before acting, and invoke `createCanonical()` only after the
  authoritative stale directory is retired or the path is absent. Retire the
  transition in `finally` for ordinary returns and errors; the boundary-state
  tests model process death, where `finally` cannot run.

- [ ] **Step 7: Run the focused transition protocol tests**

  Run:

  ```sh
  node --test src/workflow/planning-issue-lock-takeover.test.ts
  ```

  Expected: PASS. Transition ownership has one winner, dead owners are
  reclaimable, delayed observations cannot move a newer owner, archives are
  exact and non-overwriting, and every interruption boundary is resumable.

- [ ] **Step 8: Commit the focused transition protocol**

  ```sh
  git add \
    src/workflow/planning-issue-lock-takeover.ts \
    src/workflow/planning-issue-lock-takeover.test.ts
  git commit -m "feat(run-once): add stale lock takeover protocol"
  ```

---

### Task 2: Reclaim Provably Stale Canonical Planning Locks

**Files:**

- Modify: `src/workflow/planning-issue-lock.ts:1-274`
- Modify: `src/workflow/planning-issue-lock.test.ts:1-276`
- Modify: `src/workflow/planning-state-store.test.ts`

**Interfaces:**

- Consumes: Task 1's generic takeover helper and the existing lock record,
  parser, PID liveness classifier, exclusive create, ownership assertion, and
  release rules.
- Produces: `PlanningIssueLockResource`, `PlanningIssueLockTakeoverEvidence`,
  optional `lock.takeover`, and production acquisition that automatically enters
  takeover only for `stale`.

- [ ] **Step 1: Write the failing exact stale replacement regression**

  Create a canonical ownership directory whose mode-`0600` owner record has
  deterministic exact bytes, old Run ID/ownership ID, current hostname, and a
  PID classified `dead`. Acquire with a different requested Run ID and
  deterministic new ownership ID. Assert:

  ```ts
  assert.equal(lock.record.runId, requestedRunId);
  assert.notEqual(lock.record.ownershipId, staleOwner.ownershipId);
  assert.equal(
    (await stat(join(lock.path, "owner.record"))).mode & 0o777,
    0o600,
  );
  assert.deepEqual(await readFile(lock.takeover!.archivePath), staleBytes);
  assert.deepEqual(lock.takeover, {
    owner: staleOwner,
    fingerprint: sha256(staleBytes),
    sourcePath: canonicalPath,
    archivePath: expectedArchivePath,
  });
  ```

  Then run `assertPlanningIssueLockOwned()` and release the replacement. This is
  red while `acquirePlanningIssueLock()` still throws `issue-lock-stale`.

- [ ] **Step 2: Write the failing no-takeover safety matrix**

  For active same-host, remote-host, locally `unverifiable`, malformed text,
  malformed binary, and a liveness callback that throws, assert acquisition
  leaves the canonical bytes, transition path, and archive tree unchanged.
  Active returns a `PlanningIssueLockConflictError` with
  `resource: "canonical-lock"`; unverifiable/malformed retain their existing
  classifications; unexpected liveness errors reject by object identity.

  Add a PID-reuse case (`processState: () => "alive"`) and assert it remains
  conservative `active`. Do not use age or `acquiredAt` in any authorization
  assertion.

- [ ] **Step 3: Write concurrent rescue and changed-observation tests**

  Start multiple public acquisitions against one stale canonical file with
  distinct requested ownership IDs. Assert exactly one returned lock owns the
  canonical name, no rejected contender removes that winner, one archive holds
  the original bytes, and rejected contenders classify the live canonical or
  live transition owner as `active`.

  Use the helper's deterministic filesystem/checkpoint adapter to change the
  canonical fingerprint/owner after the triggering observation. Assert the
  public acquisition follows the authoritative re-read and never archives or
  removes the obsolete observation. Add archive-collision and external
  replacement races and assert failures preserve both evidence and the other
  owner's canonical bytes.

- [ ] **Step 4: Write interruption recovery through the public API**

  Materialize each Task 1 boundary with real `PlanningIssueLockRecord` values: a
  dead canonical plus dead transition, an identical archive plus canonical, an
  archive with no canonical, and a replacement plus dead transition. Call
  `acquirePlanningIssueLock()` from a later same-host attempt and assert it
  acquires safely or returns `active` for a live replacement. Repeat with a dead
  replacement and assert it can be archived/replaced rather than wedging.

  Retain ownership-ID tests proving an old `PlanningIssueLock` object cannot
  assert or release the replacement. Add a `PlanningStateStore` regression that
  the reclaimed lock can initialize/replace only its own Issue/Run state and the
  stale lock object cannot mutate it.

- [ ] **Step 5: Run canonical lock tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/workflow/planning-issue-lock.test.ts \
    src/workflow/planning-state-store.test.ts
  ```

  Expected before integration: FAIL because stale acquisition still returns a
  conflict and `PlanningIssueLock` has no takeover evidence/resource.

- [ ] **Step 6: Integrate guarded takeover without weakening the fast path**

  Replace the current `open(path, "wx", 0o600)` fast path with staged
  ownership-directory creation: stage a complete private sibling directory
  containing the flushed mode-`0600` owner record, then atomically rename it
  into the canonical path. POSIX rename of a non-empty directory onto an
  existing non-empty directory fails, so the rename is the exclusive-creation
  boundary. Extend the internal observation used by `diagnostic()` so takeover
  receives exact bytes and the full parsed record while public diagnostics
  continue exposing the reduced owner.

  When the canonical rename fails because a canonical owner already exists,
  classify once. Throw the existing conflict immediately for `active`,
  `unverifiable`, and `malformed`. Only for `stale`, create a fresh transition
  owner record and call Task 1's helper with concrete
  observe/serialize/create/conflict callbacks. Attach returned evidence to the
  replacement lock. Preserve the requested Run ID and replacement ownership ID;
  use a distinct transition ownership ID. Add optional deterministic IDs only to
  `PlanningIssueLockOptions` for tests, not a force/recovery switch.

  Set `resource: "canonical-lock"` on canonical observations and
  `resource: "takeover-transition"` on transition conflicts. Do not convert
  archive/replacement filesystem failures into `PlanningIssueLockConflictError`
  or `issue-lock-stale`; let infrastructure errors propagate with their causes
  and preserved evidence.

- [ ] **Step 7: Run focused lock and state-authority tests**

  Run:

  ```sh
  node --test \
    src/workflow/planning-issue-lock-takeover.test.ts \
    src/workflow/planning-issue-lock.test.ts \
    src/workflow/planning-state-store.test.ts
  ```

  Expected: PASS. A proven same-host dead owner is archived and replaced once;
  all other classifications remain non-mutating; stale and replacement lock
  objects cannot authorize state mutation or release.

- [ ] **Step 8: Commit canonical acquisition integration**

  ```sh
  git add \
    src/workflow/planning-issue-lock.ts \
    src/workflow/planning-issue-lock.test.ts \
    src/workflow/planning-state-store.test.ts
  git commit -m "fix(run-once): reclaim stale planning issue locks"
  ```

---

### Task 3: Report Automatic Takeover and Update Recovery Guidance

**Files:**

- Modify: `src/cli/commands/run-once/planning-pipeline-issue.ts:1-298`
- Modify: `src/cli/commands/run-once/planning-pipeline.ts:120-299`
- Modify: `src/cli/commands/run-once/planning-pipeline.test.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline-progress.test.ts`
- Modify:
  `src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts`
- Modify: `test-support/run-once/planning-provider-scenario.ts`
- Modify: `test-support/run-once/planning-provider-recovery-control.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline-diagnostics.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-types.ts`
- Modify: `src/cli/commands/run-once/result-diagnostic-planning.ts`
- Modify: `src/cli/commands/run-once/result-diagnostics.test.ts`
- Modify: `site/src/content/docs/using-patchmill/run-once.md`

**Interfaces:**

- Consumes: Task 2's optional takeover evidence, existing `ProgressReporter`,
  `JsonlProgressReporter`, console reporter, planning-lock failure mapping, and
  Run-once docs.
- Produces: one `planning-lock` warning at either acquisition site before
  post-lock reads/mutations, structured JSONL evidence without raw bytes,
  resource-aware lock diagnostics, an automatic provider recovery regression,
  and updated operator guidance.

- [ ] **Step 1: Write failing initial-acquisition warning/order tests**

  In `planning-pipeline.test.ts`, return a lock with deterministic takeover
  evidence from the injected `acquire`. Record calls from `progress.event`,
  `readIssue`, state/legacy reads, mutation, coordination, and release. Assert
  the warning is the first action after acquisition and occurs before all
  post-lock reads and mutation. Assert exactly the event shape from **Shared
  Interfaces and On-Disk Layout**, including old Run ID, host, PID, acquisition
  time, fingerprint, source/archive paths, and no raw/serialized bytes anywhere
  in `JSON.stringify(event)`.

- [ ] **Step 2: Write failing authoritative-Run-ID retry warning tests**

  Start with an absent expected state so the provisional lock uses the initial
  Run ID, then return saved state with another authoritative Run ID. Make only
  the second acquisition carry takeover evidence. Assert the provisional lock is
  released, one warning is emitted immediately after the second acquisition, and
  the second issue/state/legacy revalidation happens only after the warning.
  Assert a normal acquisition at either site emits no takeover event.

- [ ] **Step 3: Write failing console and JSONL output tests**

  In `planning-pipeline-progress.test.ts`, compose the actual
  `AgentIssueConsoleProgressReporter`, `JsonlProgressReporter`, and collection
  reporter. Install a real dead same-host lock, run the planning facade, and
  assert:
  - stderr contains one prominent `⚠ reclaimed stale planning lock...` line;
  - JSONL contains one `level: "warning"`, `stage: "planning-lock"` event with
    the structured data;
  - JSONL omits `consoleMessage` through the existing reporter behavior;
  - neither sink contains the exact stale JSON bytes; and
  - later planning progress/result behavior remains unchanged.

- [ ] **Step 4: Convert the provider regression from manual to automatic
      recovery**

  Change `installDeadProcessLock()` to return the exact bytes, fingerprint,
  stale ownership ID, canonical path, and expected deterministic archive path.
  Remove `archiveExactStaleLock()` from the scenario surface and recovery
  control. Update both provider matrix cases so the next `scenario.run()`
  directly reaches the prior `review-pending` state instead of returning
  `issue-lock-stale`.

  Read the expected archive and assert it equals the installed bytes, the
  canonical lock is released after the attempt, planning state advances only
  through normal reconciliation, and no fixture performs a manual `rename()`.
  Keep one focused injected-conflict unit test for defensive `issue-lock-stale`
  result mapping; ordinary production acquisition must no longer emit it for a
  dead same-host owner.

- [ ] **Step 5: Write failing resource-aware diagnostic and guidance tests**

  Add `resource: "canonical-lock" | "takeover-transition"` to the shared lock
  diagnostic context and have `planningLockFailure()` copy it. Extend exhaustive
  diagnostic fixtures for active, stale, unverifiable, and malformed conflicts.
  Assert transition conflicts identify the takeover transition resource while
  retaining the existing public reason/status/exit semantics.

  Replace the stale catalog assertion with one proving the defensive entry:
  explains that current acquisition normally performs guarded automatic
  recovery, tells the operator to preserve and inspect reported evidence if the
  defensive result appears, never recommends hand-moving/deleting/editing the
  lock or using lease repair, and uses `inspect-first` rather than claiming an
  immediate retry will necessarily repeat.

- [ ] **Step 6: Run pipeline/output tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected before implementation: FAIL because takeover evidence is not
  reported, provider scenarios still require manual archival, and diagnostics do
  not distinguish transition ownership.

- [ ] **Step 7: Emit the warning at both acquisition boundaries**

  Add `progress?: ProgressReporter` and `now?: () => Date` to
  `PlanningIssueInput`. Implement one small private
  `emitPlanningLockTakeover(lock, input)` helper in
  `planning-pipeline-issue.ts`; return immediately when `lock.takeover` is
  absent. Await it after the initial `acquire()` and after the one allowed
  authoritative-Run-ID reacquisition, before entering/re-entering post-lock
  reads.

  Pass `input.options.progress` and the deterministic attempt clock from
  `runPlanningWorkflow()`. Do not teach generic console/JSONL reporters about
  planning-lock fields; use `consoleMessage` plus structured `data` so their
  existing contracts render and persist the event correctly.

- [ ] **Step 8: Update diagnostics, provider support, and user documentation**

  Thread the diagnostic resource through `planningLockFailure()` and the typed
  context. Keep active canonical/transition conflicts as
  `stopped / issue-locked`; keep unverifiable/malformed conflicts blocked with
  their current reasons and exit behavior.

  Update the provider fixture as specified in Step 4. In the docs recovery
  table, replace manual stale-lock handling with automatic same-host archival
  and continuation. Document the archive root
  `planning-pr-v1/archive/issue-locks/`, the warning/JSONL evidence, archive
  retention, PID-reuse conservatism, and that remote-host, unverifiable,
  malformed, transition-conflict, and infrastructure failures remain
  fail-closed. Retain the statement that lease repair/reset do not authorize
  planning-lock deletion.

- [ ] **Step 9: Run focused pipeline, diagnostics, and docs checks**

  Run:

  ```sh
  node --test \
    src/workflow/planning-issue-lock-takeover.test.ts \
    src/workflow/planning-issue-lock.test.ts \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  npx prettier --check \
    site/src/content/docs/using-patchmill/run-once.md \
    src/cli/commands/run-once/planning-pipeline-issue.ts \
    src/cli/commands/run-once/planning-pipeline.ts
  npx markdownlint-cli2 site/src/content/docs/using-patchmill/run-once.md
  ```

  Expected: PASS. Both acquisition paths warn before post-lock work, provider
  workflows recover without fixture intervention, JSONL contains safe evidence,
  defensive diagnostics remain actionable, and docs are formatted/linted.

- [ ] **Step 10: Commit observability and guidance**

  ```sh
  git add \
    src/cli/commands/run-once/planning-pipeline-issue.ts \
    src/cli/commands/run-once/planning-pipeline.ts \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts \
    test-support/run-once/planning-provider-scenario.ts \
    test-support/run-once/planning-provider-recovery-control.ts \
    src/cli/commands/run-once/planning-pipeline-diagnostics.ts \
    src/cli/commands/run-once/result-diagnostic-types.ts \
    src/cli/commands/run-once/result-diagnostic-planning.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts \
    site/src/content/docs/using-patchmill/run-once.md
  git commit -m "feat(run-once): report stale planning lock recovery"
  ```

---

### Task 4: Run Full Regression and Scope Verification

**Files:**

- Verify: `src/workflow/planning-issue-lock-takeover.ts`
- Verify: `src/workflow/planning-issue-lock.ts`
- Verify: `src/cli/commands/run-once/planning-pipeline-issue.ts`
- Verify: lock, state-store, pipeline, progress, provider, and diagnostic tests
  from Tasks 1-3
- Verify: `site/src/content/docs/using-patchmill/run-once.md`
- Verify unchanged: planning state schema/version, legacy Issue run lease/reset
  behavior, selection/result/exit-code contracts, npm dependencies, and
  unrelated workspace/Git recovery behavior

**Interfaces:**

- Consumes: Tasks 1-3's commits and the implementation-carried spec/plan.
- Produces: fresh focused, Run-once, repository, lint, build, type,
  architecture, dependency/Nix-condition, and final-scope evidence. This task
  creates no validation-only commit when no tracked file changes.

- [ ] **Step 1: Run the focused stale-lock regression command**

  Run exactly:

  ```sh
  node --test \
    src/workflow/planning-issue-lock-takeover.test.ts \
    src/workflow/planning-issue-lock.test.ts \
    src/workflow/planning-state-store.test.ts \
    src/cli/commands/run-once/planning-pipeline.test.ts \
    src/cli/commands/run-once/planning-pipeline-progress.test.ts \
    src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts \
    src/cli/commands/run-once/result-diagnostics.test.ts
  ```

  Expected: PASS with no failed, cancelled, or skipped issue-specific tests.

- [ ] **Step 2: Run the complete Run-once workflow suite**

  Run:

  ```sh
  npm run test:run-once
  ```

  Expected: PASS. Planning acquisition, progress, provider reconciliation,
  diagnostics, legacy recovery boundaries, and unrelated Run-once behavior
  remain green.

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
  Markdown/ESLint errors, TypeScript errors, architecture cycles/violations, or
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

- [ ] **Step 5: Review final scope and safety invariants**

  Run:

  ```sh
  git status --short
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- \
    src/workflow/planning-issue-lock-takeover.ts \
    src/workflow/planning-issue-lock.ts \
    src/cli/commands/run-once/planning-pipeline-issue.ts \
    src/cli/commands/run-once/planning-pipeline-diagnostics.ts \
    src/cli/commands/run-once/result-diagnostic-planning.ts \
    site/src/content/docs/using-patchmill/run-once.md
  git diff --quiet origin/main...HEAD -- \
    src/workflow/planning-state-types.ts \
    src/workflow/planning-state-validation.ts \
    package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: the quiet diff exits `0`; the worktree is clean; the carried spec
  and plan plus scoped source/tests/docs are present. Confirm from the diff that
  only same-host `dead` authorizes takeover, authoritative bytes are re-read,
  archives cannot be overwritten, transition recovery cannot remove a newer
  owner, replacement ownership precedes every downstream mutation, warnings omit
  raw bytes, and unverifiable/malformed records remain fail-closed.

- [ ] **Step 6: Record verification evidence without a new commit**

  Update the Task 4 Issue todo body with each exact command and outcome, any
  residual platform/filesystem risk, and whether the conditional Nix build ran.
  Set that todo to the configured terminal status. Do not amend implementation
  commits or create a validation-only commit when verification changes no
  tracked file.

---

## Self-Review Notes

- **Spec coverage:** Task 1 owns transition serialization, stale-transition
  recovery, authoritative re-observation, atomic non-overwriting evidence,
  races, and every interruption boundary. Task 2 limits entry to proven
  same-host death, preserves existing lock/state authority, and proves one
  replacement under concurrency. Task 3 covers both pipeline acquisition sites,
  console/JSONL evidence, provider-level continuation, resource-aware defensive
  diagnostics, and operator docs. Task 4 runs every validation command named by
  the spec and enforces the repository's conditional Nix requirement.
- **Module boundaries:** Filesystem transition mechanics live in one focused
  workflow helper; canonical record/liveness/ownership behavior remains in the
  existing lock facade; orchestration emits progress at the acquisition
  boundary; generic reporters remain generic; diagnostics and docs own operator
  policy. The callback adapter prevents a runtime import cycle.
- **Type consistency:** `PlanningIssueLockResource`, takeover evidence,
  observation classifications, archive paths, progress data fields, and public
  diagnostic resources use the same names across all tasks. The canonical lock
  remains the only `PlanningStateStore` authority.
- **Testing Value Gate:** New tests cover the production bug, concurrent and
  interrupted recovery, exact forensic evidence, fail-closed classification,
  mutation authority, and externally visible progress. Static prose,
  dependencies, and unchanged schemas are verified directly instead of with
  brittle tests.
- **Placeholder scan:** Every code-changing task names exact files, interfaces,
  red/green commands, expected behavior, minimal implementation boundaries, and
  a Conventional Commit message. No implementation decision is deferred.
