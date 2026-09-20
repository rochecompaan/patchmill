# Prevent approval-wait legacy resumes from starving run-once

- **Issue:** #256
- **Status:** Proposed design

## Summary

Automatic `patchmill run-once` selection will treat an issue waiting for spec or
plan approval as ineligible, even when legacy Run recovery state gives that
issue a higher workflow rank or stale labels also include the ready label. The
selection facade and the legacy pipeline will therefore agree that `spec-review`
without `spec-approved`, and `plan-review` without `plan-approved`, cannot start
an automatic Run attempt.

The facade will also continue to the next ranked candidate when a pinned legacy
handoff re-reads its issue and rejects it before mutation. This fallback
protects the queue from future eligibility drift or selection races. One
rejected candidate will no longer turn an otherwise productive invocation into
`no-issue`.

## Context and root cause

The non-dry facade currently loads all open issues, asks `selectRunOnceWorkflow`
for one choice, and pins a legacy choice to `runLegacyOneIssueForSelection`.
Workflow rank is evaluated before configured priority, so a finished legacy
planning workspace outranks fresh planning work.

The facade's eligibility logic primarily checks lifecycle and excluded labels.
Its finished-workspace condition can be satisfied by the ready label before the
workflow-state check is reached. An issue carrying both `agent-ready` and
`spec-review`, for example, can therefore become the sole pinned legacy choice.
The legacy selector re-resolves the labels, recognizes `waiting-spec-review`,
and rejects the issue. Because the facade has discarded the rest of the ranking,
it returns `no-issue` instead of trying the fresh candidate that was already
present in the loaded issue set.

Dry-run bypasses this facade and lets the legacy selector evaluate the complete
issue list. It skips the waiting issue and selects the next actionable one,
which explains the observed dry/real divergence.

## Goals

- Make approval-wait workflow states an absolute exclusion from automatic facade
  choices.
- Preserve active owned planning and legacy recovery when it is not waiting for
  an approval.
- Continue through ranked candidates after a pinned legacy candidate is safely
  rejected before mutation.
- Keep workflow rank, configured priority labels, and issue-number tie-breaking
  unchanged among eligible candidates.
- Preserve explicit `--issue` diagnostics and dry-run behavior.
- Ensure the facade performs at most one substantive Issue run per invocation.

## Non-goals

This change will not:

- alter approval-policy configuration or label names;
- approve, merge, or replace planning pull requests;
- change planning-state, Run recovery state, result, or lock schemas;
- change the relative rank of active planning, legacy, and fresh-planning work;
- retry blocked or failed work, or fall back after a pipeline has begun mutable
  processing;
- address out-of-band planning-pull-request adoption from issue #252 or stale
  lock recovery from issue #255; or
- make dry-run use the mutating facade.

## Approaches considered

### Shared approval-wait eligibility plus bounded fallback (chosen)

Exclude waiting workflow states while constructing automatic facade choices,
then let the facade remove and re-rank a legacy candidate if its pinned handoff
reports a pre-mutation selection rejection. This fixes the known mismatch and
adds a bounded defense if eligibility changes between the advisory read and the
pinned read.

### Eligibility alignment only

Filtering approval-wait states would fix the reported static-label case, but a
candidate could still become ineligible between listing and pinned execution, or
the two selectors could diverge again. Returning `no-issue` after that drift
would preserve the starvation class. This is insufficient.

### Fall back to unrestricted legacy selection

The facade could invoke the legacy pipeline over the complete issue list after a
rejection. That would give a second selector control over planning-state routing
and could violate the facade's planning/legacy/fresh rank order. It would also
obscure which advisory candidate was rejected. Fallback must remain inside the
facade's ranking contract, so this approach is rejected.

## Proposed design

### One automatic approval-wait contract

Choice construction will resolve each issue's workflow state with the existing
`resolveWorkflowState` policy and use `isActionableWorkflowState` at the same
boundary used by normal legacy issue selection. In automatic mode:

- `waiting-spec-review` is ineligible until the configured spec-approved label
  is present;
- `waiting-plan-review` is ineligible until the configured plan-approved label
  is present;
- a stale ready label does not override either waiting state;
- approved finished legacy planning work remains eligible; and
- owned active planning or ordinary legacy recovery remains eligible under its
  existing ownership rules when no approval-wait state is present.

The approval-wait exclusion applies before the facade reads candidate-specific
planning or legacy state and before choices are ranked, not after the
highest-ranked issue is chosen. A waiting automatic candidate is skipped without
interpreting its recovery files; any malformed state becomes relevant only after
the issue returns to an actionable workflow state. This ordering covers legacy,
active-planning, and fresh choice construction so a contradictory
ready-plus-review label set cannot enter through another facade branch or block
unrelated work through a state diagnostic.

This does not reinterpret every owned `in-progress` issue as requiring a ready
or approved label. Active workflows still need to resume and reconcile durable
state. The new invariant is narrower: a resolved waiting state always excludes
an issue from _automatic_ selection. Explicit `--issue` retains its current
fail-fast behavior, including an `approval-required` result with the missing
label instead of silently choosing another issue.

### Bounded fallback after pinned legacy rejection

For automatic selection, `runOneIssue` will retain the loaded issue set and a
set of candidates rejected during this invocation. It will:

1. select the highest-ranked choice from candidates not yet rejected;
2. dispatch planning and fresh-planning choices as today;
3. dispatch a legacy choice through the pinned legacy entry point;
4. return immediately for any substantive legacy result; and
5. when the pinned entry point reports a pre-mutation selection rejection,
   exclude that issue and select again from the remaining candidates.

Each issue can be rejected at most once, so the loop is bounded by the number of
loaded issues. Re-ranking the remainder preserves the existing workflow bucket,
priority-label, and issue-number ordering. The facade does not re-list issues or
admit work that was absent from the invocation's initial open-issue snapshot.
Every candidate path still performs its existing authoritative live re-read.

The pinned legacy boundary will expose or classify selection rejection
explicitly. Today the relevant results are `no-issue` and, for workflow-state
rejection, `approval-required`; both occur before Git preflight, claiming, label
mutation, agent execution, or other issue effects. Automatic facade calls may
continue after those safe rejections. Explicit `--issue` calls return the
rejection and never fall back.

The facade must not infer that `blocked`, `error`, `review-pending`, `stopped`,
cleanup, or successful results are retryable selection misses. Those outcomes
represent an owned attempt, an operator condition, or possible effects and stay
terminal for the invocation.

### Lease and mutation boundary

Legacy selection can be revalidated while acquiring its issue lease. Fallback
may occur only after the pinned legacy call has returned and any acquired lease
has been released. The facade must never select or lease another issue while it
still holds the rejected issue's lease.

A rejection is safe to bypass only while no mutable pipeline stage has begun. If
rejection cannot be distinguished from a post-mutation outcome, the system must
fail closed and return that outcome rather than risk processing two issues in
one invocation.

Planning-pipeline post-lock identity failures keep their existing blocking
behavior. They are not fallback signals: planning ownership has already been
established, and the existing lock contract intentionally forbids choosing a
second issue from inside that attempt.

## Control flow

For the reported queue shape:

1. The facade lists both the legacy review-wait issue and fresh ready issues.
2. Approval-wait filtering omits the legacy issue before ranking.
3. The highest-ranked remaining fresh issue starts its normal planning flow.

For an eligibility race:

1. The facade ranks an actionable legacy issue first.
2. The pinned legacy entry point re-reads it and finds a waiting approval,
   closed issue, or another pre-mutation eligibility change.
3. The legacy entry point returns a classified selection rejection and releases
   any lease.
4. The facade excludes that issue and selects the next ranked candidate from the
   original loaded set.
5. The invocation returns the next candidate's substantive result, or `no-issue`
   only when no candidate remains.

## Affected components

- `src/cli/commands/run-once/planning-selection.ts`
  - Apply the shared approval-wait predicate while building automatic choices.
  - Preserve current workflow ranking for the remaining choices.
- `src/cli/commands/run-once/pipeline.ts`
  - Retain the candidate pool and perform bounded re-selection after a safe
    pinned-legacy rejection.
  - Keep explicit issue selection single-target.
- `src/cli/commands/run-once/pipeline-legacy.ts`
  - Make the internal pinned handoff's pre-mutation rejection contract
    unambiguous to the facade without changing public CLI result schemas.
- `src/cli/commands/run-once/planning-selection.test.ts`
  - Cover approval-wait exclusion and approved-resume preservation.
- `src/cli/commands/run-once/planning-pipeline-facade.test.ts`
  - Cover public non-dry fallback and terminal behavior through `runOneIssue`.

No dependency, configuration, domain glossary, or ADR change is required.

## Failure and compatibility behavior

- If every issue is ineligible or safely rejected, the final result remains
  `no-issue`.
- Malformed or conflicting planning state on an otherwise eligible issue remains
  a fail-closed blocker; only an issue already excluded by an approval-wait
  workflow state defers that diagnostic.
- A provider, filesystem, lock, or unexpected legacy failure propagates under
  the current error contract and does not trigger fallback.
- A rejected candidate receives no claim, label change, Git preflight, Pi run,
  or planning/implementation mutation.
- Approved legacy planning work keeps its higher workflow rank and resumes as
  before.
- Explicit selection never moves to a different issue.
- Dry-run keeps the legacy full-list selector and its current diagnostics. Its
  selected issue should now agree with real automatic execution for a stable
  issue snapshot.
- No public result or serialized state migration is introduced.

## Verification strategy

These automated tests pass Patchmill's Testing Value Gate because they protect
queue liveness, selection ordering, concurrency boundaries, and the public
run-once regression rather than static implementation details.

### Selection tests

Add focused cases that assert:

- a finished legacy planning workspace carrying `agent-ready` plus
  `spec-review`, without `spec-approved`, is omitted and fresh work wins;
- the equivalent `plan-review` state is omitted;
- adding the matching approved label makes the legacy resume eligible again;
- an approval-wait issue cannot enter through active-planning or fresh choice
  construction; and
- unrelated active owned workflows retain their existing rank.

### Facade fallback tests

Drive the public non-dry `runOneIssue` facade with at least two issues and
assert that:

- the initial snapshot ranks a legacy candidate first;
- its authoritative pinned re-read changes to an approval-wait or otherwise
  ineligible state;
- the first candidate has no mutation calls;
- the next ranked candidate is dispatched in the same invocation; and
- the final result identifies that second issue instead of returning `no-issue`.

Also cover that multiple safe rejections terminate with `no-issue`, configured
priority still orders the remaining candidates, and a substantive or failing
first outcome never dispatches a second issue. An explicit waiting issue must
return its existing approval diagnostic without touching another issue.

### Validation commands

Implementation verification should run:

```sh
node --test \
  src/cli/commands/run-once/planning-selection.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts
npm run test:run-once
npm test
npm run lint
npm run build
npm run check:types
npm run check:architecture
git diff --check
```

No npm dependency change is planned, so a Nix build is not required. If an npm
dependency file changes unexpectedly, the repository-required Nix build must
also run.

## Acceptance criteria

- Automatic selection never chooses an issue resolved as waiting for spec or
  plan approval, even if stale ready or high-priority labels are present.
- A waiting legacy resume cannot prevent another eligible open issue from being
  processed in the same invocation.
- A pinned legacy pre-mutation rejection advances to the next facade-ranked
  candidate and cannot loop indefinitely.
- Approved resumes and non-waiting active workflows preserve their current rank
  and behavior.
- Explicit `--issue`, dry-run, malformed-state, lock, and post-mutation outcomes
  preserve their safety contracts.
- Stable issue snapshots produce the same eligible automatic issue in dry and
  non-dry execution.
