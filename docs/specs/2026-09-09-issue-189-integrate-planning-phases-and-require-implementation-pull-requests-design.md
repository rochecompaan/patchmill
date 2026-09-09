# Issue 189 integrate planning phases and require implementation pull requests design

## Status

This specification awaits document review. Implementation remains dependent on
issue #188's planning phase runner, publisher, reconciler, prompt context, pull
request factory, and strict publication checkpoints being present on the target
branch.

## Summary

Patchmill will route new `run-once` Issue runs through the `planning-pr-v1`
workflow. A focused phase coordinator will compose the durable state, issue
lock, phase workspace, artifact runner, planning pull request publisher, and
reconciler delivered by issues #184 through #188.

The coordinator will implement all four spec and plan gate combinations. It will
stop normally while a required planning pull request awaits human review, then
resume from durable state after that pull request merges. An explicit
`--plan-only` invocation will also have a first-class stopped result instead of
being inferred from an artifact result.

The implementation phase will always receive `allowDirectLand: false`. Patchmill
will accept only an implementation `pr-created` result and will independently
validate the live pull request's repository, base, head, open status, ownership
marker, closing reference, and commit ancestry before persisting success or
starting finish-stage cleanup.

Existing unfinished legacy Run recovery state will continue through the current
comment-and-label pipeline. This slice does not migrate legacy state or change
its behavior.

## Goals

- Select resumable `planning-pr-v1` Issue runs before legacy or new work.
- Protect each new workflow Run attempt with the ownership-ID issue lock.
- Re-read issue and state after lock acquisition before any side effect.
- Execute the exact phase sequence for every gate combination.
- Stop at every required human review without treating review as a failure.
- Preserve `--plan-only`'s explicit boundary before implementation code.
- Require an open, issue-closing, marked implementation pull request.
- Prove that the implementation pull request contains the expected branch head
  descended from the phase base.
- Persist implementation pull request validation before any finish-stage
  cleanup, handoff, or done-label transition.
- Keep redirected JSON, terminal output, run logs, and process exit codes
  complete for the new outcomes.
- Leave active legacy workflow behavior unchanged.

## Non-goals

- Migrate existing legacy Run recovery state.
- Deprecate or remove `--plan-only`, `set-spec`, `set-plan`, approval-label
  configuration, or artifact comments.
- Update installed skill packs, examples, generated configuration, or user
  documentation.
- Remove old approval labels or artifact comments from issues.
- Change issue #188's planning pull request publication and reconciliation
  rules.
- Automatically merge any pull request or replace a closed-unmerged pull
  request.
- Add final live cross-provider acceptance scenarios.
- Add configuration keys or dependencies.

## Approaches considered

### Side-by-side workflow router and focused phase coordinator (chosen)

Keep `runOneIssue()` as the public facade. Route active legacy state to the
existing pipeline and route valid planning state or fresh eligible issues to a
new `planning-pr-v1` pipeline. The new pipeline owns selection revalidation,
locking, phase coordination, implementation pull request proof, and durable
finish boundaries while composing issue #188's focused services.

This approach makes the compatibility boundary explicit, prevents new state from
leaking into the permissive legacy store, and gives the new workflow one strict
source of recovery truth.

### Retrofit the existing label-driven pipeline

The existing pipeline already executes planning and implementation agents, but
it couples stage decisions to approval labels, artifact comments, legacy
checkpoints, and one reused issue workspace. Retrofitting it would require two
state models to authorize the same effects and would make the requirement that
legacy behavior remain unchanged difficult to prove. Reject this approach.

### Validate the implementation pull request after the existing finish stage

This would minimize orchestration changes, but the current finish stage can
publish handoff state, apply the done label, run cleanup hooks, and remove the
workspace before a host-backed pull request validation. A bad or unrelated
agent-returned URL could therefore bypass the new safety boundary. Reject this
approach.

## Architecture

### Workflow routing

`src/cli/commands/run-once/pipeline.ts` remains the exported facade and
delegates to one of two internal paths:

- the current legacy orchestration for an unfinished legacy state that the
  current recovery policy recognizes; or
- the new planning pipeline for a valid `planning-pr-v1` state or a fresh
  eligible issue with no unfinished legacy state.

A planning state file is never interpreted as legacy state. An unknown,
malformed, or unsupported planning state blocks with its path and validation
reason; it does not fall back to a fresh or legacy run. If both workflows appear
active for one issue, routing fails closed before labels, Git, Pi, or host
mutation.

The legacy path retains its existing lease, state, label, artifact-comment,
workspace, direct-land, result, and cleanup behavior. Refactoring needed to
expose the router must remain mechanical and be protected by the existing legacy
scenario tests.

### New planning pipeline

Add a focused planning entry point under `src/cli/commands/run-once/`, separate
from the legacy orchestration. It owns:

1. advisory issue selection and workflow routing;
2. planning issue lock acquisition and post-lock revalidation;
3. fresh planning state initialization and lifecycle claiming;
4. phase coordinator construction;
5. mapping coordinator outcomes to public pipeline results; and
6. ownership-safe lock release in `finally`.

The phase coordinator lives in a separate module. It decides which phase may run
and composes these existing services rather than duplicating them:

- `PlanningStateStore` and `PlanningIssueLock`;
- `PlanningRemoteBaseGit` and `PlanningWorkspaceLifecycle`;
- `runPlanningPhaseArtifacts()`;
- `publishPlanningPhase()`;
- `reconcilePlanningPhase()`;
- `PullRequestHost`; and
- the planning publication Git operations.

Provider commands, Git command sequences, state serialization, and Pi response
parsing remain outside the coordinator.

## Selection, routing, and locking

### Advisory priority

Automatic selection uses these priority buckets in order:

1. the issue named by `--issue`;
2. an open, nonblocked issue with active, nonterminal `planning-pr-v1` state;
3. an open issue with resumable legacy state and the configured `in-progress`
   label; and
4. a new eligible issue with the configured ready label.

Within a bucket, preserve configured priority-label order and then use the issue
number as the deterministic tie-breaker. A malformed planning state associated
with an open issue is reported instead of being skipped in favor of new work.

Planning-state activity, not spec-review or plan-review labels, keeps a new run
selectable. The configured `in-progress` label remains on a planning run while a
pull request is under review or while `--plan-only` has stopped it. A genuine
blocker applies the normal `needs-info` lifecycle state and excludes the run
from automatic selection until a maintainer reapplies the configured ready
label; an explicit retry must pass the normal eligibility checks.

Selection before locking is advisory. A process must not choose another issue
after losing the lock for its selected issue; it returns a stopped or blocking
result and lets a later invocation perform a fresh selection.

### Lock acquisition

For an existing planning run, lock acquisition uses the stored immutable
`runId`. For a fresh issue, Patchmill creates an in-memory initial state with a
new Run ID, then atomically acquires that issue's planning lock before
initializing the state file.

After acquisition, Patchmill re-reads both the issue from the host and planning
state from disk. It verifies:

- the issue number and title still match the selected identity;
- the issue remains open;
- a fresh issue remains eligible, or an existing planning run remains active;
- the state Run ID matches the lock Run ID; and
- no unfinished legacy state appeared during the selection race.

If a competing process initialized state between advisory selection and lock
acquisition, Patchmill releases the provisional lock and retries once with the
now-authoritative Run ID. Any further identity change blocks rather than loops
or guesses.

A fresh state is initialized before the issue is relabeled. A crash can
therefore leave selectable planning state, but cannot leave an `in-progress`
issue with no new-workflow identity.

An `active` lock conflict maps to an explicit non-mutating stop because another
live process owns the work. `stale`, `unverifiable`, and `malformed` lock
conflicts remain blocking operator conditions. Patchmill never removes or
replaces an existing lock automatically. Release succeeds only when the on-disk
ownership ID still matches the attempt.

## Phase coordination

The immutable gate snapshot comes from `workflow.specApproval.required` and
`workflow.planApproval.required` when a fresh state is initialized.
Configuration changes do not alter an active Issue run.

The coordinator reads the first noncomplete phase from the strict completed
prefix. It may advance through phases already satisfied by the fetched base or
through newly reconciled merges in one Run attempt, but it returns whenever the
current phase requires review, explicit stopping, human input, or error
handling.

### Gate matrix

| Spec gate | Plan gate | Coordinator behavior                                                                                                                        |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Disabled  | Disabled  | Create spec and plan in the implementation workspace when absent, then run implementation and require its pull request.                     |
| Enabled   | Disabled  | Publish and await the spec pull request; after merge, create the plan with implementation and require the implementation pull request.      |
| Disabled  | Enabled   | Create spec then plan in one plan workspace, publish and await that planning pull request, then run implementation from the merged base.    |
| Enabled   | Enabled   | Publish and await the spec pull request, then publish and await the plan pull request, then run implementation from the latest merged base. |

A single unambiguous artifact already present on the pinned remote base
satisfies its assigned planning work. Multiple candidates block. An
implementation phase is never completed merely because its `artifactKinds` array
is empty.

### Planning phases

For `spec` and `plan` phases:

1. Reconcile `branch-pushed` or `pull-request-open` state before preparing local
   work.
2. Treat `satisfied-by-base` and a verified `merged` result as phase completion,
   then continue to the next phase.
3. Map an open pull request to `review-pending` and stop normally.
4. Map `closed-unmerged`, `missing`, and `ambiguous` to a blocked Issue run; do
   not create a replacement.
5. For a pending phase, fetch and pin the configured remote base, resolve
   artifacts, create or resume the exact owned workspace when needed, run
   missing artifacts in assignment order, publish through issue #188, and
   classify the published pull request.

No next phase workspace is created until the prior planning pull request is
merged and issue #188's checkpointed local cleanup is complete.

### Explicit `--plan-only` boundary

`--plan-only` remains accepted without adding deprecation behavior in this
slice. The coordinator performs all planning work permitted before
implementation, then returns `stopped` with reason `plan-only`.

If ungated spec or plan work belongs in the implementation phase, the
coordinator may create the implementation workspace and checkpoint those
artifacts, but it does not run implementation code, push that phase, or create
its pull request. If the implementation phase owns no missing planning artifact,
the stop occurs before creating its workspace.

A still-open required planning pull request takes precedence and returns
`review-pending`; it is not mislabeled as a plan-only stop. A later invocation
without `--plan-only` resumes the saved phase workspace or begins the pending
implementation phase.

## Implementation phase

### Implementation execution

Add a planning-workflow implementation runner or extract a state-neutral core
from `pipeline-implementation.ts`. The existing legacy wrapper keeps its current
arguments and behavior. The planning wrapper:

- runs inside the owned implementation phase workspace;
- receives spec and plan paths from the current phase and merged base;
- retains the development-environment, todo, validation, review, visual
  evidence, and Pi repair gates;
- passes a copied Git policy with `allowDirectLand: false`, regardless of the
  configured project value;
- requires the implementation pull request body to contain `Closes #<issue>` and
  the exact final marker
  `<!-- patchmill:planning-pr-v1 issue=<issue> phase=implementation -->`; and
- accepts only the existing `pr-created` agent result.

A `merged` result is a safety failure for `planning-pr-v1`. It is never adapted
into success, even when project configuration and a landing skill would allow
direct landing on the legacy path.

Before host validation, Patchmill verifies that the returned branch is the owned
implementation branch, the workspace is clean, the final local head is a
descendant of the pinned phase base, and every reported implementation commit
exists on the ancestry path from that base to the final head.

### Durable implementation checkpoints

Refine the strict version-1 phase variants introduced by issue #188 so the
implementation phase can record, without weakening planning-phase invariants:

- the sanitized `pr-created` agent evidence needed to reproduce the final
  result;
- resolved target and head repositories;
- the final implementation head observed on the configured remote;
- the validated pull request reference and URL;
- visual-evidence and handoff checkpoints needed before workspace removal;
- the existing owned cleanup discriminator; and
- terminal implementation-pull-request completion.

Implementation evidence is forbidden on `spec` and `plan` phases. It first
becomes durable with a `branch-pushed` implementation checkpoint after local and
remote head proof. A `pull-request-open` implementation checkpoint means that
the complete host validation below succeeded. It must not be possible to
transition to terminal completion, apply the done label, or remove the workspace
from an unvalidated variant.

State replacements preserve the issue #187 rules: exact schemas, immutable Run
identity and gate sequence, one-step revisions, matching lock ownership, and
atomic complete-document replacement.

## Implementation pull request validation

Use the provider-neutral `PullRequestHost` and extend the shared issue #188
planning pull request validator to accept the `implementation` phase. Add a
focused implementation-body validator rather than embedding Markdown matching in
the coordinator.

Validation resolves current target and configured push-remote repositories,
observes the exact remote implementation branch head, reads the agent-returned
canonical pull request reference, and requires all of these facts:

- the target repository equals the resolved target repository;
- the base branch equals the phase's saved configured base branch;
- the head repository equals the resolved configured push destination and is
  allowed by the provider's repository rules;
- the head branch equals the owned implementation branch;
- the host head SHA, exact remote branch head, and clean local workspace head
  are identical;
- the pull request status is `open`;
- the body contains exactly one valid final top-level `planning-pr-v1` marker
  for this issue and the `implementation` phase;
- the body contains an effective top-level `Closes #<issue>` line outside code
  fences, block quotes, and indented code;
- the phase's pinned base object is an ancestor of the pull request head; and
- every reported commit is a descendant of the phase base and an ancestor of the
  pull request head.

The returned URL must parse to the same canonical target repository and pull
request number reported by the host. Human-readable title or body prose does not
supply identity. Authentication, transport, incomplete discovery, malformed
response, identity, status, marker, closing-reference, remote-head, and ancestry
failures remain distinct and fail closed.

Only after every check succeeds does Patchmill persist the validated
`pull-request-open` implementation checkpoint.

## Finish ordering and lifecycle effects

The new workflow uses a planning-state-aware finish wrapper. Existing finish
helpers may be extracted for reuse, but the legacy wrapper and its ordering
remain unchanged.

The new finish order is:

1. Load the durable validated implementation pull request checkpoint.
2. Publish run-cost information and validate any committed visual evidence.
3. Publish the implementation handoff comment with the canonical pull request.
4. Run the configured cleanup hook.
5. Remove the owned clean implementation worktree and checkpoint removal.
6. Remove the owned local branch only after exact remote-head proof and
   checkpoint removal.
7. Ensure and apply the configured done label while removing `in-progress` and
   blocker labels.
8. Persist terminal implementation-pull-request completion.
9. Return the existing `pr-created` public result from durable evidence.

No step in this finish path starts from an unvalidated agent result. In
particular, cleanup hooks, worktree removal, branch removal, handoff
publication, and the done-label transition are unreachable before pull request
validation is durable.

A validation failure preserves the implementation workspace and active state. A
cleanup failure preserves the last strict cleanup checkpoint and leaves the
Issue run selectable. The new workflow does not force-remove, reset, clean, or
silently adopt an uncertain workspace.

## Public results and exit codes

Add `review-pending` and `stopped` pipeline variants. Pipeline-internal variants
retain the full issue summary. `summarizeResult()` produces these stable
redirected forms:

```ts
{
  status: "review-pending";
  issueNumber: number;
  phase: "spec" | "plan";
  prUrl: string;
}

{
  status: "stopped";
  issueNumber: number;
  reason: "plan-only" | "issue-locked";
  nextPhase?: "implementation";
  specPath?: string;
  planPath?: string;
  branch?: string;
  worktreePath?: string;
}
```

Both variants retain normal optional run-log and Pi-session paths.

Result behavior is:

| Status                                                              | Terminal severity | Exit code | Meaning                                                      |
| ------------------------------------------------------------------- | ----------------- | --------- | ------------------------------------------------------------ |
| `review-pending`                                                    | warning           | `0`       | Expected human merge gate; no failure occurred.              |
| `stopped` / `plan-only`                                             | warning           | `0`       | The requested planning-only boundary was reached.            |
| `stopped` / `issue-locked`                                          | warning           | `0`       | Another live process owns the selected Issue run.            |
| validated `pr-created`                                              | success           | `0`       | Implementation pull request validation and finish succeeded. |
| `blocked`, stale/unverifiable/malformed lock, or validation blocker | failure           | `1`       | Human or operator action is required.                        |
| `error`                                                             | failure           | `1`       | An unexpected or provider failure occurred.                  |

Interactive terminal output names the phase and pull request for
`review-pending`. A stopped summary names its reason, next phase, and any
preserved artifacts or workspace. Redirected stdout remains one compact JSON
object. JSONL run logs end with the same summarized status. Existing status
rendering and exit codes remain unchanged.

## Failure handling

- An agent blocker uses the existing blocked result and lifecycle transition.
- An active issue lock returns `stopped/issue-locked` without mutation.
- A stale, unverifiable, or malformed lock reports its safe diagnostic and
  requires operator action; no automatic takeover occurs.
- A post-lock eligibility or workflow-identity change stops before side effects.
- Planning review remains `review-pending`; it does not apply `needs-info`.
- Closed-unmerged, missing, or ambiguous planning pull requests block and are
  not replaced.
- Non-not-found host failures preserve state and propagate; messages are not
  parsed to infer absence.
- A direct-merge implementation result blocks before finish.
- Any implementation pull request proof failure preserves the owned workspace,
  leaves the issue active, and skips every finish effect.
- State or lock conflicts stop all later remote or destructive effects.
- Default errors and serialized result data do not expose pull request bodies,
  raw command output, credentials, state bytes, or Pi transcripts.

## Affected components

The implementation is expected to touch focused areas rather than add more
responsibility to the legacy pipeline:

- `pipeline.ts` and selection helpers for routing and priority;
- a new planning pipeline and phase coordinator under
  `src/cli/commands/run-once/`;
- a planning implementation runner and planning-state-aware finish wrapper;
- `planning-state-types.ts`, validation, and transitions for implementation and
  finish checkpoints;
- prompt construction for the mandatory implementation marker and no-direct-land
  policy;
- shared pull request validation plus a focused closing-reference validator;
- public pipeline/result summary types, terminal formatting, and exit mapping;
  and
- focused coordinator, integration, state, validation, output, and legacy
  regression tests.

Keep orchestration, validation, state, and output modules separate. Split a
module before it grows substantially beyond roughly 200 meaningful lines. Do not
put provider-specific commands or strict-state parsing into the coordinator.

## Verification strategy

These tests pass the Testing Value Gate because they protect reusable state
transitions, concurrency, external side-effect ordering, pull request identity,
and public CLI contracts.

### Coordinator and integration tests

Use fake or recording state, lock, host, Git, workspace, and Pi seams to cover:

- all four gate combinations end in the exact phase and pull request sequence;
- spec and plan pull requests stop with `review-pending` while open;
- a merged planning pull request starts the next phase from a newly fetched
  remote base;
- base-satisfied planning artifacts skip empty pull requests;
- an implementation phase with no artifacts is not base-completed;
- `--plan-only` checkpoints implementation-carried artifacts and stops before
  code, or stops before workspace creation when no artifact is missing;
- resuming without `--plan-only` continues the saved implementation phase;
- approval labels and artifact comments do not control or mutate a new run;
- active nonblocked planning state outranks legacy in-progress and fresh ready
  work;
- deterministic priority and explicit issue selection are preserved;
- state and issue are re-read after the lock and before the first mutation;
- two contenders permit effects from exactly one lock owner;
- active lock contention returns an explicit stop, while other lock
  classifications block without takeover; and
- malformed or conflicting workflow state never falls back to another path.

### Implementation pull request tests

Focused pure and recording tests cover every validation requirement:

- exact target repository and base branch;
- allowed head repository, exact owned branch, and exact shared
  local/remote/host head SHA;
- open status only;
- exact implementation marker issue and phase, including missing, malformed,
  unsupported, and duplicate markers;
- an effective exact closing reference, excluding quoted or fenced examples;
- canonical result URL and reference identity;
- base-to-head and reported-commit ancestry;
- rejection of `merged` regardless of configured direct-land policy; and
- zero finish, label, handoff, hook, or cleanup calls before durable validation.

Failure-injection tests assert that validation persistence precedes finish, that
cleanup checkpoints resume idempotently, and that a cleanup conflict preserves
state and local work.

### Result and compatibility tests

Extend result summary, redirected output, terminal formatting, JSONL
final-event, and `main()` tests for both new statuses and their exit codes.
Assert complete fields for each result without snapshots of static
documentation.

Run the existing legacy planning, implementation, recovery, finish, terminal,
and pipeline scenario suites unchanged. Add routing tests proving unfinished
legacy state still uses its previous labels, comments, worktree, direct-land
policy, result statuses, and cleanup path.

### Validation commands

Focused implementation validation should run the new coordinator, state,
implementation validation, selection, pipeline, and result tests. Final
validation uses:

```sh
npm run test:run-once
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
git diff --check
```

No dependency change is planned, so a Nix build is not required. If
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json` changes
unexpectedly, implementation must also run the repository-required Nix build. No
live GitHub or Forgejo pull request is created by automated validation.

## Compatibility

Fresh eligible issues use `planning-pr-v1`. Existing unfinished legacy state
continues to use the current workflow until separate compatibility work lands.
This slice does not make approval-label fields optional, emit deprecation
warnings, change deprecated commands, or update installed/user documentation.

The new workflow ignores approval labels and issue-published planning artifacts
for phase authorization. It does not delete them. The legacy path continues to
consume and mutate them exactly as it does now.

No glossary or ADR change is required. The design uses the established terms
Run-once workflow, Issue run, Run attempt, Run recovery state, and phase
workspace.

## Acceptance criteria

- Advisory selection prioritizes explicit, active planning, resumable legacy,
  and fresh ready work in that order.
- Every new-workflow side effect follows issue-lock acquisition and
  authoritative post-lock issue/state reads.
- All four gate snapshots produce the approved planning and implementation phase
  sequence.
- Every open required planning pull request returns `review-pending` and stops
  before the next phase.
- `--plan-only` returns an explicit stopped result without running
  implementation code.
- The implementation prompt and runtime force direct landing off, and a `merged`
  result cannot succeed.
- Implementation success requires a live open pull request with the exact
  target, base, head repository, head branch, head SHA, issue/phase marker,
  closing reference, and commit ancestry.
- Pull request validation is durably checkpointed before handoff, labels,
  cleanup hooks, worktree removal, or branch removal.
- Redirected JSON, terminal summaries, JSONL results, and exit codes cover
  `review-pending`, explicit stops, validated success, blockers, and errors.
- Active legacy Run recovery state retains its existing observable behavior.
