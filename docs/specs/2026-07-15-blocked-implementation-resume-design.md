# Blocked implementation resume design

## Context

A Patchmill run in a downstream repository reached implementation, committed a
visible UI fix, passed non-visual validation, and returned a deterministic
`blocked` result because required visual evidence could not be captured in the
available environment.

After the operator made the required visual-evidence capture tooling available
and ran `patchmill run-once --issue N`, Patchmill correctly selected the issue
as a resume candidate, but then restarted at `create spec` instead of continuing
the saved implementation branch. The restart also overwrote the saved run state
with a new generated spec path that did not exist.

The important log facts are:

- The original run reached `pi-implementation` and returned a `blocked` final
  JSON result.
- The rerun logged `resuming #N`, proving issue selection recognized the saved
  blocked workspace.
- The rerun then entered `finding spec` and `create spec`.
- The original spec and plan existed in the saved issue worktree, not in the
  main checkout.
- The run-state file was clobbered from blocked implementation recovery state to
  planning state with a newly generated dated spec path.

Patchmill already has a blocked-run recovery model for saved branch/worktree
state. The missing behavior is that planning artifact resolution still reads
from the main repository root before the saved worktree becomes the effective
resume root. For an implementation resume, the saved branch/worktree is the
source of truth.

## Decision

Patchmill should treat clean saved implementation workspaces as phase-aware
resume roots. When a run state has a saved branch and worktree and the workspace
passes recovery checks, `run-once` should reuse that worktree before resolving
saved spec or plan artifacts. Saved artifact paths should be looked up in the
saved worktree first, and a missing saved artifact during resume should be a
safety error rather than a reason to create a fresh spec or plan.

A blocked implementation rerun should therefore continue from the saved issue
branch and call the implementation Pi prompt with resume context. It should not
invoke spec or plan creation unless the run is genuinely a fresh planning run.

Patchmill should also avoid persisting generated artifact paths before Pi has
successfully created those artifacts, so an interrupted or aborted resume cannot
corrupt run state with a nonexistent dated path.

## Goals

- Make `patchmill run-once --issue N` continue a clean blocked implementation
  workspace after the external blocker is resolved.
- Reuse saved `branch`, `worktreePath`, `specPath`, and `planPath` from run
  state without falling back to fresh planning.
- Resolve saved spec and plan paths against the saved issue worktree when the
  main checkout does not contain those files.
- Prevent reruns from overwriting saved implementation state with newly
  generated spec or plan paths.
- Include prior blocker context in the resumed implementation prompt.
- Keep the existing blocked-run recovery safety checks for dirty, missing,
  diverged, or already-merged workspaces.
- Add regression tests that reproduce the blocked implementation resume failure
  mode.

## Non-goals

- Do not introduce a separate `patchmill resume` command for this fix.
  `run-once --issue N` should keep working for explicit recovery.
- Do not automatically bypass visual evidence or validation requirements.
  Resumed implementation must still satisfy normal final handoff policy.
- Do not continue from dirty saved worktrees. Existing dirty-worktree recovery
  errors remain the correct safety behavior.
- Do not infer state from free-form run logs. Run state and Git workspace state
  remain the durable recovery sources.
- Do not require implementation agents to replay every completed task. The saved
  branch state is authoritative.

## Current failure mode

`runOneIssue()` computes `blockedRecoveryResumable` after reading run state and
inspecting the saved branch/worktree. It then sets `resumableState` to true, but
continues into the normal planning path.

`advancePlanningStages()` resolves artifacts with `config.repoRoot`,
`config.specsDir`, and `config.plansDir`. For a blocked implementation resume,
those paths can be wrong because the committed spec and plan may only be present
on the saved issue branch in the saved issue worktree.

When the saved plan is not found in the main checkout, the planning stage treats
this as a missing plan/spec workflow and computes a new spec path for the
current date. It writes that generated path to run state before Pi successfully
creates the file. If the operator aborts, the previous blocked implementation
state is now partially replaced by a planning state.

## Runtime behavior

### Resume root selection

Before calling `advancePlanningStages()`, `runOneIssue()` should determine the
artifact lookup root for the current run.

For fresh runs and planning-only runs, the lookup root remains the configured
repository root.

For resumed states with saved implementation workspace data, the lookup root
should be the saved issue worktree when all of these are true:

- `resumableState` is true;
- run state has `branch` and `worktreePath`; and
- the saved workspace is recoverable and clean, or the ordinary in-progress
  resume state has a registered clean worktree.

In that case `runOneIssue()` should ensure or reuse the saved worktree before
planning artifact resolution and pass an explicit planning artifact root to
`advancePlanningStages()`.

Conceptually:

```ts
const planningArtifactRoot = savedWorktreeResume
  ? {
      repoRoot: join(config.repoRoot, savedWorktreePath),
      specsDir: join(
        savedWorktreeRoot,
        relative(config.repoRoot, config.specsDir),
      ),
      plansDir: join(
        savedWorktreeRoot,
        relative(config.repoRoot, config.plansDir),
      ),
      source: "resume-worktree",
    }
  : {
      repoRoot: config.repoRoot,
      specsDir: config.specsDir,
      plansDir: config.plansDir,
      source: "primary-repo",
    };
```

The concrete implementation can avoid this exact shape, but it should make the
artifact root explicit rather than assuming `config.repoRoot` everywhere.

### Artifact resolution order

Artifact resolution should use different policies for fresh planning and saved
implementation resume.

For saved implementation resume, the saved run-state artifacts are authoritative
because they describe the plan and spec that produced the saved branch. Resolve
artifacts in this order:

1. Saved `specPath` or `planPath` in the resume artifact root.
2. Saved `specPath` or `planPath` in the primary repo root, for compatibility
   with older runs that created planning artifacts there.
3. Existing issue artifact discovered by issue number in the resume artifact
   root, only when there is no saved path for that artifact kind.
4. Existing issue artifact discovered by issue number in the primary repo root,
   only when there is no saved path for that artifact kind.

Explicit artifact sources supplied by issue artifact comments must not redirect
a saved implementation resume away from the saved run-state artifacts. During
implementation resume, an explicit artifact source may be accepted only when a
consistency check proves it points to the same saved path and, when both sides
record commits, the same saved commit. A mismatched explicit artifact source is
a safety error that should stop before Pi or state mutations.

For fresh runs and approval-stage planning resumes without saved implementation
workspace state, the existing behavior remains: validated explicit artifact
sources can seed planning, then Patchmill finds existing artifacts in the
configured docs directories or computes a generated path when creation is
allowed.

### Saved artifact safety

When run state has a saved `planPath` and the run is resuming an implementation
workspace, missing that saved plan in all allowed lookup roots should stop the
run with an actionable safety error. Patchmill should not create a new plan or
spec in that case.

When run state has a saved `specPath` but the saved plan exists and can drive
implementation, a missing spec should not force fresh spec creation. Patchmill
may preserve the saved spec path in state, but implementation only requires a
usable plan path.

When neither a saved plan nor any existing plan can be found during
implementation resume, Patchmill should report the saved branch/worktree and the
missing plan path so the operator can inspect or repair the workspace.

### Avoid pre-success generated path writes

Generated spec and plan paths are useful prompt inputs, but they should not be
written as durable completed state until Pi returns `spec-created` or
`plan-created` and the file/commit exists.

`advancePlanningStages()` should distinguish:

- resolved existing artifact paths, safe to persist immediately; and
- generated target paths, safe to pass to Pi but not safe to persist as
  completed artifact state before success.

If Pi fails while creating an artifact, unexpected-failure handling may record
that planning failed, but it should not overwrite previous saved implementation
state with a newly generated artifact path.

### Resume implementation prompt

The implementation resume context should include enough information for Pi to
continue at the previous blocker rather than rediscover the entire task.

Extend the resume context with optional fields such as:

- prior blocker reason (`lastError`);
- prior blocker questions;
- prior validation summaries;
- commits already present on the saved branch; and
- a statement that the saved branch/worktree is authoritative.

The prompt should instruct Pi to inspect the current branch state, resolve the
prior blocker, run any required validation, and then return the normal
`blocked`, `pr-created`, or `merged` final JSON.

For this class of blocker, the resumed agent should see that the previous
blocker was missing visual evidence and should focus on capturing and committing
the required evidence with the now-available capture workflow.

## Run-state changes

`blockIssue()` should persist more of the deterministic blocked result:

- `lastError`: existing blocker reason, already stored;
- `commits`: blocked result commits;
- `validation`: blocked result validation summaries; and
- `blockerQuestions`: new optional field for blocked result questions.

`AgentIssueRunState` can add `blockerQuestions?: AgentIssueBlockerQuestion[]`.
This keeps blocker details available across reruns without parsing issue
comments or JSONL logs.

`writeRunState()` should continue merging implementation result fields
carefully, but blocked updates should not discard existing
branch/worktree/artifact fields. A blocked update from implementation should
leave the state resumable through blocked recovery and should not reset
checkpoints.

## Label behavior

Existing label behavior should remain:

- A deterministic `blocked` implementation result moves the issue from
  `in-progress` to `needs-info` and posts the blocker comment.
- An explicit rerun for an issue with blocked saved workspace state may resume
  even if the issue currently has `needs-info` instead of `in-progress`.
- On successful handoff, final label cleanup removes stale `needs-info` and
  applies the configured done label.

Automatic selection should remain conservative. Patchmill should not
opportunistically resume all `needs-info` issues without a valid saved blocked
workspace.

## Safety and recovery behavior

The existing blocked-run recovery classifications remain in force:

- dirty saved worktree: stop before mutations and tell the operator to commit,
  stash, or clean changes;
- missing branch/worktree: stop and report repair instructions;
- already merged branch: stop and ask the operator to confirm/finalize stale
  state;
- clean saved worktree: continue resume.

The new artifact-root behavior should run only after the workspace passes these
checks. It should not weaken Git safety gates.

If the saved worktree root is used for planning artifact resolution, progress
should make that visible, for example:

> Reusing saved worktree for resume artifact lookup:
> `.worktrees/patchmill-issue-N-...`

This helps operators understand why Patchmill did not restart planning in the
main checkout.

## Testing strategy

Add focused run-once regression tests.

### Blocked implementation resumes from saved worktree artifacts

Set up run state with:

- `status: "blocked"`;
- saved `branch` and `worktreePath`;
- saved `specPath` and `planPath`;
- `lastError`, `commits`, and `validation`; and
- checkpoints through `worktreeReady`.

Create the saved spec and plan only under the saved worktree path, not under the
main repo root. Mock recovery checks as clean. Run `runOneIssue()` with
`issueNumber` set.

Assert:

- result continues to implementation;
- no spec-creation or plan-creation Pi prompt is invoked;
- implementation Pi runs with `cwd` equal to the saved worktree root;
- implementation prompt includes `Resume context`, prior commits, and prior
  blocker reason; and
- final state preserves saved artifact paths.

### Resume does not clobber saved state on abort

Simulate an operator abort or Pi failure during a resumed run before successful
artifact creation. Assert the saved `specPath`, `planPath`, `branch`, and
`worktreePath` remain unchanged and no new generated dated spec path is written
into run state.

### Missing saved plan is a safety error

Set up blocked implementation state with a saved plan path that exists neither
in the saved worktree nor in the primary repo. Assert Patchmill stops before Pi
and reports an actionable message naming the saved plan path and worktree.

### Compatibility with older run states

Set up an implementing resume where saved artifacts exist in the primary repo
root but not in the saved worktree. Assert Patchmill can still resume and does
not require manual migration.

### Fresh planning behavior unchanged

Keep existing tests for fresh spec and plan creation. Add assertions, if needed,
that fresh runs can still compute generated artifact paths and create spec/plan
artifacts normally.

## Verification plan

- Run targeted run-once tests: `npm run test:run-once`.
- Run the full TypeScript test suite: `npm test`.
- Run linting for changed TypeScript and Markdown: `npm run lint`.
- Because production behavior changes are in resume and run-state logic, rely on
  automated regression tests rather than manual log inspection alone.

## Risks and tradeoffs

### Earlier worktree reuse during resume

Reusing the saved worktree before planning artifact resolution changes the order
of some progress events in resume runs. This is acceptable because resume safety
already depends on inspecting the saved worktree before mutations.

### Multiple artifact roots

Searching both saved worktree and primary repo roots adds complexity. The
complexity is justified because existing runs may have artifacts in either
place, and the saved worktree is necessary for blocked implementation recovery.

### Stale saved paths

A saved path can point to a deleted file. Treating a missing saved plan as a
safety error may require operator repair, but that is safer than silently
starting a new plan/spec workflow on top of an existing implementation branch.

### Prompt verbosity

Adding prior blocker context increases implementation prompt size slightly. The
context is small and directly relevant to safe continuation.

## Open decisions resolved

- `run-once --issue N` remains the resume entry point.
- Clean saved implementation worktrees are authoritative during resume.
- Saved artifact lookup should prefer the saved worktree over the main checkout.
- Missing saved implementation plans should stop with a safety error, not
  trigger fresh planning.
- Generated artifact paths should not be persisted as completed run-state data
  before successful creation.
