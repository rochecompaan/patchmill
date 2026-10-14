# Planning Artifacts Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Do not delegate implementation without operator approval.

**Goal:** Fix all four review findings and push verified changes to PR #326.

**Architecture:** Keep PR identity separate from revision evidence. Preserve
recovery evidence until the outer phase runner proves its workspace safe. Retain
one approved artifact selection through materialization and destination checks.

**Tech Stack:** TypeScript, Node.js, `node:test`, real Git fixtures, npm, GitHub
CLI.

**Spec:** `docs/specs/2026-10-14-planning-artifacts-review-design.md`

## Global Constraints

- Work in `.worktrees/planning-artifacts-without-issue-branch` on
  `fix/planning-artifacts-without-issue-branch`.
- Push to the existing PR #326. Do not replace its branch or force-push.
- Preserve the same PR and stable workspace identity when heads change.
- Preserve actual cleanup state until workspace preparation proves readiness.
- Do not reset a surviving local branch or overwrite dirty or conflicting work.
- Do not require an old implementation HEAD to prove workspace ownership.
- Accept valid human merges and identify older checks as historical evidence.
- Preserve convention discovery, approvals, configured paths, and ambiguity
  rules.
- Do not change dependency files, skill packs, or unrelated pipeline behavior.
- Add behavioral tests before production changes. Keep new helpers focused.
- Verify documentation with formatters and Markdown lint, not text assertions.

## Review Focus

- Older checkpoints without new head fields must remain readable without
  attributing their checks to a newly observed revision. Task 1 tests this.
- A PR or remote head can change between observation and restoration. Task 2
  must block unsafe restoration without running an agent or dropping identity.
- A surviving local branch can contain work that differs from the remote PR
  branch. Task 2 must preserve it rather than reset it during restoration.
- A PR can merge while fresh checks are pending. Task 2 must not launch agents
  against a merged PR or mislabel old checks as checks of its final head.
- A selected artifact can disappear or traverse a symlink outside the execution
  root. Task 3 must block execution and preserve external content.

---

## Task 1: Separate PR identity from revision evidence

Todo: `TODO-1aaa7e97`.

### Files

- Modify: `src/workflow/implementation-pr-reconciliation.ts`
- Modify: `src/workflow/planning-state-types.ts`
- Modify: `src/workflow/planning-state-implementation-codec.ts`
- Modify: `src/workflow/planning-state-transitions.ts`
- Modify: `src/cli/commands/run-once/planning-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-receipt.ts`
- Modify: `src/cli/commands/run-once/planning-finish.ts`
- Modify: `src/cli/commands/run-once/planning-runtime-state.ts`
- Modify: `src/issue-run/types.ts`
- Test: `src/workflow/implementation-pr-reconciliation.test.ts`
- Create:
  `src/cli/commands/run-once/planning-implementation-head-evidence.test.ts`
- Create: `src/workflow/planning-state-implementation-head-evidence.test.ts`

### Interfaces

- Reuse `validatePlanningPullRequestIdentity(input)` from the canonical
  validation module. Keep head-object syntax checks and closing-reference
  checks.
- Extend merged `ImplementationPrReconciliation` with `headOid: string`,
  matching its open result. Keep `mergeOid` and `mergedBaseOid` separate.
- Add optional `checkedHeadOid: string` to
  `PlanningImplementationAgentEvidence`.
- Add optional `observedHeadOid: string` to
  `ImplementationPullRequestOpenPlanningPhase` and
  `ImplementationCompletePlanningPhase`.
- Add optional `checkedHeadOid` and `observedHeadOid` to public PR-created and
  merged result types. The workflow derives these fields, not the agent.
- Older published receipts derive their checked head from
  `phase.publication.headOid`. A new host observation never changes that
  receipt.

### Steps

- [x] Write failing tests for a checked A, observed and merged B, and distinct
      merge commit M. Assert successful reconciliation returns head B and merge
      M. Assert completion retains checked A and observed B. Assert its result
      labels A's validation and review as historical.
- [x] Write failing tests for unchanged heads, malformed head objects, foreign
      references, invalid markers, missing closing references, and merge objects
      absent from the fetched target. Retain existing blocked behavior.
- [x] Write failing codec and transition tests for older checkpoints without new
      fields. Assert successful fresh validation stamps the checked revision.
      Assert merely observing B does not change checked A or its saved results.
- [x] Run the new tests and affected reconciliation tests. Confirm failures
      describe missing behavior rather than fixture or compilation mistakes.
- [x] Replace the reconciliation validator call with identity validation. Do not
      substitute the observed head into expected publication evidence.
- [x] Add head fields and codec support. Permit only the narrow successful-check
      stamp in the branch-pushed to pull-request-open transition. Preserve the
      rest of the implementation receipt unchanged.
- [x] Persist observed heads with reconciliation and merge evidence. Update
      result construction to expose both revisions and clearly mark historical
      validation and review when they differ. Preserve saved receipt text in
      state.
- [x] Run focused tests and `npm run check:types`. Confirm all pass.
- [x] Commit the behavior and tests with
      `fix(run-once): separate observed and checked implementation heads`.

Focused command:

```sh
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test \
  src/workflow/implementation-pr-reconciliation.test.ts \
  src/workflow/planning-state-implementation-head-evidence.test.ts \
  src/cli/commands/run-once/planning-implementation-head-evidence.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-runtime-state.test.ts \
  src/cli/commands/run-once/planning-implementation.test.ts
```

## Task 2: Preserve recovery state and use canonical preparation for retries

Todos: `TODO-22050eb3` and `TODO-b0acafe3`.

These fixes share the same state boundary. Keep them together so no intermediate
commit leaves a retry route that bypasses preparation.

### Files

- Modify: `src/workflow/planning-state-types.ts`
- Modify: `src/workflow/planning-state-implementation-codec.ts`
- Modify: `src/workflow/planning-state-validation.ts`
- Modify: `src/workflow/planning-state-transitions.ts`
- Modify: `src/workflow/planning-state-implementation-revalidation.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-revalidation.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-receipt.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-workspace-ready.ts`
- Modify: `src/cli/commands/run-once/planning-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-validation.ts`
- Modify: `src/git/planning-workspaces.ts`
- Modify: `src/git/planning-workspace-git.ts`
- Create: `src/git/planning-workspace-restoration.ts`
- Create: `src/cli/commands/run-once/planning-implementation-resume.ts`
- Create: `src/cli/commands/run-once/planning-implementation-resume.test.ts`
- Create:
  `src/cli/commands/run-once/planning-implementation-resume.real.test.ts`
- Create: `src/git/planning-workspace-restoration.test.ts`
- Create: `src/workflow/planning-state-revalidation-recovery.test.ts`
- Test: `src/cli/commands/run-once/planning-implementation-revalidation.test.ts`

### Interfaces

- Export `PlanningImplementationRevalidationEvidence` with the prior
  `publication`, `implementation`, optional `pullRequest`, optional `finish`,
  and optional `observedHeadOid`.
- Export `ImplementationRevalidationPendingPlanningPhase` with
  `kind: "implementation"`, `status: "revalidation-pending"`, `base`,
  `workspace`, `artifacts`, and
  `revalidation: PlanningImplementationRevalidationEvidence`. Its workspace
  keeps the actual `PlanningWorkspaceOwnership` cleanup state.
- Add optional `revalidation` evidence to implementation workspace-ready and
  branch-pushed phases. Retain it through retries until same-PR validation
  succeeds. Decode it strictly and preserve its stable identity in transitions.
- Change `invalidateImplementationChecks(phase)` to return that pending phase
  without changing the workspace head or cleanup state.
- Change `changedImplementationPublication(input, phase)` to report the pending
  phase when fresh work is required. It must not record an observed workspace
  head as verified readiness.
- Extend `PlanningWorkspaceLifecycle.resume(input)` with optional
  `restoreHeadOid?: string`. Its existing ready snapshot return type stays
  unchanged. Restoration is implementation-only.
- Export `preparePlanningImplementationRevalidation(input, state)` from the
  focused resume module. It returns a phase-runner outcome or
  `{ kind: "workspace-ready", state, workspaceCreated }`.
- Use the existing `runWorkspaceArtifacts` and `reconcilePlanningWorkspaceReady`
  flow for pre-agent checks. Retained prior PR evidence supplies
  `runAgent.existingPullRequest` and same-PR validation.

### Steps

- [x] Write failing state tests that invalidate a published phase with removed
      cleanup. Assert the same PR, URL, publication identity, previous checks,
      saved workspace head, and cleanup state survive serialization and retries.
- [x] Write failing real-Git tests that remove the normal published worktree and
      local branch, advance the open PR branch, and resume the outer runner.
      Assert the agent sees that branch at the same path and receives the same
      PR.
- [x] Write failing outer-runner tests for a changed clean worktree, a changed
      dirty worktree, and an unchanged branch-pushed phase. Assert one, zero,
      and zero agent runs respectively. Assert preparation precedes the first
      run.
- [x] Add failure cases for path ownership, branch registration, saved-base
      ancestry, and restoration failure. Assert zero agent runs, unchanged local
      content, retained PR evidence, and no premature ready-head checkpoint.
- [x] Add tests for restoration with a surviving local branch. Assert no reset
      command and preservation of its commits. Add a fetched-head disagreement
      case and assert truthful recovery state remains saved.
- [x] Add a PR-merged-during-revalidation test. Assert no agent starts and valid
      merge handling uses Task 1's separate observed and checked revisions.
- [x] Run these tests and confirm the intended failures.
- [x] Add the pending phase and strict state transitions. Keep large codec and
      transition modules limited to wiring the focused revalidation policy.
- [x] Implement guarded restoration in the Git adapter. Fetch the current PR
      branch, prove its expected head, and use safe worktree registration. Reuse
      a surviving owned branch without reset. Block collisions and
      disagreements.
- [x] Implement the outer-runner recovery helper. Reconcile the existing PR
      before restoration. Preserve valid merged-PR completion without agents.
- [x] Move branch-pushed head-change detection before the runner's preparation
      decision. Remove the internal restart from `runPlanningImplementation`.
- [x] Require cleanliness and saved-base ancestry before checkpointing a new
      workspace head in canonical reconciliation. Do not use an early equality
      shortcut to bypass those checks. Converge restored and existing workspaces
      on this boundary before artifact or implementation agents run.
- [x] Retain the exact saved PR reference when invoking and validating a rerun.
      Clear old finish effects only after fresh same-PR validation succeeds.
- [x] Run focused suites and `npm run check:types`. Confirm all pass.
- [x] Commit with
      `fix(run-once): safely restore and revalidate existing implementation PRs`.

Focused command:

```sh
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test \
  src/workflow/planning-state-revalidation-recovery.test.ts \
  src/git/planning-workspace-restoration.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/cli/commands/run-once/planning-implementation-resume.test.ts \
  src/cli/commands/run-once/planning-implementation-resume.real.test.ts \
  src/cli/commands/run-once/planning-implementation-revalidation.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-runner.real.test.ts \
  src/cli/commands/run-once/planning-implementation.test.ts
```

## Task 3: Materialize the selected approved artifacts in the execution worktree

Todo: `TODO-27af0bd5`.

### Files

- Modify: `src/cli/commands/run-once/planning-artifacts.ts`
- Modify: `src/cli/commands/run-once/approval-artifact-preflight.ts`
- Modify: `src/cli/commands/run-once/artifact-source-materialization.ts`
- Modify: `src/cli/commands/run-once/pipeline-legacy.ts`
- Create: `src/cli/commands/run-once/execution-planning-artifacts.ts`
- Create: `src/cli/commands/run-once/execution-planning-artifacts.test.ts`
- Create:
  `src/cli/commands/run-once/pipeline-approved-artifact-materialization.real.test.ts`
- Test:
  `src/cli/commands/run-once/approval-artifact-preflight.branch-fallback.test.ts`
- Test:
  `src/cli/commands/run-once/pipeline-approval-workspace-preflight.test.ts`
- Test: `src/cli/commands/run-once/artifact-source-materialization.test.ts`

### Interfaces

- Add optional `source: ResolvedIssueArtifactSource` to
  `ResolvedPlanningArtifact`. Approved resolution fills it from the selected
  source's exact relative path, absolute source location, content, and evidence.
- Extend `ApprovedArtifactPreflight` with
  `sources: ResolvedIssueArtifactSources`. These sources come from the same
  resolved artifacts used for approval, including branch-backed snapshots.
- Export `materializeExecutionPlanningArtifacts(input)` with `repoRoot`,
  `runner`, `issueNumber`, `sources`, optional `policy`, and optional
  `approvedArtifactPreflight`. Return `Promise<ResolvedIssueArtifactSources>`.
  `repoRoot` is the actual execution worktree, not a source or fallback root.
- Reuse `materializeIssueArtifactSources` for explicit and fallback sources.
  Preserve saved artifact commit identity under the existing resume policy.
  Require destination readability and selected-content agreement before return.

### Steps

- [x] Write a failing real-Git pipeline test with an approved repository plan
      absent from the issue branch. In the agent callback, read the supplied
      plan path from its execution cwd and assert that it contains the selected
      plan.
- [x] Add a test that changes the source after preflight. Assert materialization
      uses the retained approved selection, not another lookup or another path.
- [x] Add tests for a source found only outside the execution root, a missing or
      unreadable destination, and conflicting destination content. Assert zero
      agent runs and an error naming the artifact and destination.
- [x] Add a symlink-escape case. Assert neither materialization nor verification
      follows a destination outside the execution worktree or changes external
      files.
- [x] Cover explicit sources, branch-backed approved sources, configured
      directories, saved commit identity, and ambiguous discovery. Retain their
      existing supported behavior and safe failures.
- [x] Run the tests and confirm intended failures.
- [x] Retain selected source evidence in canonical approved resolution and
      preflight. Do not infer availability from an unrelated search root.
- [x] Implement execution-root materialization and destination checks in the
      artifact layer. Apply the same destination safety policy to both source
      kinds.
- [x] Replace the legacy pipeline's source-specific materialization loop with
      minimal calls into that layer. Supply the ensured execution workspace
      before the helper runs. Do not add another artifact lookup before agent
      execution.
- [x] Run focused suites and `npm run check:types`. Confirm all pass.
- [x] Commit with
      `fix(run-once): materialize approved artifacts before agent execution`.

Focused command:

```sh
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test \
  src/cli/commands/run-once/execution-planning-artifacts.test.ts \
  src/cli/commands/run-once/pipeline-approved-artifact-materialization.real.test.ts \
  src/cli/commands/run-once/approval-artifact-preflight.branch-fallback.test.ts \
  src/cli/commands/run-once/pipeline-approval-workspace-preflight.test.ts \
  src/cli/commands/run-once/approval-artifact-preflight.test.ts \
  src/cli/commands/run-once/artifact-source-materialization.test.ts \
  src/cli/commands/run-once/planning-artifacts.test.ts
```

## Final verification and PR update

- [x] Run `npm test`, `npm run check:types`, `npm run lint`, `npm run build`,
      `npm run check:architecture`, and `git diff --check`. Require successful
      exits.
- [x] Review the complete diff against
      `221441ce7c9fa0b0461c7a170e6b18b453a8961c`. Recheck every todo acceptance
      criterion, execution ordering, and truthfulness of historical evidence.
      Use the canonical `reviewer` if the chosen execution method authorizes
      independent review.
- [x] Address findings and rerun the affected checks. Do not close todos based
      only on an implementation report.
- [ ] Commit these documents and the plan's completed checkboxes.
- [ ] Push with
      `git push origin HEAD:fix/planning-artifacts-without-issue-branch`.
- [ ] Confirm PR #326 points at the pushed commit. Report CI status separately
      from local verification. Update each todo with evidence and mark it
      complete.

## Plan self-review

Each todo maps to a tested task. Task 1 establishes head-evidence fields used by
Task 2. Task 2 keeps restoration and pre-agent checks in one recovery boundary.
Task 3 owns approved selection and execution-worktree availability. The five
Review Focus cases have explicit regression tests in their owning tasks.

The starting branch passes `npm test`. No production changes or fixes are part
of this planning checkpoint.

## Final implementation evidence

The independent review reported two Important findings and no Critical or Minor
findings. Both reproductions failed before their fixes. Recovery now derives a
missing saved PR reference from its canonical URL for agent handoff and
independent validation. Late merges retain checked A, prepared workspace B, and
observed C after proving B is in C's Git history. Real-Git regressions cover
normal and squash merges, rewritten history, and dirty local work.

All nine added review regressions pass. The full npm test script, run directly
with Node's `--test-concurrency=4` before its file arguments, passes 2,478
tests. Dependency and contract checks, type checks, lint, build, architecture
checks, and `git diff --check` pass. Dependency files remain unchanged, so no
mandatory Nix rebuild applies. These documents use formatting and Markdown lint
rather than new text-assertion tests.

### Rulings

- Prove B's inclusion in merged PR head C, not ancestry in the target merge
  commit. Squash merges preserve PR contents but not source commit ancestry. If
  the source head cannot be proved locally, retain the workspace and block
  cleanup. Cost if wrong: a valid merge can require manual recovery.
- Leave unchanged detached-Git shutdown timing outside this fix. Run the full
  test script at concurrency 4 without changing its deadlines or assertions.
  Cost if wrong: shutdown delays under heavier contention remain unfixed.
