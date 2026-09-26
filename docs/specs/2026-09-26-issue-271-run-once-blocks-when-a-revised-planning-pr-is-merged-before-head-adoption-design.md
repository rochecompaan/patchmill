# Reconcile revised planning pull requests merged before head adoption

- **Issue:** #271
- **Status:** Proposed design

## Summary

Planning reconciliation will classify a stably identified pull request before it
requires source-branch head adoption. Open pull requests will keep the existing
strict adoption proof. A merged pull request will instead be reconciled from its
immutable pull-request identity, forge-reported merge commit, and freshly
fetched target-base evidence.

This lets a spec or plan phase complete when its head changed from recorded head
`A` to reviewed head `B`, the pull request merged, and the source branch was
deleted before another Run attempt observed `B`. The terminal path will not
pretend that the deleted source branch still exists or rewrite durable
publication evidence merely to pass cleanup.

Pull-request identity, repository ownership, saved artifact paths, and
regular-file checks remain fail-closed. Insufficient merge or target-base
evidence becomes an actionable, resumable blocker whose repair can be made on
the target base after merge.

## Context

Issue #252 added safe adoption for revised planning heads. Its adoption helper
requires the live source branch, agreement among the source branch, host head,
and fetched candidate, fast-forward ancestry from the recorded head, and an
artifact-only diff. That is the correct boundary while a planning pull request
is open.

Reconciliation currently invokes that helper before inspecting the validated
pull request's status. A merged pull request whose host head is `B` therefore
tries to adopt `B` from the source branch before reaching merge reconciliation.
If the host has deleted that branch, adoption returns `remote-missing`, even
though:

- stable validation has identified the saved pull request and permits its exact
  server-side `refs/pull/<number>/head` identity after merge;
- the forge reports the merge commit; and
- the fetched target base can provide authoritative artifact evidence.

The source branch is publication transport. After merge, the merge commit and
target base are the relevant artifact boundary. Requiring the transport branch
at that point makes a normal host cleanup action an unrecoverable dependency.

## Goals

- Complete a merged planning phase when its reviewed head changed before
  adoption and its source branch was subsequently deleted.
- Classify the validated pull-request status before selecting open-head or
  merged-artifact proof.
- Preserve all existing checks for pull-request reference and URL, ownership
  marker, target and head repositories, base branch, saved head-branch identity,
  and repository ownership policy.
- Prove terminal artifacts only at their saved paths and only as regular files
  using the merge commit and freshly fetched target base.
- Permit local phase-workspace cleanup without a live source branch only after
  terminal merge evidence succeeds.
- Return a stable blocker with a repair available through normal reviewed
  target-base changes when terminal evidence is insufficient.
- Keep retries and durable state transitions interruption-safe.

## Non-goals

This change will not:

- weaken source-branch adoption for an open pull request;
- treat a merged pull request as valid before stable identity validation;
- accept a closed-unmerged pull request;
- infer or rename artifact paths from arbitrary tree contents;
- accept symlinks, submodules, directories, or missing artifact paths;
- recreate, force-push, or require restoration of a deleted source branch;
- mutate target-base history or hand-edit planning state;
- change implementation pull-request reconciliation; or
- require a new planning-state version or completion shape.

## Approaches considered

### Status-aware terminal reconciliation (chosen)

Validate stable pull-request identity, branch on status, and use the existing
merge/base proof for a merged pull request without first adopting its head. Run
terminal proof before allowing source-independent local cleanup. This follows
the evidence that remains authoritative after merge and directly removes the
ordering defect.

### Adopt from the server-side pull ref

Patchmill could fetch `refs/pull/<number>/head`, add a second adoption policy,
and checkpoint `B` before continuing. This adds provider-sensitive Git behavior
and must define how rebased or squash-merged heads replace workspace and cleanup
OIDs. It also records intermediate publication evidence that terminal
reconciliation does not need. The merge/base path already supplies the stronger
post-review boundary, so this is unnecessary.

### Require source-branch restoration

An operator could recreate the source branch at `B` and retry the existing
adoption path. That leaves unattended runs blocked by routine post-merge branch
cleanup and provides no safety advantage once merge/base evidence is sufficient.
This is rejected.

## Proposed behavior

### Validate identity before status

Reconciliation will continue to read the saved pull-request reference and call
`validatePlanningPullRequestIdentity()` before acting on status. The validator
must retain all current stable checks:

- target and head repository identities and publication repository policy;
- saved base branch;
- saved head branch, with only the existing exact `refs/pull/<number>/head`
  exception for merged or closed pull requests;
- issue/phase ownership marker;
- canonical URL; and
- saved pull-request reference.

Only a head SHA mismatch remains exempt from stable validation. Any other
mismatch stays a hard planning pull-request validation failure and must not
enter merged recovery or be relabeled as missing source evidence.

### Select proof by pull-request status

After validation:

- **Open:** preserve the current source-branch adoption path. A changed head
  still requires source/host/fetched-head agreement, fast-forward ancestry,
  artifact-only changes, regular artifacts, coherent local recovery, and atomic
  durable adoption before returning `review-pending`.
- **Closed unmerged:** preserve the existing closed-unmerged blocker. Merge
  evidence cannot authorize it.
- **Merged:** do not call source-branch head adoption and do not inspect the
  source branch as a prerequisite. Enter terminal merge reconciliation with the
  validated pull request, its reported `mergeCommit`, the phase's saved artifact
  paths, and the saved target-base identity.

This distinction is status-driven, not failure-driven. Patchmill must not first
attempt adoption, observe `remote-missing`, and then reinterpret that failure as
a merge. That would retain the ordering race and could hide unrelated adoption
failures.

### Prove the merged artifact before cleanup

For a merged pull request, terminal proof runs before source-independent local
cleanup:

1. Fetch the saved remote and target base branch into the normal pinned base
   snapshot.
2. Require the forge merge commit to be an ancestor of the fetched base tip.
3. Require every saved artifact path to be a regular file at both the merge
   commit and fetched base tip.
4. If the normal proof reports only typed `ancestry/not-ancestor` or
   `tree/non-regular-file` evidence insufficiency, run the issue #260
   current-base recovery: require exactly one candidate for each artifact kind,
   require each candidate to equal its saved path, and verify every saved path
   as a regular file at the fetched base. This makes a reviewed target-base
   repair usable even though the immutable merge object cannot be changed.
5. Only after the normal or current-base proof succeeds may reconciliation clean
   local phase resources and persist merged completion.

The proof uses the artifact kinds and paths already stored on the phase. It does
not adopt paths discovered from the merged tree. The merge OID remains forge
provenance when current-base recovery succeeds; the fetched base is the artifact
anchor. Command failures, malformed Git output, invalid object IDs, host
failures, and untyped errors continue to propagate as infrastructure or
consistency failures rather than being treated as insufficient artifact
evidence.

The normal completion stays unchanged:

```ts
completion: {
  kind: "merged-pull-request";
  mergeOid: pullRequest.mergeCommit;
  mergedBaseOid: snapshot.baseOid;
}
```

Each artifact becomes `source: "remote-base"` at `mergedBaseOid`. The recorded
publication and workspace head remain `A`; they describe Patchmill's original
publication checkpoint. `B` does not need to become durable workspace evidence
after the reviewed result has been anchored to the target base.

### Clean up without the deleted source branch

The cleanup helper will distinguish its existing publication cleanup from a
terminal cleanup authorized by successful merged evidence.

Publication cleanup continues to require the live source branch to equal the
recorded publication head. Terminal cleanup may skip only that remote-head
precondition. It must still enforce:

- saved Run ID, phase, branch, and worktree ownership;
- the expected local workspace state and recorded local head;
- cleanliness and ignored-content preservation;
- ordered `ready`/`cleanup-pending` to `worktree-removed` to `removed`
  checkpoints; and
- compare-safe local branch removal.

Terminal cleanup never deletes or changes a remote ref. If ignored worktree
content remains, reconciliation returns the existing cleanup-pending outcome and
does not complete the phase. A retry revalidates the merged pull request and
repeats terminal evidence before resuming cleanup.

If proof fails, no cleanup or completion checkpoint occurs. This ordering keeps
the saved workspace available when terminal evidence is not yet authoritative.

### Insufficient terminal evidence

Expected evidence insufficiency returns the existing stable
`planning-merge-recovery-blocked` reason rather than
`planning-head-adoption-blocked` or `unexpected-error`. Generalize its context
and wording from base-history rewrites to terminal merged evidence, including:

- issue and phase;
- canonical pull-request URL and reference;
- host head SHA and recorded publication head;
- forge merge commit, fetched base branch, and fetched base OID;
- failure classification and evidence source;
- saved artifact kinds and paths; and
- observed target-base candidates when relevant.

Missing, ambiguous, path-mismatched, or non-regular target-base evidence tells
the operator to restore exactly one regular artifact at each saved path through
a normal reviewed change on the configured target base, then rerun the Issue.
The generalized current-base recovery is the supported post-merge route for
proving that repaired state. Guidance must not ask the operator to recreate the
deleted source branch, force-restore `A`, edit planning state, or choose an
ambiguous candidate.

Evidence blockers use `after-action`. Infrastructure and malformed-response
failures remain hard errors.

## Durable state and interruption behavior

No schema migration is required. The existing phase state already separates:

- original publication provenance in `publication.headOid` and
  `workspace.headOid`;
- forge provenance in `completion.mergeOid`; and
- authoritative artifact evidence in `completion.mergedBaseOid` and the
  remote-base artifact OIDs.

The existing revision-checked `replacePlanningPhase()` call remains the only
completion write. Cleanup checkpoints remain individually durable. Interruption
before proof changes nothing; interruption during cleanup resumes from the last
cleanup checkpoint; interruption after cleanup but before completion repeats
identity and merge/base proof and then performs the missing completion write.

## Affected components

- `planning-phase-reconciler.ts` — validate identity, classify status before
  adoption, run merged proof before terminal cleanup, and return typed evidence
  blockers.
- `planning-phase-cleanup.ts` — expose a narrowly authorized terminal cleanup
  path that omits only the source-remote equality precondition after successful
  merge proof.
- `planning-merge-recovery.ts` — own exact current-base candidate and
  regular-file recovery after typed normal merge-proof insufficiency.
- `planning-head-adoption.ts` and `planning-head-adoption-git.ts` — retain the
  strict open-pull-request behavior; they should not gain a deleted-branch or
  post-merge exception.
- `result-diagnostic-types.ts`, `result-diagnostic-planning.ts`, and diagnostic
  catalog tests — represent the stable post-merge evidence blocker and feasible
  target-base repair.
- Focused reconciler, cleanup, phase-runner, validation, diagnostic, and
  real-Git tests.

## Verification strategy

These tests pass the Testing Value Gate because they protect a production
recovery deadlock, the human review boundary, destructive cleanup ordering, and
artifact provenance used by the next phase.

### Regression coverage

Extend the issue #252 real-Git scenario so there is no reconciliation while the
pull request is open:

1. publish recorded head `A`;
2. revise or rebase the planning branch to `B` from a second checkout;
3. merge `B` to the configured target base;
4. delete the remote source branch;
5. make the host fixture report the saved merged pull request, head `B`, its
   exact server-side pull ref, and the merge commit; and
6. reconcile from durable state still pinned to `A`.

Assert that reconciliation does not inspect or adopt the deleted source branch,
fetches the target base, proves regular artifacts at the merge/base boundary,
finishes cleanup, completes the phase, and anchors artifacts to `mergedBaseOid`.
The test must fail with pre-fix `remote-missing` behavior.

Cover both a normal merge ancestor and the existing rewritten-base recovery
where practical. The normal deleted-branch case is the required regression.

### Safety and sequencing tests

- A revised open pull request still invokes strict head adoption and still
  returns `planning-head-adoption-blocked` when its source branch is missing.
- A merged revised pull request selects terminal proof before any source-head
  observation or local cleanup.
- Target/head repository, base/head branch, ownership marker, URL, and saved
  reference mismatches fail before status handling and never enter merged proof.
- The server pull-ref exception accepts only the exact saved pull-request number
  and remains invalid for an open pull request.
- Normal merged proof checks every saved path at both merge and fetched-base
  commits.
- Typed ancestry or regular-file insufficiency enters current-base recovery,
  which still requires one exact candidate per artifact kind and regular files
  at the saved paths.
- Insufficient expected evidence returns the stable blocker without adoption,
  cleanup, or completion; its diagnostic proposes reviewed target-base repair.
- Git command failures, malformed output, invalid inputs, host failures, and
  state-store conflicts retain their hard-failure classes.

### Cleanup and retry tests

- Successful terminal proof permits cleanup from each existing cleanup
  discriminator without consulting the deleted remote source branch.
- Failed proof leaves local resources and durable state unchanged.
- Ignored worktree content remains preserved and returns the existing
  cleanup-pending result.
- Failure at either cleanup checkpoint resumes idempotently and repeats terminal
  evidence before completion.
- A failed completion write after cleanup is repaired on retry without restoring
  the source branch.
- Local ownership, dirty-worktree, head, or registration conflicts remain
  workspace conflicts and are never reset or removed automatically.

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

No dependency change is planned, so the dependency-triggered Nix build is not
required.

## Success criteria

A planning pull request revised from `A` to `B`, merged before adoption, and
cleaned up by deleting its source branch no longer wedges the Issue run. Open
pull requests retain strict source-branch adoption. Merged phases advance only
after stable pull-request identity and merge/base artifact proof, and
insufficient evidence produces an actionable post-merge blocker without
destructive cleanup or unsafe state mutation.
