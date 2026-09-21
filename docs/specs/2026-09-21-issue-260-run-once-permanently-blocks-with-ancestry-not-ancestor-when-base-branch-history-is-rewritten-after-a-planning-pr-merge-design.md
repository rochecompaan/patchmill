# Recover planning merges after base-history rewrites

- **Issue:** #260
- **Status:** Proposed design

## Summary

When a planning pull request is recorded as merged but its forge-reported merge
commit is no longer an ancestor of the freshly fetched base branch, Patchmill
will attempt one narrow, evidence-gated recovery. It will require the current
base to contain exactly one candidate for every artifact in the phase, require
each candidate to be the saved expected path, and verify those paths as regular
files at the fetched base commit. If that proof succeeds, the phase completes
with the forge merge commit retained as provenance and the current base commit
recorded as the durable artifact anchor.

Only `PlanningPublicationGitError("ancestry", "not-ancestor")` from the
post-merge ancestry check enters recovery. Invalid input, Git command failures,
malformed responses, fetch failures, and unrelated errors continue to fail
closed. Missing, ambiguous, mismatched, or non-regular current-base evidence
becomes an actionable `blocked` result rather than an opaque hard error.

## Context

The planning reconciler currently cleans up the phase workspace, fetches the
saved base branch, and then requires the forge's `mergeCommit` to be an ancestor
of the fetched base tip. It checks artifact paths only after that ancestry
assertion. An amend, rebase, or force-push can therefore make the recorded merge
commit unreachable even when the reviewed artifacts remain unchanged on the base
branch.

The existing completion shape already distinguishes the two facts needed for
recovery:

- `completion.mergeOid` records the merge commit reported by the forge; and
- `completion.mergedBaseOid` records the fetched base tip that holds the
  authoritative artifact evidence.

However, implementation-base validation currently treats the phase's original
base, `mergeOid`, and `mergedBaseOid` as ancestry anchors. Keeping the first two
checks after recovery would only move the same failure into the implementation
phase.

## Goals

- Recover automatically only from the exact post-merge `ancestry/not-ancestor`
  condition.
- Re-anchor a merged phase only when the freshly fetched base provides
  unambiguous evidence for every expected phase artifact.
- Persist completion at the fetched base so the next Run attempt does not repeat
  the stale merge-commit check.
- Preserve the forge merge commit as provenance without treating it as a
  permanent ancestry requirement.
- Keep insufficient evidence resumable and explain the safe operator action.
- Preserve hard failures for invalid inputs, Git execution failures, malformed
  responses, and all unrelated error classes.
- Let implementation preparation accept the recovered anchor while continuing to
  validate every prior artifact on the current base.

## Non-goals

This change will not:

- ignore ancestry failures generally or weaken pre-merge publication checks;
- compare the rewritten base with the old planning workspace blob, because the
  reviewed pull request may legitimately have changed the artifact before merge;
- accept a renamed artifact or choose among multiple issue artifact candidates;
- mutate, reset, force-push, or restore the base branch;
- add a manual state-editing command or advise operators to edit planning state;
- change planning pull request identity, cleanup ordering, labels, or review
  gates; or
- change the `planning-pr-v1` state version or completion schema.

## Approaches considered

### Evidence-gated automatic re-anchoring (chosen)

Catch only the typed ancestry mismatch, prove the saved artifact paths on the
fresh base, and persist `mergedBaseOid` at that base. This restores progress for
history-only rewrites while retaining a fail-closed boundary when the tree no
longer supplies exact evidence.

### Always block for manual repair

An actionable blocker would be better than the current raw error, but no
supported command can repair the saved anchor. Operators would still have to
rewrite Git history back or hand-edit state, so the Issue run would remain
operationally wedged. This is rejected as incomplete.

### Ignore the forge merge anchor for every merged pull request

Always trusting the current base would be simple, but it would erase the normal
proof that the observed merge reached the configured base branch. Recovery must
remain exceptional and must run only after the normal check reports the exact
typed non-ancestor result.

## Proposed behavior

### Normal merged reconciliation

The normal path remains unchanged:

1. Finish owned workspace cleanup.
2. Fetch the phase's saved remote and base branch.
3. Assert that the forge-reported merge commit is an ancestor of the fetched
   base tip.
4. Assert every saved artifact path is a regular file at both the merge commit
   and fetched base tip.
5. Persist merged completion and remote-base artifact evidence at the fetched
   tip.

No candidate fallback runs when the ancestry assertion succeeds.

### Recovery detection

Wrap only step 3. Recovery begins only when the thrown value is a
`PlanningPublicationGitError` whose `operation` is `ancestry` and whose `reason`
is `not-ancestor`.

Every other value propagates unchanged, including:

- `ancestry/invalid-input` and `ancestry/command-failed`;
- malformed Git responses;
- remote-base fetch and inspection failures; and
- untyped or unrelated errors.

This distinction prevents infrastructure failures from being mistaken for a safe
history rewrite.

### Current-base artifact proof

For each saved artifact in the phase, recovery reads
`snapshot.artifactCandidates[artifact.kind]` and requires:

1. exactly one candidate exists;
2. that candidate equals the saved `artifact.path`; and
3. the expected path is a regular file at `snapshot.baseOid`.

The checks apply independently to every artifact kind assigned to a combined
phase. Candidate order cannot select an artifact. A sole candidate at a
different path is a mismatch, not a rename to adopt.

After candidate resolution, one `assertRegularFiles` call verifies all expected
paths at the pinned fetched base. A typed `tree/non-regular-file` result means
the evidence is insufficient and is classified as a blocker. Invalid-input,
command-failed, and malformed-response errors still propagate.

Recovery deliberately does not require the stale merge object to remain
available or inspect artifact paths at that object. The saved path plus the
fresh snapshot's issue-scoped candidate set and regular-file proof form the new
boundary. This matches the existing rule that merged-base files, including human
review edits, are authoritative rather than the old workspace blobs.

### Durable completion

Successful recovery uses the existing merged completion shape:

```ts
completion: {
  kind: "merged-pull-request";
  mergeOid: pullRequest.mergeCommit; // forge provenance
  mergedBaseOid: snapshot.baseOid; // effective artifact anchor
}
```

Every phase artifact becomes `source: "remote-base"` with
`commitOid: snapshot.baseOid`. The original phase `base` remains immutable
workspace-start evidence. The normal locked, revisioned state replacement is the
only persistence point; no completion is returned before it succeeds.

No schema migration is needed. A later Run attempt sees a complete phase and
will not repeat reconciliation against the stale forge merge commit.

### Insufficient evidence

Missing, ambiguous, path-mismatched, or non-regular evidence returns a dedicated
reconciliation outcome. The planning phase runner maps it to `status: "blocked"`
with the new stable reason `planning-merge-recovery-blocked`. Diagnostic context
includes:

- issue and phase;
- pull request URL;
- saved base branch;
- forge merge commit and fetched base commit;
- evidence failure (`missing`, `ambiguous`, `path-mismatch`, or
  `non-regular-file`);
- artifact kind and saved expected path; and
- observed candidate paths.

The diagnostic tells the operator to restore exactly one regular artifact at the
saved path through normal reviewed changes on the configured base branch, then
rerun `patchmill run-once --issue N`. It warns against hand-editing state,
arbitrarily choosing a candidate, or restoring stale history merely to satisfy
the old SHA. Retry is `after-action`; an immediate retry is expected to produce
the same blocker.

The phase remains `pull-request-open` with completed cleanup evidence and no
completion replacement, so it is safely resumable. A blocker is not reported as
an unexpected run error.

### Downstream implementation-base validation

For ancestry, completed planning phases contribute only their effective base
anchor:

- `remote-base` completion uses `phase.base.baseOid`; and
- `merged-pull-request` completion uses `phase.completion.mergedBaseOid`.

When more than one planning phase precedes implementation, only the newest
completed planning anchor needs to be an ancestor of the freshly fetched
implementation base. That anchor represents the latest base snapshot from which
planning advanced. The forge `mergeOid`, original workspace base, and superseded
earlier planning anchors remain provenance, not ongoing ancestry requirements.

The implementation-base gate still resolves every artifact from every completed
planning phase against the fresh snapshot, requires exactly one candidate at the
saved path, and verifies all paths as regular files on the implementation base.
Thus dropping stale historical anchors does not permit deleted, renamed,
ambiguous, or non-regular planning artifacts to pass. If the recovered phase is
the newest phase, its `mergedBaseOid` equals the re-anchored base and the next
phase can proceed without revisiting the unreachable forge SHA.

## Components

- `planning-phase-reconciler.ts` — distinguish the exact recoverable ancestry
  error, invoke current-base proof, persist recovered completion, and return a
  typed blocked outcome when proof is insufficient.
- A focused merge-recovery module under `src/cli/commands/run-once/` — own
  candidate/path classification and regular-file recovery proof rather than
  growing the already multi-stage reconciler.
- `planning-phase-runner-planning.ts` — translate the new reconciliation blocker
  into the public blocked result without changing normal merged advancement.
- `planning-implementation-base.ts` — derive the newest effective planning
  anchor and retain all-prior-artifact candidate and regular-file checks.
- `result-diagnostic-types.ts`, `result-diagnostic-planning.ts`, and catalog
  fixtures — add the stable blocked reason, typed context, actionable guidance,
  and exhaustive diagnostic coverage.
- Focused reconciler, phase-runner, implementation-base, and real-Git tests.

The state types, codec, and transition schema should remain unchanged unless
implementation reveals an invariant not represented by the existing
`mergeOid`/`mergedBaseOid` distinction.

## Verification strategy

These tests pass the Testing Value Gate because they protect recovery from a
production deadlock, Git safety classification, durable state evidence, and the
boundary that unlocks implementation.

### Unit coverage

- A typed `ancestry/not-ancestor` followed by one exact candidate per artifact
  and successful regular-file proof completes the phase at the fetched base.
- Recovery retains the forge `mergeOid`, rewrites artifact evidence to the
  fetched `mergedBaseOid`, performs one durable completion replacement, and
  never inspects workspace blobs.
- Zero candidates, multiple candidates, a sole different path, and a non-regular
  expected path each return the actionable blocked outcome without completing
  the phase.
- `ancestry/command-failed`, `ancestry/invalid-input`, fetch failures,
  regular-file command failures, malformed responses, and unrelated errors
  propagate unchanged and do not enter recovery.
- The ordinary ancestor path retains merge-commit and fetched-base regular-file
  checks in the existing order.
- Phase-runner tests assert the new stable reason and complete diagnostic
  context rather than an `unexpected-error` fallback.
- Implementation-base tests prove merged phases use only the newest
  `mergedBaseOid` ancestry anchor, remote-base completion uses its base anchor,
  stale merge/original/earlier anchors are not checked, and every prior artifact
  is still candidate-matched and verified on the current base.
- Diagnostic catalog tests cover the new reason's action, safety, and
  `after-action` retry contract.

### Real-Git regression

Use a temporary repository and bare remote to:

1. create and publish a planning artifact;
2. squash-merge it to the base and retain that commit as the host-reported merge
   SHA;
3. amend the base commit message and force-push the rewritten commit without
   changing the artifact tree;
4. reconcile successfully against the fresh rewritten base;
5. assert durable artifact evidence and `mergedBaseOid` point to the rewritten
   commit while `mergeOid` remains the host SHA; and
6. run the implementation-base gate against a fresh snapshot and prove the next
   phase is allowed to prepare.

The regression must fail under the pre-fix ancestry behavior.

### Final validation

Run focused tests first, followed by:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run check:types
npm run check:architecture
git diff --check
```

No dependency change is planned, so the repository's dependency-triggered Nix
build is not required.

## Success criteria

A planning pull request whose recorded merge commit was replaced by a
history-only rewrite can complete from exact regular-file evidence on the
freshly fetched base. Its durable completion anchors artifacts to that base, and
implementation preparation does not reassert stale ancestry. Missing, ambiguous,
renamed, or non-regular evidence produces an actionable resumable blocker, while
non-ancestry Git failures remain hard errors and all normal merge verification
stays intact.
