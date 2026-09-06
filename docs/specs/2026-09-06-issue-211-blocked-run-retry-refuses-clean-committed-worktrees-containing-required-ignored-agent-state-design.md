# Preserve ignored agent state during in-place blocked-run retry

- **Issue:** #211
- **Status:** Proposed design

## Summary

An explicit retry of a blocked Issue run will preserve and reuse its existing
worktree when Patchmill verifies that the worktree is registered at the expected
path, is on the expected branch, has no blocking ordinary Git status, and needs
no recovery mutation. Ignored content will remain inventoried, but it will no
longer override the current or commit-bearing resume classification.

The exception applies to all ignored content, not only recognized workflow
paths. It therefore preserves coding-agent state such as `.pi/todos/` and
`.superpowers/`, as well as ordinary local environment files and generated
content. Patchmill will continue to refuse ignored content when the selected
recovery action would refresh, recreate, reset, move, replace, or delete
workspace state.

## Context

Issue #183 introduced a conservative recovery assessment and typed recovery
actions. The assessment correctly inventories ignored content because Git cannot
preserve it through a ref or worktree replacement. Its classification currently
treats any ignored entry as `ignored-worktree-content` before it considers
branch divergence or unique commits. The policy consequently refuses a retry
even when its action would have been a no-op `resume` of the same worktree.

This conflicts with the Run recovery state model. A blocked Run attempt may
leave committed implementation work and ignored task, progress, review, repair,
or environment state in the issue worktree. A later Run attempt must be able to
continue the same Issue run with that state present.

## Goals

- Resume a blocked, acknowledged Issue run in the same verified worktree when
  recovery requires no workspace mutation.
- Support both a current zero-ahead branch and a branch with unique commits.
- Preserve every pre-existing ignored path and its bytes until the recovered
  coding-agent invocation starts.
- Keep ordinary dirty status, workspace identity, branch state, and ignored
  inventory as independent assessment facts.
- Refuse ignored content before every recovery action that can move, recreate,
  refresh, reset, overwrite, or delete workspace state.
- Retain late ignored-content guards on refresh and reset paths.
- Make operator diagnostics state whether ignored content is being preserved in
  place or is blocking an unsafe destructive action.

## Non-goals

This issue will not:

- allow tracked or untracked ordinary dirty changes during blocked retry;
- add a force flag, cleanup command, automatic stash, or ignored-file backup;
- introduce an allowlist of approved ignored paths;
- refresh a stale zero-ahead branch in the presence of ignored content;
- hash or persist the contents of ignored files;
- provide snapshot isolation from unrelated processes modifying the worktree;
- move Patchmill-owned durable state out of the worktree; or
- change acknowledgment, lease, artifact, checkpoint, label, or reset-seed
  semantics.

## Approaches considered

### Action-aware ignored-content policy (chosen)

Assess ignored entries independently, derive the recovery action from workspace
identity and branch state, and then apply an ignored-content gate based on
whether that action mutates the workspace. A true in-place `resume` may proceed;
all mutating actions remain fail-closed.

This matches the actual data-loss boundary. It also preserves unknown ignored
content without weakening refresh or reset safety.

### Allow only recognized workflow paths

Patchmill could allow `.pi/todos/` and selected `.superpowers/` paths while
refusing caches or environment files. This is rejected because workflow state
locations evolve, repository-local tools can have their own durable ignored
state, and the safety property depends on the operation rather than the path
name. The acceptance case also includes ordinary generated ignored content.

### Copy or hash ignored content around recovery

Patchmill could snapshot ignored files and restore them after refresh or reset.
This is rejected because ignored trees can be large, sensitive, concurrently
written, or contain special filesystem entries. Copying would create a second
state-preservation protocol and still would not make destructive recovery
provably safe. In-place reuse needs no such mechanism.

## Proposed recovery model

### Independent assessment facts

`RunRecoveryAssessment` will represent these dimensions separately:

- expected and saved workspace identity;
- physical worktree existence and Git registration;
- expected branch existence, checkout location, and pinned OID;
- ordinary status after the existing configured status exclusions;
- ignored status and normalized ignored entries;
- divergence and actual unique commits;
- saved commit-loss evidence; and
- lease-protocol and legacy-fence evidence.

The worktree's ordinary cleanliness must not include ignored entries. The
assessment type should use an unambiguous ordinary-clean field, or derive it
from `dirtyStatus`, while retaining `ignoredEntries` as a separate inventory. An
ignored entry alone will no longer become the assessment's primary recovery
classification.

The existing unsafe classifications keep their precedence: unverifiable identity
and ordinary dirty state still refuse recovery, and missing-branch commit-loss
or lease-fence evidence remains unchanged. Branch/worktree shape then produces
the existing current, stale-base, commit-bearing, or recreatable classification.

### Action-aware decision

The policy will first derive the candidate action without treating ignored
content as branch state:

- a verified current worktree produces `resume`;
- a verified worktree with unique commits produces `resume` without rewriting
  its branch, including when it is also behind the base;
- a zero-ahead worktree behind the base produces `refresh-and-resume`;
- an absent safe workspace produces `recreate-and-resume`; and
- reset intent produces `archive-reset-and-start` only when existing reset
  safety rules permit it.

Ignored content may accompany `resume` only when the assessment also proves all
of these in-place conditions:

1. the expected physical worktree exists;
2. it is registered at exactly the expected path;
3. it has the expected branch checked out and that branch is not checked out
   elsewhere;
4. ordinary status is clean; and
5. the chosen recovery action will not invoke the recovery mutation layer.

A current branch means `ahead = 0` and `behind = 0`; it can resume under this
rule. A zero-ahead branch with `behind > 0` remains stale and still requires a
refresh. Patchmill will not silently choose stale content merely to avoid the
ignored-content guard.

After the candidate action is known, any non-empty ignored inventory will turn a
mutating candidate into an `ignored-worktree-content` refusal. This gate covers
refresh, recreation, and reset, including future actions added to the mutation
layer. Reset of a commit-bearing branch retains its stronger unique-commit
refusal.

The refusal reason should be modeled separately from the intrinsic recovery
classification so `ignored-worktree-content` describes why a candidate action
cannot execute, not the branch/worktree shape.

### In-place preservation contract

For an allowed in-place resume, recovery will perform assessment reads only. It
will not call `git worktree add`, `git worktree move`, `git update-ref`, reset,
clean, removal, or filesystem copy/delete operations on the issue worktree. The
normal pipeline may recheck identity and ordinary cleanliness, but it must reuse
the same path and pass that path as the recovered coding agent's working
directory.

Preservation means Patchmill leaves the original files at their original paths
with their original bytes until agent invocation. The product does not need to
read, hash, interpret, copy, or persist ignored file contents. An independent
process can still change those files; the guarantee is that recovery itself does
not do so.

All ignored paths receive the same rule. Recognized workflow paths may be used
as representative tests and clearer examples, but they are not privileged by
production policy.

### Destructive recovery and race safety

The existing destructive mutation checks remain strict. Refresh and reset will
continue to reassess before movement and call
`assertRecoveryWorkspaceUnchanged()` after worktree movement and before ref
updates or publication. That helper must continue to treat any ordinary or
ignored status as a change.

Consequently:

- pre-existing ignored content refuses before a destructive mutation;
- ignored content appearing during refresh or reset either changes the
  reassessed decision or stops the mutation after the complete checkout has
  moved to quarantine;
- no ref update, branch deletion, or publication follows a failed late-content
  check; and
- recreated target-path races retain their existing fail-closed behavior.

The in-place exception must not be implemented by weakening
`assertRecoveryWorkspaceUnchanged()` or by filtering workflow paths from its
ignored-status check.

## Data flow

1. Explicit `run-once --issue N` eligibility and the Issue run lease establish
   the existing blocked-retry boundary.
2. Recovery assessment reads exact Run recovery state, workspace registration,
   ordinary status, ignored inventory, branch OIDs, and divergence.
3. Recovery policy derives a candidate action from the non-ignored facts.
4. The policy allows ignored content only for a verified in-place `resume`; a
   mutating candidate becomes a typed refusal.
5. An allowed in-place resume emits a preservation diagnostic and returns to the
   normal pipeline without invoking recovery mutation.
6. The normal pipeline reuses the same worktree and starts the recovered coding
   agent there, with ignored files still present.
7. A permitted destructive action continues through existing reassessment,
   quarantine, compare-and-swap, and late-content checks.

No new persisted Run recovery status or state schema field is required.

## Diagnostics

The success diagnostic for a resume with ignored content will explicitly say
that Patchmill is resuming in place without workspace mutation and preserving
ignored entries. It may include the existing normalized path inventory or a
count plus paths.

An `ignored-worktree-content` refusal will identify the candidate destructive
action, such as refresh or reset, and explain that recovery cannot prove the
ignored content will survive that action. It must not use the in-place
preservation wording.

`recoverBlockedWorkspace()` should return the applied decision or a focused
outcome so the pipeline can emit the successful preservation message before the
coding-agent stage. Existing refusal formatting remains the error path.

## Affected components

### Assessment and types

- `src/cli/commands/run-once/recovery-assessment.ts` will stop giving ignored
  entries classification precedence and will expose ordinary cleanliness and
  ignored inventory independently.
- `src/cli/commands/run-once/types.ts` will separate intrinsic recovery
  classification from policy refusal reasons and, if useful, represent the
  verified in-place preservation condition or blocked candidate action.
- `src/cli/commands/run-once/recovery-archive.ts` will continue to serialize
  both ordinary and ignored assessment evidence using the clarified shape.

### Policy and diagnostics

- `src/cli/commands/run-once/recovery-policy.ts` will derive an action before
  applying the ignored-content mutation gate.
- `src/cli/commands/run-once/recovery.ts` will format distinct preserved-resume
  and destructive-refusal diagnostics.
- `src/cli/commands/run-once/pipeline-recovery.ts` and its narrow call site in
  `pipeline.ts` will surface the successful decision while ensuring `resume`
  bypasses recovery mutation.

### Mutation safety

- `recovery-mutation-refresh.ts`, `recovery-mutation-reset.ts`, and
  `recovery-mutation-helpers.ts` should require no policy weakening. Their
  reassessment and late ignored-content checks remain authoritative.

### Tests and documentation

- Add focused assessment/policy tests without further expanding the already
  large general recovery test module where a dedicated ignored-content test file
  is clearer.
- Add a blocked-retry pipeline scenario that observes ignored file contents at
  the Pi invocation boundary.
- Keep or extend real-Git mutation tests for late ignored content during both
  refresh and reset.
- Update `site/src/content/docs/using-patchmill/run-once.md` so it distinguishes
  ignored content preserved by in-place retry from ignored content that blocks
  destructive recovery.

No dependency change is planned.

## Verification strategy

These tests pass Patchmill's Testing Value Gate because they protect a data-loss
boundary, a blocked-run regression, and operator-visible recovery behavior.

### Assessment and policy tests

Cover:

- a registered, ordinary-clean current zero-ahead worktree with ignored entries
  selecting `resume`;
- the same decision for a branch with actual unique commits;
- a commit-bearing branch that is also behind the base remaining an in-place
  resume without branch rewrite;
- ordinary dirty status still refusing even when ignored entries also exist;
- a stale zero-ahead worktree with ignored entries refusing the required
  refresh;
- reset with ignored entries refusing before archive or mutation;
- unknown generated ignored paths receiving the same in-place policy as known
  workflow paths; and
- intrinsic classification, ignored inventory, and refusal reason remaining
  independently visible in the assessment/decision.

### Pipeline preservation tests

Create representative ignored files before retry, including:

- `.superpowers/single-writer/progress.md`;
- `.superpowers/single-writer/oracle-review-ledger.json`;
- `.pi/todos/issue-211-task.md`; and
- an ordinary ignored environment or generated file.

For both a current zero-ahead branch and a commit-bearing branch, assert that:

- retry reaches the recovered coding-agent invocation;
- the Pi working directory is the exact registered worktree;
- every sentinel file exists with byte-identical content when Pi is invoked;
- no worktree add/move, ref update, reset, clean, removal, replacement, or
  recovery filesystem mutation occurs beforehand; and
- the success diagnostic states that ignored content is preserved in place.

### Destructive-path regression tests

Retain and strengthen race tests proving that ignored content arriving after
initial assessment during refresh or reset remains in the original or
quarantined checkout and prevents subsequent ref update, deletion, or
publication. Add a refresh-specific late ignored-content case if one is not
already covered. Assert destructive refusal diagnostics name the blocked action
and list the ignored inventory.

Implementation verification should run focused recovery and pipeline tests,
then:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run site:build
```

No Nix build is required unless implementation unexpectedly changes
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.

## Acceptance mapping

| Acceptance criterion                               | Design response                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Clean commit-bearing retry preserves ignored files | Candidate `resume` is derived before the ignored-content gate and bypasses mutation.          |
| Ignored workflow bytes survive until agent start   | Pipeline tests inspect representative files at the Pi invocation boundary.                    |
| Retry does not refresh, reset, delete, or replace  | In-place eligibility requires a `resume` action and the mutation layer is not invoked.        |
| Current zero-ahead worktree can resume             | `ahead = 0`, `behind = 0` selects the same in-place preservation rule.                        |
| Destructive paths remain fail-closed               | Any ignored inventory rejects refresh, recreation, or reset; late checks remain strict.       |
| Refresh/reset race tests remain effective          | Reassessment and post-move ordinary-plus-ignored checks are retained and tested.              |
| Diagnostics distinguish preserve from refuse       | Success says `resume in place`; refusal names the blocked destructive action.                 |
| Workflow and ordinary ignored paths are covered    | Policy is path-agnostic and tests include `.superpowers/`, `.pi/todos/`, and generated state. |
