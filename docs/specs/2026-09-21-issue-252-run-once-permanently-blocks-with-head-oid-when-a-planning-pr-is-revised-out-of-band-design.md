# Recover planning pull requests after safe out-of-band head revisions

- **Issue:** #252
- **Status:** Proposed design

## Summary

When a published spec or plan pull request advances beyond Patchmill's recorded
head, Patchmill will distinguish stable pull request identity from mutable head
evidence. It will automatically re-adopt a new head only when the pull request
still has the saved repository, branch, marker, reference, and URL identity and
Git proves that the new remote head is a fast-forward descendant whose net
changes are limited to the phase's planning artifacts.

A successful adoption atomically re-anchors every head-dependent durable field
before cleanup or status handling continues. An open pull request remains
`review-pending`, so its revised content still requires human review and merge.
A merged pull request still must pass the existing merge/base and artifact
proof; the adopted branch head never substitutes for merged-base evidence.

Identity mismatches remain hard validation failures. A head that cannot be
adopted safely becomes an actionable `blocked` result rather than an unexpected
`head-oid` error. Recovery never requires editing state, discarding the
revision, or force-pushing the saved head.

## Context

`validatePlanningPullRequestSummary()` currently treats the recorded head OID as
part of otherwise stable pull request identity. Both publication and
reconciliation invoke that validator before classifying the pull request, and
cleanup independently requires the remote branch to equal the same OID. A human
can therefore make a legitimate artifact-only revision on the owned branch, but
Patchmill has no transition that can verify and checkpoint it.

The durable phase also repeats the head in several places:

- `publication.headOid`;
- `workspace.headOid`;
- each workspace-backed `artifact.commitOid`; and
- `workspace.cleanup.pushedHeadOid` after worktree removal.

Changing only one field would make the state invalid or leave a later cleanup
retry pinned to the obsolete object. Recovery must treat these values as one
coordinated evidence transition.

The `planning-pr-v1` workflow deliberately does not use legacy spec or plan
approval labels. Its supervision boundary is the planning pull request itself:
an open revision cannot advance until a human merges it, and a merged revision
cannot advance until Patchmill proves the authoritative artifacts on the fetched
base.

## Goals

- Recover open and merged planning pull requests after a safe human revision.
- Retain all repository, base/head branch, ownership marker, canonical URL, and
  saved reference checks.
- Adopt only a fetched remote head that agrees with the host and is a
  fast-forward, artifact-only revision of the recorded head.
- Keep publication, workspace, artifact, and cleanup OIDs coherent through
  interruption and retry.
- Preserve the human merge gate and existing merged-base artifact verification.
- Return actionable blocked guidance when a changed head is not safely
  adoptable.
- Keep command, transport, malformed-response, and unrelated identity failures
  fail-closed.

## Non-goals

This change will not:

- ignore head changes or accept arbitrary commits on a planning branch;
- use legacy approval labels as authorization for `planning-pr-v1`;
- adopt a force-pushed, rebased, unrelated, or code-changing head;
- reset, force-push, delete, or recreate the remote branch;
- trust an open pull request revision as an approved implementation input;
- compare final merged artifacts with the original workspace blobs;
- add a state-editing recovery command; or
- change implementation pull request validation, whose local/remote/host head
  equality remains strict.

## Approaches considered

### Evidence-gated automatic adoption (chosen)

Validate immutable pull request identity, fetch the exact remote branch, prove
fast-forward ancestry and artifact-only changes, reconcile any surviving local
workspace safely, then atomically checkpoint the new head. This fixes unattended
recovery while preserving the existing review and merged-base boundaries.

### Explicit operator adoption command

A command such as `patchmill adopt-planning-head` would make authorization
visible, but it would add a new state-mutating interface and leave unattended
runs wedged until an operator invokes it. The same Git and identity proof would
still be required. This is unnecessary when an open pull request still requires
merge review and a merged pull request still requires base evidence.

### Ignore or overwrite the recorded head

Dropping the comparison, or copying the host SHA without Git proof, would allow
rewritten history and unrelated files to cross the publication boundary. It
would also leave cleanup and artifact evidence inconsistent. This is rejected.

## Proposed behavior

### Separate stable identity from exact head validation

Refactor planning pull request validation into two explicit layers:

1. **Stable identity validation** checks target and head repository, saved base
   and head branch, issue/phase ownership marker, canonical URL, and optional
   saved reference. The existing merged/closed server pull-ref exception remains
   limited to the expected pull request number.
2. **Exact head validation** additionally requires `summary.headSha` to equal
   `publication.headOid`.

Existing callers that require immutable head equality continue to use the exact
layer. Spec/plan publication and reconciliation use the stable layer first. If
the head is exact, behavior is unchanged. If only the head differs, they enter
the adoption decision. Any other validation reason remains a
`PlanningPullRequestValidationError` and must not be relabeled as a recoverable
head change.

A `branch-pushed` phase may adopt only after exhaustive discovery finds one
matching pull request and a read-back confirms its stable identity. If no pull
request exists, a changed branch is not supervised and remains blocked. The
read-back reference and the adopted head may be persisted together in the single
`branch-pushed` to `pull-request-open` replacement, closing the
interrupted-create checkpoint gap without accepting an anonymous remote branch.

### Prove an adoptable head

For an open or merged pull request with a different host head SHA, a focused Git
operation will:

1. inspect and fetch the saved remote's exact saved head branch into an internal
   evidence ref without checking it out or updating the remote branch;
2. require the fetched OID, the current remote branch OID, and the host
   `headSha` to be identical;
3. require the recorded `publication.headOid` to be an ancestor of the candidate
   OID;
4. diff the recorded and candidate commits and require every changed path to be
   one of the phase's saved artifact paths; and
5. require every saved artifact path to be a regular file at the candidate.

The diff is a net-tree safety check. Multiple human commits and an empty commit
are acceptable, but a rename, deletion, symlink, submodule, or any non-artifact
change is not. Since ancestry starts at the recorded publication head, the proof
also retains the already-verified phase base ancestry.

The final remote observation must still equal the candidate before the durable
checkpoint. If it moves again, Patchmill performs no state replacement and
returns the typed head-adoption blocker; a later run may evaluate the newer head
from the same rules. There is no unbounded same-attempt retry loop.

A typed `not-ancestor`, unexpected-path, non-regular-artifact, missing-remote,
or host/remote disagreement is an unsafe-adoption result. Invalid input, Git
command failure, malformed Git output, host failure, and state conflict continue
to propagate as infrastructure or consistency errors rather than being mistaken
for an unsafe human revision.

### Reconcile surviving local workspace evidence

Most published planning phases have already removed their local worktree and
branch. Interrupted publication can leave cleanup at `ready`, `cleanup-pending`,
or `worktree-removed`, so adoption must cover each durable checkpoint.

After remote proof and before state replacement:

- For `ready` or `cleanup-pending`, require the owned workspace to be clean and
  at the recorded head, the exact candidate, or a proven intermediate on that
  same fast-forward chain. Fast-forward it to the candidate without reset or
  force, preserving ignored content for the existing cleanup-pending flow.
- For `worktree-removed`, advance an existing owned local branch with a
  compare-and-swap update only when it is on the proven chain. A branch already
  removed by an interrupted cleanup remains an acceptable idempotent state.
- For `removed`, perform no local mutation.
- Any dirty, divergent, differently owned, or otherwise ambiguous local state
  uses the existing planning-workspace conflict path and is never cleaned or
  overwritten automatically.

If the process stops after a local fast-forward but before the state write, the
next run repeats remote and Git proof, recognizes the clean local head on the
proven chain, and performs the missing checkpoint. Thus the local mutation does
not create a new manual-repair gap.

### Atomic durable head adoption

One locked, revision-checked phase replacement records the candidate. It changes
only head-dependent evidence:

- `publication.headOid` becomes the candidate;
- `workspace.headOid` becomes the candidate;
- every phase artifact becomes workspace-backed evidence at the candidate,
  because the candidate tree has just been verified to contain the complete
  artifact set; and
- `workspace.cleanup.pushedHeadOid`, when present, becomes the candidate.

Base evidence, workspace and branch identity, artifact kinds and paths, pull
request reference and URL, cleanup discriminator, and all other phase data stay
unchanged. State validation and replacement rules gain this narrowly coordinated
head-advance edge for `branch-pushed` and nonterminal `pull-request-open`
phases. They reject partial OID updates, cleanup regression, artifact path
changes, or mutation after phase completion.

The existing state shape can represent the result, so no workflow-version
migration is required. A successful write makes exact validation and every later
cleanup retry use the adopted head. Repeated fast-forward revisions may be
adopted by repeating the same transition.

### Continue normal review and merge handling

After a successful checkpoint, Patchmill resumes the existing flow:

- An open pull request returns `review-pending`. Automatic adoption does not
  advance the next phase; the human merge remains the approval for the revised
  artifact.
- A merged pull request finishes cleanup, fetches the saved base, and performs
  the existing merge ancestry/recovery and regular-file artifact checks. Final
  artifacts are re-anchored to `mergedBaseOid`; the adopted branch head is
  publication provenance, not a substitute for reviewed base evidence.
- A closed-unmerged pull request retains the existing actionable blocker and is
  not made acceptable by a changed head.

The publisher and reconciler must share the same head-adoption helper. In
particular, the publisher must not throw `Planning remote head changed` before
it has checked whether an interrupted create left one stably identified pull
request that authorizes the same safe adoption path. The exact remote-head check
inside cleanup must also return the typed head-adoption outcome on a race rather
than reintroducing a bare error.

### Unsafe adoption outcome

Add a reconciliation/publication outcome mapped by the planning phase runner to
`status: "blocked"` with stable reason `planning-head-adoption-blocked`.
Diagnostic context includes:

- issue, phase, and canonical pull request URL;
- recorded, host, fetched, and remote head OIDs when available;
- failure classification: `remote-missing`, `head-disagreement`,
  `not-descendant`, `unexpected-paths`, `non-regular-artifact`, or `head-moved`;
- saved artifact paths and any unexpected changed paths; and
- the cleanup state, when it affects recovery.

Guidance tells the operator to preserve the revision and make the owned remote
branch a fast-forward descendant of the recorded head whose net changes are
limited to the reported artifact paths. For example, the human can merge or
reapply the revision onto the recorded history and push the resulting descendant
normally. It warns against editing planning state, force-restoring the obsolete
head, or discarding revised artifacts. Missing or disagreeing remote evidence
must be repaired on the saved branch before retry.

Retry is `after-action` for stable unsafe evidence and `retry-now` only when the
head moved during the bounded observation window. The phase remains at its last
durable checkpoint, so the blocker is resumable and is not presented as an
unexpected Run failure.

## Affected components

- `planning-pull-request-validation.ts` — separate stable identity validation
  from optional exact-head validation while preserving existing reason codes.
- `planning-publication-git.ts` (or a focused planning-head Git module) — fetch
  and pin the candidate, classify ancestry/diff/tree safety, and support safe
  local fast-forward recovery without remote mutation.
- A focused head-adoption module under `src/cli/commands/run-once/` — coordinate
  PR, remote, Git, local-workspace, and state evidence without growing the
  reconciler further.
- `planning-phase-publisher.ts` and `planning-phase-reconciler.ts` — invoke the
  shared adoption path before cleanup/status classification and return its typed
  blocker.
- Planning state transitions and validation — permit only the coordinated
  nonterminal head-advance replacement and reject partial evidence changes.
- `planning-phase-runner-planning.ts` and result diagnostic types/catalog — map
  unsafe adoption to the stable blocked reason and actionable guidance.
- Focused validator, Git, state, publisher, reconciler, runner, diagnostic, and
  real-Git tests.

Keep provider commands in adapters, Git safety proof out of orchestration, and
state mutation behind `replacePlanningPhase()`. Split focused helpers rather
than adding another multi-stage responsibility directly to the reconciler.

## Verification strategy

These tests pass the Testing Value Gate because they protect a production
recovery deadlock, remote Git safety, durable state invariants, destructive
cleanup boundaries, and public blocked-result behavior.

### Validation and state tests

- Stable identity validation accepts only a head mismatch; exact validation
  still rejects it.
- Target/head repository, base/head branch, marker, URL, and saved reference
  mismatches remain hard validation failures and never invoke adoption Git.
- A coordinated adoption updates publication, workspace, every artifact, and
  cleanup OIDs in one revision for each cleanup discriminator.
- Partial OID updates, artifact path/kind changes, cleanup regression,
  uncoordinated head updates, and completed-phase mutation are rejected.
- Existing serialized `planning-pr-v1` states still parse without migration.

### Adoption and reconciliation tests

- A revised open pull request with an artifact-only fast-forward is adopted and
  returns `review-pending` at the new durable head.
- A revised merged pull request is adopted, then completes only after the normal
  merge/base and artifact proof; final artifact evidence points at
  `mergedBaseOid`.
- Multiple safe revisions can be adopted in sequence.
- A single discovered pull request recovers a `branch-pushed` interruption and
  atomically checkpoints its reference plus revised head; zero or multiple
  matches cannot authorize adoption.
- Host/remote disagreement, missing remote branch, non-descendant history,
  unexpected changed paths, deleted/non-regular artifacts, and a head that moves
  during proof return `planning-head-adoption-blocked` without state mutation.
- Every non-head identity mismatch and every command, transport, malformed
  response, or state-store failure keeps its existing hard-failure class.
- A changed head observed by the cleanup recheck returns the typed outcome
  rather than `Planning remote head changed`.

### Interruption and local cleanup tests

Inject failure before and after candidate fetch, local fast-forward, state
replacement, worktree removal, and branch removal. Prove that:

- no failed proof mutates local or durable state;
- a clean local head advanced before a failed state write is adopted on retry;
- ignored files remain preserved and still produce the existing cleanup-pending
  behavior;
- dirty or divergent local evidence is not reset or removed;
- a persisted adoption resumes exact cleanup without repeating unsafe effects;
  and
- a second remote advance after an interrupted first adoption is either safely
  fast-forwarded or blocked, never silently overwritten.

### Real-Git regression

Use a temporary repository and bare remote to publish a planning artifact,
create an open host fixture, push an artifact-only descendant from a second
checkout, and reconcile it. Assert the candidate is fetched, all durable OIDs
advance together, local cleanup is resumable, and the outcome is
`review-pending`. Then model merge to the saved base and prove the same revised
head completes with authoritative merged-base evidence.

Repeat with a force-pushed non-descendant and with a descendant that changes a
non-artifact file. Both must preserve state byte-for-byte and return the
head-adoption blocker. At least one failure-injection case must stop after local
fast-forward and prove the next run repairs the missing checkpoint.

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

A legitimate artifact-only fast-forward revision on an owned planning pull
request no longer wedges its Issue run. Open revisions remain behind human merge
review, merged revisions still require authoritative base evidence, and retries
observe one coherent adopted head across publication, workspace, artifact, and
cleanup state. Unsafe history or content changes produce a specific actionable
blocker, while unrelated identity and infrastructure failures remain
fail-closed.
