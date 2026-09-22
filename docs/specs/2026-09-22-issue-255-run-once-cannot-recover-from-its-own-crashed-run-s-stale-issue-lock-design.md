# Recover stale planning issue locks automatically

- **Issue:** #255
- **Status:** Proposed design

## Summary

When planning-lock acquisition proves that an existing owner ran on the current
host and its process no longer exists, Patchmill will preserve the exact stale
lock as recovery evidence, acquire a replacement lock, and continue the same Run
attempt. The takeover will be serialized by a short-lived, crash-recoverable
transition owner so concurrent rescuers cannot remove one another's locks.

Active owners will still produce the benign `stopped / issue-locked` result.
Remote-host, locally unverifiable, and malformed records will remain blocking
and untouched. Takeover will use process liveness only; lock age will never
authorize recovery.

## Context

`planning-issue-lock.ts` currently creates `planning-pr-v1/locks/issue-N.lock`
exclusively and classifies a conflict as `active`, `stale`, `unverifiable`, or
`malformed`. The planning pipeline stops normally for `active`, but maps every
other classification to a blocking result. A process crash therefore leaves an
otherwise authoritative `stale` diagnosis that no later Run attempt can repair.

The lock is the mutation authority for strict planning state. Recovery must not
introduce an unlink-and-create gap in which two contenders can both believe they
won. It must also preserve the ownership-ID checks used by state mutation and
release. The separate legacy Issue run lease and its repair command do not own
`planning-pr-v1` locks and will not be reused as planning-lock authority.

This design uses **Issue run**, **Run attempt**, **Run-once workflow**, and
**Run recovery state** as defined in `CONTEXT.md`. No ADR conflicts apply.

## Requirements

- A valid same-host lock whose recorded PID is proven dead is reclaimed during
  acquisition without operator action.
- The exact stale bytes, fingerprint, parsed owner, source path, and archive
  path remain available as recovery evidence.
- Concurrent acquisition and takeover still produce at most one current lock
  owner.
- A crash during takeover cannot create another permanent same-host wedge.
- A live owner is never displaced. PID reuse may conservatively produce
  `active`, but cannot authorize an unsafe takeover.
- Different-host records, permission-denied or otherwise unverifiable local
  liveness, malformed bytes, and unexpected liveness errors remain fail-closed.
- Planning state, labels, Git state, workspaces, and host state are not mutated
  until replacement lock ownership is established and post-lock identity checks
  pass.
- A successful takeover is visible as a warning in console progress and the
  JSONL Run log.

## Non-goals

This change will not:

- add `patchmill unlock`, a force flag, or a general lock-repair command;
- reclaim a lock because it is old;
- infer that an owner on another host has stopped;
- repair malformed lock or transition records;
- change planning state schemas, Run IDs, phase behavior, selection priority,
  result exit codes, or lock release authorization;
- change legacy Issue run lease behavior; or
- delete archived evidence automatically.

## Approaches considered

### Guarded archival and replacement (chosen)

Add a per-issue transition owner around stale-lock archival and replacement. A
transition owner is itself represented by a fully populated, non-empty directory
that can be moved atomically to a deterministic archive path when its same-host
process is proven dead. This makes both the long-lived lock and the short-lived
recovery transaction resumable after a crash.

This approach preserves the current lock record and state-store contract while
closing the concurrent-takeover race.

### Unlink the stale lock and retry exclusive creation

This is small but unsafe. Two processes can inspect the same stale bytes; after
one removes and replaces the file, the other can remove the winner based on its
obsolete observation. A fingerprint check immediately before unlink still has a
time-of-check/time-of-use gap. This approach is rejected.

### Require an operator recovery command

A fingerprint-confirmed command could be safe, but every crash would still
remove the Issue run from unattended rotation until a human intervened. The
same-host dead-process proof already provides the required recovery authority,
so a command adds ceremony without improving the safety boundary. This approach
is rejected.

## Proposed behavior

### Classification remains authoritative

The existing classification rules remain unchanged:

- same host plus successful PID probe: `active`;
- same host plus `ESRCH`: `stale`;
- another host or a local probe that cannot establish liveness: `unverifiable`;
  and
- bytes outside the exact supported schema: `malformed`.

Only `stale` authorizes automatic mutation. An unexpected exception from an
injected or platform liveness probe propagates without changing either lock or
archive state.

### Crash-recoverable transition ownership

Keep the canonical lock file at its current path. Add a sibling transition path
for the issue, implemented as a non-empty ownership directory containing one
strict record. Acquisition stages a complete directory under a unique temporary
name, flushes its record, and atomically renames it to the canonical transition
path. A canonical transition directory is therefore never intentionally exposed
without a parseable owner record.

An existing transition owner is classified with the same host and PID rules:

- `active` returns the non-mutating `issue-locked` stop;
- `unverifiable` or `malformed` blocks and preserves the directory; and
- `stale` atomically moves the whole directory to an archive path derived only
  from the validated issue number and ownership ID, then retries transition
  acquisition.

The archive destination is deterministic for the observed ownership ID and is a
non-empty directory. It is never replaced. A delayed contender therefore cannot
move a newer transition owner using an older observation: its rename encounters
the already populated archive destination and fails closed. This directory
rename is the compare-and-swap boundary that a regular lock-file unlink cannot
provide.

Normal transition release verifies the ownership ID, atomically retires the
whole directory, and removes only the retired private path. No release empties
the canonical directory in place.

### Stale lock takeover

The normal fast path remains exclusive `open(..., "wx", 0o600)`. When that
reports an existing stale lock, acquisition obtains the transition owner and
then starts its decision again from disk:

1. Re-read the canonical lock and fingerprint its exact bytes.
2. If it disappeared, attempt ordinary exclusive creation.
3. If its bytes or owner changed, classify the new record and follow that
   result; never act on the earlier observation.
4. If it is still the same same-host stale owner, atomically move the exact file
   to a controlled archive path such as
   `planning-pr-v1/archive/issue-locks/issue-N/<ownershipId>.lock`.
5. Create the replacement canonical lock with the existing exclusive-create
   protocol and the current Run ID plus a fresh ownership ID.
6. Retire the transition owner only after replacement ownership is established.

Archive names never use unchecked lock text. Existing archive destinations are
not overwritten. If an older Patchmill process or external actor acquires the
canonical name during the archival gap, replacement exclusive creation loses
safely; the contender classifies the new owner instead of removing it.

Interruption remains recoverable at every boundary:

- before archival, the next Run attempt reclaims the dead transition owner and
  reevaluates the still-stale lock;
- after archival but before replacement, the canonical path is absent and the
  next attempt can acquire it normally; and
- after replacement but before transition retirement, the next attempt first
  reclaims the dead transition owner, then applies ordinary liveness rules to
  the replacement lock.

`PlanningIssueLock` will carry optional takeover evidence containing the old
owner, fingerprint, source path, and archive path. Its current canonical path
and new record remain the authority consumed by `PlanningStateStore` and
release.

### Pipeline behavior and observability

Immediately after either initial or authoritative-Run-ID lock acquisition,
`runPlanningIssue()` will emit a warning progress event when takeover evidence
is present. The event will identify the issue, old Run ID, host, PID,
acquisition time, fingerprint, source path, and archive path. It will not
include raw lock bytes. Console progress and the JSONL Run log therefore make an
automatic recovery visible even when the final Run attempt succeeds.

After logging, the pipeline performs its existing post-lock issue, state,
legacy, Run-ID, and eligibility checks. Recovery does not imply that stale
planning state is valid or that the issue is still eligible.

Public outcomes remain:

- active canonical or transition owner: `stopped / issue-locked`;
- unverifiable or malformed canonical or transition owner: the existing blocked
  diagnostic with the exact conflicting path and fingerprint; and
- successfully reclaimed stale canonical owner: no terminal lock failure; the
  Run attempt continues.

`issue-lock-stale` remains a stable catalog entry for historical output and a
defensive failure that could not enter the guarded takeover path, but ordinary
production acquisition will no longer emit it merely because the former owner is
dead. Its documentation must no longer tell operators to hand-move a normal
same-host stale lock. Failures to create an archive or replacement are
infrastructure errors and preserve any source or archived evidence rather than
falling back to deletion.

## Affected components

- `src/workflow/planning-issue-lock.ts` — retain record parsing, classification,
  canonical acquisition, ownership assertion, and release; return optional
  takeover evidence.
- A focused workflow helper, rather than further growing the lock module — own
  transition-directory staging, classification, archival, retirement, and
  stale-file takeover.
- `src/cli/commands/run-once/planning-pipeline-issue.ts` — emit the takeover
  warning for both acquisition sites before post-lock mutations.
- Planning lock and pipeline diagnostics — distinguish the canonical lock from
  transition ownership while preserving active, unverifiable, and malformed
  public outcomes.
- `site/src/content/docs/using-patchmill/run-once.md` — document automatic
  same-host stale recovery, archived evidence, and the remaining fail-closed
  cases.
- Focused lock, pipeline, progress, and diagnostic tests.

No dependency or configuration change is planned.

## Verification strategy

These tests pass the Testing Value Gate because they protect concurrency, crash
recovery, preserved evidence, state-mutation authority, and public safety
behavior.

### Lock protocol tests

- Prove a same-host dead owner is archived byte-for-byte and replaced with a
  distinct ownership ID while retaining the requested Run ID and mode `0600`.
- Prove active, remote-host, locally unverifiable, malformed, and exceptional
  liveness cases leave canonical bytes unchanged.
- Start concurrent stale takeovers and assert that exactly one canonical owner
  wins, no contender removes that winner, and only one archive preserves the
  stale bytes.
- Inject interruption before archival, after archival, after replacement, and
  before transition retirement; a later same-host acquisition must recover or
  safely report the live replacement.
- Prove active transition ownership stops without mutation, stale transition
  ownership is archived and recovered, and unverifiable or malformed transition
  ownership blocks unchanged.
- Prove archive collisions, changed fingerprints, changed owners, and
  replacement races fail without overwriting evidence or another owner.
- Retain ownership-ID tests showing that only the current owner can mutate state
  or release the canonical lock.

### Pipeline and output tests

- Reproduce a crashed planning owner and verify the next Run attempt reaches
  post-lock revalidation instead of returning `issue-lock-stale`.
- Verify takeover emits one warning with owner, fingerprint, and archive paths
  to console progress and JSONL, without exposing raw bytes.
- Cover takeover on the provisional acquisition and on the one allowed retry
  with the authoritative saved Run ID.
- Verify active contention still returns successful `stopped / issue-locked`
  with no issue, state, Git, workspace, or host mutation.
- Verify unverifiable and malformed lock or transition records retain their
  existing blocked status, diagnostic details, and exit code.

Run focused planning-lock and planning-pipeline tests first, followed by:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run check:types
npm run check:architecture
git diff --check
```

No npm dependency change is planned, so the repository-required Nix build is not
needed. If implementation changes `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json`, it must also run the Nix build required by `AGENTS.md`.

## Success criteria

A Run attempt that dies while owning a planning issue lock no longer permanently
wedges that Issue run. A later same-host Run attempt preserves the stale
evidence, acquires one replacement lock under concurrency, logs the takeover,
and resumes normal post-lock validation. Live, remote, unverifiable, and
malformed ownership remain fail-closed, and no recovery path can delete a newer
owner's lock based on an obsolete observation.
