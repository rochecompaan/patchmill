# Execute and Publish Planning Pull Request Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run spec and plan agents in owned phase workspaces, publish each exact
phase head through one recoverable planning pull request, clean up local phase
resources through durable checkpoints, and verify merged artifacts on the saved
base branch.

**Architecture:** Refine the issue #187 strict phase-state graph first, then
keep local Git proof, agent execution, pull request identity, remote
publication, and reconciliation behind focused seams. The publisher owns
mutation order and checkpointed cleanup; the reconciler owns status
classification and merged-base proof. These services remain callable but unwired
from the legacy run-once pipeline in this issue.

**Tech Stack:** TypeScript, Node.js 24, Node's `node:test` runner, Git CLI
through `CommandRunner`, the issue #184 `PullRequestHost` contract, issues #185
and #186 host adapters, issue #187 planning state/workspace services, Prettier,
ESLint, strict TypeScript, and dependency-cruiser.

**Spec:**
`docs/specs/2026-09-08-issue-188-execute-and-publish-planning-pull-request-phases-design.md`

## Global Constraints

- Begin implementation only after the issue #187 durable planning state and
  workspace changes are present; rebase onto their merged commit rather than
  recreating predecessor modules in this issue.
- Preserve state `version: 1`, `workflowVersion: "planning-pr-v1"`, strict
  unknown-field rejection, immutable Issue run identity, one-step revisions,
  atomic complete-document replacement, and ownership-ID lock checks.
- Publish only caller-selected `spec` and `plan` phases. The reusable artifact
  runner may prepare artifacts assigned to `implementation`, but this issue does
  not publish or enforce an implementation pull request.
- Run every planning agent in the exact owned phase worktree and in assignment
  order; spec precedes plan when both belong to one phase.
- Treat zero, one, and multiple remote-base artifact candidates distinctly. A
  phase is satisfied only by one candidate per assigned artifact; ambiguity
  blocks before workspace or agent mutation.
- Validate returned repository-relative artifact paths, configured-directory
  containment, regular-file mode, exact live `HEAD`, ancestry, changed paths,
  and tracked/untracked/ignored cleanliness before every artifact checkpoint.
- Push exactly the saved phase object ID to its deterministic remote branch.
  Never force-push, rebase, merge, delete the remote phase branch, or adopt a
  conflicting remote object ID.
- Resolve target and push-remote repository identities before push. GitHub
  requires the same repository; Forgejo permits a different owner/repository on
  the same provider host.
- Search all pull request states exhaustively before create. Adopt only one pull
  request matching both repositories, both branches, the exact head object ID,
  issue, phase, canonical reference/URL, and exactly one `planning-pr-v1`
  marker.
- Never rewrite an adopted pull request body. Human text may differ as long as
  the one exact ownership marker remains valid.
- Follow this durable order: validate; resolve repositories; inspect/push exact
  head; persist `branch-pushed`; discover/create/read back; persist
  `pull-request-open/ready`; remove worktree; persist
  `pull-request-open/worktree-removed`; remove local branch; persist
  `pull-request-open/removed`; classify status.
- No later remote or destructive local effect may run after a checkpoint write
  fails. Retries recover push by exact remote-head observation, pull request
  create by exhaustive discovery, and cleanup through issue #187 idempotent
  lifecycle operations.
- Only `PullRequestNotFoundError` proves a missing saved pull request.
  Authentication, authorization, rate-limit, transport, incomplete-search,
  invalid-JSON, malformed-response, and identity failures propagate without a
  phase-state replacement.
- `review-pending`, `merged`, and `satisfied-by-base` remain distinct from the
  blocking `closed-unmerged`, `missing`, and `ambiguous` outcomes. Do not create
  a replacement for a blocking outcome.
- A host-reported merge completes only after cleanup is `removed`, the saved
  remote/base branch is freshly fetched, the merge object is an ancestor of the
  fetched tip, and every expected artifact is a regular file at both objects.
- On merge, trust artifact files from the fetched base and do not compare their
  blobs to the old workspace commit; reviewer edits and squash/rebase merges
  must be preserved.
- Error messages and enumerable fields must not expose pull request bodies, raw
  command output, credentials, credential-bearing remote URLs, state bytes, or
  Pi transcripts. Raw command diagnostics may be retained only as explicitly
  non-enumerable data.
- Keep effect modules focused and target fewer than 200 meaningful lines. Split
  cleanup or validation by behavior before growing publisher/reconciler files
  substantially beyond that target.
- Do not route these services from `pipeline.ts` or `stage-advancement.ts`,
  change lifecycle labels/comments, add compatibility migration or user docs, or
  make live GitHub/Forgejo mutations in tests.
- Add no dependency or configuration key. If `package.json`,
  `package-lock.json`, or `npm-shrinkwrap.json` changes unexpectedly, run the
  repository-required Nix build in addition to all commands below.

---

## File and Module Map

### Durable workflow state

- Modify `src/workflow/planning-state-types.ts` for partial workspace artifacts,
  immutable publication evidence, canonical pull request evidence, cleanup
  progress, and merged-base evidence.
- Modify `src/workflow/planning-state-validation.ts` for strict variant parsing
  and document-level publication/cleanup/merge invariants.
- Modify `src/workflow/planning-state-transitions.ts` for the exact checkpoint
  graph and evidence immutability rules.
- Modify `src/workflow/planning-state.test.ts` for round trips, invalid states,
  all valid edges, skipped-edge rejection, and idempotent replacements.

### Git proof and publication

- Create `src/git/planning-publication-git.ts` for artifact commit/worktree
  validation, exact remote-head inspection/push, commit ancestry, and committed
  regular-file proof.
- Create `src/git/planning-publication-git.test.ts` for recording-runner
  contracts and real-Git side-effect/recovery tests with a local bare remote.

### Agent execution and prompts

- Modify `src/cli/commands/run-once/prompts.ts` to add explicit planning review
  context while defaulting existing callers to `legacy-label`.
- Modify `src/cli/commands/run-once/prompts.test.ts` for all five context modes
  and unchanged legacy text.
- Create `src/cli/commands/run-once/planning-phase-artifacts.ts` for pure
  remote-base resolution and ordered, checkpointed artifact execution.
- Create `src/cli/commands/run-once/planning-phase-artifacts.test.ts` for
  sequencing, resume, blocked results, validation, and checkpoint order.

### Pull request identity and host construction

- Create `src/workflow/planning-pull-request-validation.ts` for provider-neutral
  repository rules, exact summary/reference/URL/branch/head/marker validation,
  and sanitized typed failures.
- Create `src/workflow/planning-pull-request-validation.test.ts` for exact
  adoption rules and confidential error surfaces.
- Modify `src/host/factory.ts` to add the dedicated `createPullRequestHost()`
  factory.
- Modify `src/host/factory.test.ts` to verify GitHub and Forgejo planning
  adapter construction without changing existing provider factories.

### Publication and reconciliation services

- Create `src/cli/commands/run-once/planning-phase-cleanup.ts` for the two
  checkpointed, idempotent local cleanup steps shared by publication and
  reconciliation.
- Create `src/cli/commands/run-once/planning-phase-publisher.ts` for workspace
  validation, repository resolution, exact push recovery, exhaustive discovery,
  create/adopt/read-back, state persistence, and cleanup orchestration.
- Create `src/cli/commands/run-once/planning-phase-publisher.test.ts` for
  ordered effect recording and failure injection after every side effect.
- Create `src/cli/commands/run-once/planning-phase-reconciler.ts` for exact read
  or discovery, cleanup gating, status classification, saved-base merge proof,
  and completion persistence.
- Create `src/cli/commands/run-once/planning-phase-reconciler.test.ts` for every
  reconciliation outcome, unchanged-state host failures, and human-edited merge
  artifacts.

No production import is added from `pipeline.ts`, `stage-advancement.ts`, or the
legacy Run recovery state.

## Shared Public Shapes

Use these names consistently across tasks:

```ts
// src/workflow/planning-state-types.ts
export type PlanningPublicationEvidence = Readonly<{
  targetRepository: RepositoryIdentity;
  headRepository: RepositoryIdentity;
  baseBranch: string;
  headBranch: string;
  headOid: string;
}>;

export type PlanningPullRequestEvidence = Readonly<{
  reference: PullRequestReference;
  url: string;
}>;

export type WorkspaceReadyPlanningPhase = Readonly<{
  kind: PlanningPhaseKind;
  status: "workspace-ready";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
}>;

export type BranchPushedPlanningPhase = Readonly<{
  kind: PlanningPhaseKind;
  status: "branch-pushed";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
}>;
```

`pull-request-open` retains `base`, `workspace`, complete `artifacts`, and
`publication`, then adds `pullRequest`. Its workspace cleanup is `ready`,
`worktree-removed`, or `removed`. Merged completion retains the same evidence,
requires cleanup `removed`, and adds:

```ts
completion: Readonly<{
  kind: "merged-pull-request";
  mergeOid: string;
  mergedBaseOid: string;
}>;
```

The shared service result remains:

```ts
export type PlanningPhaseReconciliation =
  | { kind: "review-pending"; pullRequest: PullRequestSummary }
  | { kind: "merged"; pullRequest: PullRequestSummary; baseOid: string }
  | { kind: "satisfied-by-base"; artifacts: PlanningArtifactEvidence[] }
  | { kind: "closed-unmerged"; pullRequest: PullRequestSummary }
  | { kind: "missing"; reference?: PullRequestReference }
  | { kind: "ambiguous"; pullRequests: PullRequestSummary[] };
```

## Testing Value Gate

All planned automated tests pass Patchmill's Testing Value Gate:

- State and identity tests prove reusable strict parsing, authorization,
  checkpoint ordering, and immutable recovery evidence.
- Artifact-runner tests prove agent sequencing, validation, blocked-result
  behavior, and a resumable same-phase spec checkpoint.
- Recording effect tests prove external side-effect order and stop behavior at
  meaningful interruption boundaries.
- Real-Git tests prove non-force push recovery/conflict handling, destructive
  cleanup preconditions, ancestry, regular-file modes, and preservation of
  human-edited merged artifacts.
- Prompt tests protect behavior visible to planning agents and prevent the
  meaningful regression of describing an unapproved same-phase spec as approved.
- No new test asserts documentation text, a dependency version, lockfile bytes,
  static configuration, or import spelling. Dependency absence, legacy
  non-wiring, module size, and forbidden command usage are checked directly in
  Task 8.

---

### Task 1: Refine durable planning publication state

**Files:**

- Modify: `src/workflow/planning-state-types.ts`
- Modify: `src/workflow/planning-state-validation.ts`
- Modify: `src/workflow/planning-state-transitions.ts`
- Modify: `src/workflow/planning-state.test.ts`

**Interfaces:**

- Consumes: issue #187 `PlanningStateV1`, `PlanningArtifactEvidence`, base and
  workspace ownership evidence, strict parser, and replacement validator.
- Consumes: `RepositoryIdentity` and `PullRequestReference` from
  `src/host/pull-requests.ts`.
- Produces: `PlanningPublicationEvidence`, canonical
  `PlanningPullRequestEvidence`, `branch-pushed`, partial `workspace-ready`,
  checkpointed `pull-request-open`, and `mergedBaseOid` completion.
- Preserves: `PlanningStateStore.replace()` and its lock/revision behavior; the
  store needs no new mutation API.

- [ ] **Step 1: Update valid fixtures and write round-trip tests for every new
      phase discriminator**

Add fixture builders whose exact progression is:

```text
pending
workspace-ready []
workspace-ready [remote-base spec]
workspace-ready [workspace spec]
workspace-ready [workspace spec, workspace plan]
branch-pushed
pull-request-open/ready
pull-request-open/worktree-removed
pull-request-open/removed
complete/merged-pull-request
```

Round-trip each through `serializePlanningState()` and `parsePlanningState()`.
Also retain direct `pending -> complete/remote-base` coverage.

- [ ] **Step 2: Run the focused state test to prove RED**

```sh
node --test src/workflow/planning-state.test.ts
```

Expected: FAIL because `workspace-ready` cannot contain artifacts,
`branch-pushed` is unknown, pull request evidence lacks publication/URL fields,
and merged completion lacks `mergedBaseOid`.

- [ ] **Step 3: Refine the version-1 state declarations**

Replace the issue #187 pull request shape with the shared public shapes above.
Define the exact phase union as:

```ts
export type PlanningPhaseStateV1 =
  | Readonly<{ kind: PlanningPhaseKind; status: "pending" }>
  | WorkspaceReadyPlanningPhase
  | BranchPushedPlanningPhase
  | PullRequestOpenPlanningPhase
  | RemoteBaseCompletePlanningPhase
  | MergedPullRequestCompletePlanningPhase;
```

A `workspace-ready.artifacts` array is an ordered unique prefix/subset of the
phase's assigned artifact kinds. `branch-pushed`, `pull-request-open`, and both
completion variants require complete artifact evidence.

- [ ] **Step 4: Write strict parser and cross-field rejection tests**

Table-test unknown/missing keys and contradictions for every variant. Cover:

- partial artifacts out of planner order, duplicate kinds, or an unassigned
  kind;
- workspace-source evidence not at the current workspace head;
- remote-base evidence not at the original pinned base/candidate path;
- incomplete artifacts in `branch-pushed` or `pull-request-open`;
- target/head provider mismatch, invalid repository values, branch disagreement,
  or publication head different from workspace head;
- pull request reference target different from publication target, invalid
  positive number, or unsafe URL syntax;
- cleanup progress before pull request identity is durable;
- cleanup `pushedHeadOid` different from publication/workspace head;
- merged completion before cleanup `removed`, missing `mergedBaseOid`, or an
  artifact whose source/OID is not `remote-base`/`mergedBaseOid`.

Assert stable `PlanningStateValidationError.reason` and JSON path without
serializing state bytes into the error.

- [ ] **Step 5: Implement strict parsing and document invariants**

Give each discriminator its exact key set. Parse publication repository
identities with the existing provider values and bounded single-line fields.
Parse pull request URLs as HTTP(S), reject credentials, query, fragment, CR/LF,
and invalid URLs, but leave provider-specific summary matching to Task 5.

Apply these document rules:

1. `workspace-ready.artifacts` is an ordered unique subset of assigned kinds.
2. Later variants contain every assigned kind in planner order.
3. Publication base/head branches equal saved base/workspace branches; `headOid`
   equals `workspace.headOid`.
4. Pull request reference target equals publication target.
5. `branch-pushed` has cleanup `ready`.
6. Pull request cleanup advances only through `ready`,
   `worktree-removed(pushedHeadOid)`, and `removed(pushedHeadOid)`.
7. Merged completion keeps original base/publication/pull request/workspace
   identity, requires cleanup `removed`, and uses `mergedBaseOid` for all
   resulting artifact evidence.

- [ ] **Step 6: Write the complete replacement-transition matrix**

Test every allowed edge and a skipped/backward counterpart:

```text
pending -> pending | workspace-ready | complete/remote-base
workspace-ready -> workspace-ready | branch-pushed
branch-pushed -> branch-pushed | pull-request-open/ready
pull-request-open/ready -> same | pull-request-open/worktree-removed
pull-request-open/worktree-removed -> same | pull-request-open/removed
pull-request-open/removed -> same | complete/merged-pull-request
complete/* -> same complete/*
```

For `workspace-ready -> workspace-ready`, permit only appending the next
assigned artifact or an exact idempotent replacement. If `workspace.headOid`
advances, require every existing workspace-source artifact OID to advance with
it while remote-base evidence stays unchanged. After `branch-pushed`, freeze
workspace head, artifact paths/OIDs, both repositories, both branches, and
publication head. At merge, permit artifact source/OID replacement only as the
all-at-once conversion to remote-base evidence at `mergedBaseOid`.

- [ ] **Step 7: Implement transition validation**

Update `phaseName()` and `allowedTransitions` to match Step 6. Keep cleanup
proof and publication/pull request evidence immutable after each durable
boundary. Reject cleanup regression, pull request replacement, publication
mutation, skipped checkpoints, partial merge conversion, and all revision or
Issue run identity changes through the existing stable validation error.

- [ ] **Step 8: Format and validate state/store compatibility**

```sh
npx --no-install prettier --write \
  src/workflow/planning-state-types.ts \
  src/workflow/planning-state-validation.ts \
  src/workflow/planning-state-transitions.ts \
  src/workflow/planning-state.test.ts
node --test \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-store.test.ts
npm run check:contract-tests
npm run check:types
npm run check:architecture
```

Expected: strict state and store tests PASS; atomic storage and issue-lock APIs
remain unchanged.

- [ ] **Step 9: Commit the state refinement**

```sh
git add \
  src/workflow/planning-state-types.ts \
  src/workflow/planning-state-validation.ts \
  src/workflow/planning-state-transitions.ts \
  src/workflow/planning-state.test.ts
git commit -m "feat(workflow): checkpoint planning publication state"
```

---

### Task 2: Add exact Git validation and publication operations

**Files:**

- Create: `src/git/planning-publication-git.ts`
- Create: `src/git/planning-publication-git.test.ts`

**Interfaces:**

- Consumes: `CommandRunner` from `src/process/command.ts` and issue #187
  workspace ownership evidence.
- Produces: `PlanningPublicationOperations`, `PlanningPublicationGit`,
  `PlanningRemoteHead`, `PlanningPublicationGitError`, and stable
  operation/reason unions.
- Does not consume host/provider modules; `src/git/` stays below the outer-layer
  architecture boundary.

Use this public surface:

```ts
export type PlanningRemoteHead =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "present"; headOid: string }>;
export type PlanningArtifactCommitInput = Readonly<{
  workspacePath: string;
  previousHeadOid: string;
  headOid: string;
  artifactPath: string;
}>;
export type PlanningWorkspaceVerificationInput = Readonly<{
  workspacePath: string;
  baseOid: string;
  headOid: string;
  artifactPaths: readonly string[];
}>;
export type PlanningRemoteBranchInput = Readonly<{
  remote: string;
  branch: string;
}>;
export type PlanningExactPushInput = PlanningRemoteBranchInput &
  Readonly<{ headOid: string }>;
export type PlanningAncestryInput = Readonly<{
  ancestorOid: string;
  descendantOid: string;
}>;
export type PlanningRegularFilesInput = Readonly<{
  commitOid: string;
  paths: readonly string[];
}>;

export interface PlanningPublicationOperations {
  verifyArtifactCommit(input: PlanningArtifactCommitInput): Promise<void>;
  verifyWorkspace(input: PlanningWorkspaceVerificationInput): Promise<void>;
  inspectRemoteHead(
    input: PlanningRemoteBranchInput,
  ): Promise<PlanningRemoteHead>;
  ensureRemoteHead(
    input: PlanningExactPushInput,
  ): Promise<Readonly<{ pushed: boolean; headOid: string }>>;
  assertAncestor(input: PlanningAncestryInput): Promise<void>;
  assertRegularFiles(input: PlanningRegularFilesInput): Promise<void>;
}

export class PlanningPublicationGit implements PlanningPublicationOperations {
  constructor(input: { runner: CommandRunner; repoRoot: string });
  verifyArtifactCommit(input: PlanningArtifactCommitInput): Promise<void>;
  verifyWorkspace(input: PlanningWorkspaceVerificationInput): Promise<void>;
  inspectRemoteHead(
    input: PlanningRemoteBranchInput,
  ): Promise<PlanningRemoteHead>;
  ensureRemoteHead(
    input: PlanningExactPushInput,
  ): Promise<Readonly<{ pushed: boolean; headOid: string }>>;
  assertAncestor(input: PlanningAncestryInput): Promise<void>;
  assertRegularFiles(input: PlanningRegularFilesInput): Promise<void>;
}
```

- [ ] **Step 1: Write failing artifact/workspace validation tests**

Use a recording runner to prove `verifyArtifactCommit()` checks, in order:

1. exact worktree `HEAD^{commit}` equals returned `headOid`;
2. `previousHeadOid` is an ancestor of `headOid`;
3. the artifact's exact `ls-tree -z` entry is mode `100644` or `100755`, type
   `blob`, at the expected repository-relative path;
4. `git diff --name-only -z previousHeadOid headOid --` contains only that path;
5. `git status --porcelain=v1 -z --untracked-files=all --ignored=matching` is
   empty.

Add meaningful rejection cases for absolute/path-escape input, missing commit,
wrong live head, non-descendant head, symlink, gitlink/submodule, absent
artifact, unrelated changed path, malformed Git output, and
tracked/untracked/ignored residue. `verifyWorkspace()` must prove the saved
head, base ancestry, every expected committed regular file, and the same strict
cleanliness before publication.

- [ ] **Step 2: Write failing exact remote-head and push-recovery tests**

Assert `inspectRemoteHead()` uses:

```ts
["ls-remote", "--exit-code", "--heads", "--", remote, `refs/heads/${branch}`];
```

Treat Git's exact no-match exit as `missing`; reject every other nonzero result
as a command failure and malformed/multiple/wrong-ref output as a response
failure.

For `ensureRemoteHead()`, cover:

- absent => one exact non-force push, post-push observation, `pushed: true`;
- already equal => no push, `pushed: false`;
- different OID => conflict and no push;
- post-push absent/different => conflict.

Require the push refspec to be exactly `<headOid>:refs/heads/<branch>` and
assert arguments contain no `--force`, `-f`, or leading `+`.

- [ ] **Step 3: Run the new Git test to prove RED**

```sh
node --test src/git/planning-publication-git.test.ts
```

Expected: FAIL because the publication Git adapter does not exist.

- [ ] **Step 4: Implement safe scalar, response, and error handling**

Reuse issue #187 full-OID, branch, repository-relative path, and single-line
validation. Bind the adapter to one canonical repository root. Resolve the
workspace path, require it to be a real directory supplied by the owned
workspace caller, and pass values only as command-array arguments.

`PlanningPublicationGitError` exposes only stable `operation`, `reason`, and
optional `exitCode`; attach raw `CommandResult` diagnostics as frozen,
non-enumerable data. Do not place a remote URL, command arguments, stdout, or
stderr in its message or enumerable fields.

- [ ] **Step 5: Implement artifact and workspace proof**

Use `git -C <workspace>` for live-head, diff, tree, and status checks. Strictly
parse NUL output and require exactly one regular-file tree entry per requested
path. A `merge-base --is-ancestor` exit `1` is a stable `not-ancestor` conflict;
other nonzero results are command failures. Reject any nonempty status,
including ignored content, rather than filtering operator files.

- [ ] **Step 6: Implement remote inspection, exact push, ancestry, and tree
      proof**

`ensureRemoteHead()` performs inspect -> optional push -> inspect. Push through:

```ts
await runner.run(
  "git",
  [
    "push",
    "--porcelain",
    "--no-force",
    "--",
    remote,
    `${headOid}:refs/heads/${branch}`,
  ],
  { cwd: repoRoot },
);
```

Require the final remote OID to equal `headOid` before returning. Implement
`assertAncestor()` and `assertRegularFiles()` as read-only object checks used by
reconciliation; neither fetches or resolves a moving branch.

- [ ] **Step 7: Add real-Git regression tests**

Create a temporary seed repository and local bare remote. Prove:

- absent branch publication and matching-head retry;
- a conflicting remote head blocks without changing it;
- a local saved commit can be pushed by full OID from the linked-worktree object
  database;
- symlink and gitlink modes fail regular-file proof;
- merge ancestry succeeds for an ancestor and blocks an unrelated commit;
- dirty and ignored worktree content blocks validation.

Capture commands and assert no force push, reset, clean, merge, rebase, or
remote branch deletion occurs.

- [ ] **Step 8: Format, run focused Git validation, and commit**

```sh
npx --no-install prettier --write \
  src/git/planning-publication-git.ts \
  src/git/planning-publication-git.test.ts
node --test \
  src/git/planning-publication-git.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/git/planning-remote-base.test.ts
npm run check:types
npm run check:architecture
git add \
  src/git/planning-publication-git.ts \
  src/git/planning-publication-git.test.ts
git commit -m "feat(git): publish exact planning phase heads"
```

---

### Task 3: Add explicit planning review prompt contexts

**Files:**

- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/prompts.test.ts`

**Interfaces:**

- Produces: `PlanningReviewContext` and an optional `reviewContext` on
  `SpecCreationPromptInput` and `PlanCreationPromptInput`.
- Preserves: every existing caller by defaulting omitted context to
  `legacy-label` with byte-for-byte equivalent legacy review instructions.
- Consumed by: Task 4's artifact runner.

- [ ] **Step 1: Write failing tests for the five review contexts**

Define the union:

```ts
export type PlanningReviewContext =
  | "dedicated-pull-request"
  | "same-phase-pull-request"
  | "merged-base"
  | "implementation-pull-request"
  | "legacy-label";
```

Add tests that assert these behaviors:

- dedicated spec/plan: the artifact is reviewed in the current planning pull
  request;
- same phase: spec and plan share the current plan pull request, and the spec is
  not called already approved;
- merged base: the plan treats the prior spec as coming from a verified merged
  planning pull request on the saved base;
- implementation: the ungated artifact travels with implementation code in the
  implementation pull request;
- omitted/legacy: all existing approval-label wording and result contracts stay
  unchanged.

- [ ] **Step 2: Run focused prompt tests to prove RED**

```sh
node --test --test-name-pattern="planning|review context|legacy" \
  src/cli/commands/run-once/prompts.test.ts
```

Expected: FAIL because the prompt inputs do not accept or render review context.

- [ ] **Step 3: Implement narrow context rendering**

Add one private renderer beside the current spec/plan workflow construction. Use
these exact concepts in generated instructions:

```text
dedicated-pull-request: review this artifact in the current planning pull request
same-phase-pull-request: review spec and plan together; do not call the spec already approved
merged-base: use the verified merged-base spec as source material
implementation-pull-request: carry this artifact with implementation code; no planning PR is created for it
legacy-label: preserve the current manual approval-label instruction
```

Do not refactor unrelated sections of the already-large prompt module. Context
changes the review explanation only; the existing configured planning skill,
self-review/plan validation, artifact path, commit-only-artifact, todo, Testing
Value Gate, blocker, and terminal JSON instructions remain present.

- [ ] **Step 4: Format, validate all prompt behavior, and commit**

```sh
npx --no-install prettier --write \
  src/cli/commands/run-once/prompts.ts \
  src/cli/commands/run-once/prompts.test.ts
node --test src/cli/commands/run-once/prompts.test.ts
npm run check:types
npm run check:architecture
git add \
  src/cli/commands/run-once/prompts.ts \
  src/cli/commands/run-once/prompts.test.ts
git commit -m "feat(run-once): describe planning pull request review"
```

---

### Task 4: Implement the artifact phase runner

**Files:**

- Create: `src/cli/commands/run-once/planning-phase-artifacts.ts`
- Create: `src/cli/commands/run-once/planning-phase-artifacts.test.ts`

**Interfaces:**

- Consumes: `PlannedPhase`, issue #187 pinned base/workspace evidence,
  `PlanningPublicationGit`, `buildSpecPath()`, `buildPlanPath()`, prompt
  builders, `runPiPrompt()`, and `runOncePlanningPiProfile()`.
- Produces: pure base resolution plus a runner that receives one owned
  `workspace-ready` phase and checkpoints each verified artifact through a
  caller callback.

Use these seams:

```ts
export type PlanningPhaseArtifactResolution =
  | Readonly<{
      kind: "satisfied-by-base";
      artifacts: readonly PlanningArtifactEvidence[];
    }>
  | Readonly<{
      kind: "workspace-required";
      artifacts: readonly PlanningArtifactEvidence[];
      missing: readonly PlanningArtifactKind[];
    }>;

export interface PlanningArtifactAgent {
  run(input: {
    kind: PlanningArtifactKind;
    cwd: string;
    prompt: string;
  }): Promise<AgentIssuePiResult>;
}

export type PlanningArtifactCheckpoint = (
  phase: Extract<PlanningPhaseStateV1, { status: "workspace-ready" }>,
) => Promise<void>;

export function resolvePlanningPhaseArtifacts(input: {
  phase: PlannedPhase;
  base: PlanningRemoteBaseSnapshot;
}): PlanningPhaseArtifactResolution;

export async function runPlanningPhaseArtifacts(input: {
  issue: IssueSummary;
  phase: PlannedPhase;
  current: Extract<PlanningPhaseStateV1, { status: "workspace-ready" }>;
  repoRoot: string;
  specsDir: string;
  plansDir: string;
  projectPolicy: PatchmillProjectPolicy;
  skills: PatchmillSkillsConfig;
  triageLabels: PromptTriageLabels;
  artifactDate: Date;
  agent: PlanningArtifactAgent;
  git: Pick<PlanningPublicationOperations, "verifyArtifactCommit">;
  checkpoint: PlanningArtifactCheckpoint;
}): Promise<
  | { kind: "workspace-ready"; phase: WorkspaceReadyPlanningPhase }
  | { kind: "blocked"; result: AgentIssueBlockedResult }
>;
```

- [ ] **Step 1: Write base-resolution tests**

Cover spec-only, plan-only, same-phase `spec -> plan`, and
implementation-carried assignments. For each assigned kind assert:

- zero candidates appears in `missing`;
- one candidate becomes `source: "remote-base"` at `base.baseOid`;
- mixed same-phase candidates retain planner order;
- all single candidates return `satisfied-by-base`;
- more than one candidate throws a sanitized
  `PlanningPhaseArtifactError("ambiguous-base-artifact")` before any supplied
  workspace preparation or agent callback can run.

The later integration caller must invoke this pure resolver before issue #187
`PlanningWorkspaceLifecycle.prepare()`.

- [ ] **Step 2: Write ordered agent/checkpoint tests**

Use recording fakes and assert this event order for a same-phase run:

```ts
assert.deepEqual(events, [
  "agent:spec",
  "git:verify-spec",
  "checkpoint:spec",
  "agent:plan",
  "git:verify-plan",
  "checkpoint:spec+plan",
]);
```

After the plan commit, assert both workspace-source artifacts use the latest
saved workspace head. Start a retry from the first checkpoint and assert the
spec agent is skipped, the plan uses the saved spec/head, and no previous
artifact is lost.

- [ ] **Step 3: Write result, path, and blocked-flow tests**

Cover:

- `spec-created`/`plan-created` with required nonempty commit OID;
- wrong terminal result kind, missing commit, or missing result path;
- absolute paths, `..` escapes, backslashes, wrong configured artifact
  directory, symlink/submodule/regular-file failures delegated to the Git seam;
- returned commit missing, wrong live head, non-descendant, unrelated changes,
  and dirty residue delegated to the Git seam;
- a blocked spec returns unchanged prior state and never runs plan;
- a checkpoint failure stops before the next agent and propagates without
  updating the in-memory phase.

- [ ] **Step 4: Run the artifact test to prove RED**

```sh
node --test src/cli/commands/run-once/planning-phase-artifacts.test.ts
```

Expected: FAIL because the artifact phase service does not exist.

- [ ] **Step 5: Implement resolution, context selection, and exact path
      containment**

Resolve candidates in `phase.artifactKinds` order. For agent prompts select:

```ts
phase.kind === "implementation"
  ? "implementation-pull-request"
  : phase.artifactKinds.length > 1
    ? "same-phase-pull-request"
    : kind === "plan" && current.artifacts.some((a) => a.kind === "spec")
      ? "merged-base"
      : "dedicated-pull-request";
```

Mirror configured spec/plan directories into the owned workspace using the
existing `configuredPathRelativeToRepo()` convention. Normalize each returned
path to `/`, require repository-relative containment in the matching mirrored
directory, and pass that exact path to Git verification. Do not accept a path
merely because its basename looks correct.

- [ ] **Step 6: Implement the production planning-agent adapter**

Export a small `createPlanningArtifactAgent()` that computes
`runOncePlanningPiProfile(skills, workspaceRoot)` for each run and calls
`runPiPrompt(runner, workspaceRoot, prompt, ...)` with:

```ts
{
  stage: "pi-plan",
  issueNumber,
  repoRoot: workspaceRoot,
  skillPaths: profile.additionalSkillPaths,
  extensionArgs: profileExtensionArgs(profile),
  observeSession: true,
  ...callerObservationAndProgressOptions,
}
```

Keep the fakeable `PlanningArtifactAgent` seam so service tests create no Pi
session. Reuse existing prompt result parsing and blocked-result types rather
than creating a second JSON parser.

- [ ] **Step 7: Implement post-agent checkpointing**

For each still-missing kind:

1. Build the expected path and prompt in the phase workspace.
2. Await the matching agent terminal result.
3. Return immediately on `blocked`.
4. Normalize and directory-check its returned path and require its commit.
5. Call `verifyArtifactCommit()` using the previously saved workspace head.
6. Advance `workspace.headOid` to the verified commit.
7. Update every existing workspace-source artifact OID to that new head and
   append the newly verified artifact in planner order.
8. Await `checkpoint(nextWorkspaceReadyPhase)` before invoking another agent.

The service does not push, call a host, publish comments, mutate labels, or
remove a workspace.

- [ ] **Step 8: Format, run focused runner tests, and commit**

```sh
npx --no-install prettier --write \
  src/cli/commands/run-once/planning-phase-artifacts.ts \
  src/cli/commands/run-once/planning-phase-artifacts.test.ts
node --test \
  src/cli/commands/run-once/planning-phase-artifacts.test.ts \
  src/cli/commands/run-once/prompts.test.ts \
  src/cli/commands/run-once/pi.test.ts
npm run check:contract-tests
npm run check:types
npm run check:architecture
git add \
  src/cli/commands/run-once/planning-phase-artifacts.ts \
  src/cli/commands/run-once/planning-phase-artifacts.test.ts
git commit -m "feat(run-once): run planning phase artifacts"
```

---

### Task 5: Add exact pull request validation and factory wiring

**Files:**

- Create: `src/workflow/planning-pull-request-validation.ts`
- Create: `src/workflow/planning-pull-request-validation.test.ts`
- Modify: `src/host/factory.ts`
- Modify: `src/host/factory.test.ts`

**Interfaces:**

- Consumes: normalized `PullRequestSummary`, state publication evidence,
  `parsePlanningPullRequestMarker()`, `parsePullRequestUrl()`, and repository
  identity comparison.
- Produces: `assertPlanningPublicationRepositories()` and
  `validatePlanningPullRequestSummary()` with sanitized typed failures.
- Produces: `createPullRequestHost()` returning the existing `PullRequestHost`
  interface.

Use this validation result:

```ts
export type ValidatedPlanningPullRequest = Readonly<{
  summary: PullRequestSummary;
  reference: PullRequestReference;
  url: string;
}>;

export function validatePlanningPullRequestSummary(input: {
  summary: PullRequestSummary;
  issueNumber: number;
  phase: "spec" | "plan";
  publication: PlanningPublicationEvidence;
  expectedReference?: PullRequestReference;
}): ValidatedPlanningPullRequest;
```

- [ ] **Step 1: Write provider repository-rule and exact-summary tests**

Assert publication accepts:

- GitHub only when target and head are the same repository identity;
- Forgejo when provider and case-insensitive host match, including cross-owner
  or cross-repository heads.

Reject mixed providers, cross-host Forgejo, and forked/cross-repository GitHub.
For summaries, mutate one field at a time and reject target repository, head
repository, base branch, head branch, head SHA, issue marker, phase marker,
workflow version, reference number/target, URL provider path, URL owner/repo,
URL number, duplicate marker, missing marker, unsupported marker, and malformed
URL.

- [ ] **Step 2: Write confidentiality tests**

Use bodies containing credentials and sentinel private text. Catch every marker
parser/identity failure and map it to `PlanningPullRequestValidationError` whose
enumerable data contains only `reason`. Assert `JSON.stringify(error)`,
`error.message`, and enumerable fields do not contain the body, URL credentials,
command output, or sentinel.

- [ ] **Step 3: Run validation tests to prove RED**

```sh
node --test src/workflow/planning-pull-request-validation.test.ts
```

Expected: FAIL because the shared exact validation helper does not exist.

- [ ] **Step 4: Implement exact validation**

Call `assertPlanningPublicationRepositories()` before remote mutation. For a
summary, compare repository identities case-insensitively through
`sameRepositoryIdentity()` while requiring branch and OID strings exactly. Parse
the one final top-level marker and require exact issue and phase. Build the
canonical reference from validated summary target/number, then verify its URL
through the provider path segment (`pull` for GitHub, `pulls` for Forgejo),
owner/repository, host, and number. If `expectedReference` is supplied, require
exact target and number agreement.

Catch `PlanningPullRequestMarkerError` without retaining its `marker` field or
body on the replacement error. Return the original summary only on success;
never include it in a validation error.

- [ ] **Step 5: Write and implement factory tests**

Add this factory signature:

```ts
export function createPullRequestHost(options: {
  runner: CommandRunner;
  repoRoot: string;
  remote: string;
  host: PatchmillHostConfig;
}): PullRequestHost;
```

Construct:

```ts
case "github-gh":
  return new GitHubGhPullRequestHost({
    runner: options.runner,
    repoRoot: options.repoRoot,
    pushRemote: options.remote,
  });
case "forgejo-tea":
  return new ForgejoTeaPullRequestHost({
    runner: options.runner,
    repoRoot: options.repoRoot,
    pushRemote: options.remote,
    login: options.host.login,
  });
```

Assert both concrete adapter classes and provider IDs. Retain existing issue,
setup, and run-once provider factory tests. Do not instantiate this factory from
the legacy pipeline.

- [ ] **Step 6: Format, validate, and commit**

```sh
npx --no-install prettier --write \
  src/workflow/planning-pull-request-validation.ts \
  src/workflow/planning-pull-request-validation.test.ts \
  src/host/factory.ts \
  src/host/factory.test.ts
node --test \
  src/workflow/planning-pull-request-validation.test.ts \
  src/workflow/planning-pull-requests.test.ts \
  src/host/factory.test.ts \
  src/host/github-gh-pull-requests.test.ts \
  src/host/forgejo-tea-pull-requests.test.ts
npm run check:types
npm run check:architecture
git add \
  src/workflow/planning-pull-request-validation.ts \
  src/workflow/planning-pull-request-validation.test.ts \
  src/host/factory.ts \
  src/host/factory.test.ts
git commit -m "feat(host): validate planning pull request ownership"
```

---

### Task 6: Publish and clean up planning phases

**Files:**

- Create: `src/cli/commands/run-once/planning-phase-cleanup.ts`
- Create: `src/cli/commands/run-once/planning-phase-publisher.ts`
- Create: `src/cli/commands/run-once/planning-phase-publisher.test.ts`

**Interfaces:**

- Consumes: `PullRequestHost`, `PlanningPublicationGit`, issue #187
  `PlanningWorkspaceLifecycle`, `PlanningStateStore.replace()`, and the
  caller-owned `PlanningIssueLock`.
- Consumes: exact validation plus `planningPullRequestTitle()` and
  `planningPullRequestBody()`.
- Produces: resumable publication from `workspace-ready`, `branch-pushed`, or
  `pull-request-open` without selecting another phase or acquiring/releasing a
  lock.

Use this public result:

```ts
export type PlanningPhasePublicationResult =
  | Readonly<{
      kind: "published";
      state: PlanningStateV1;
      pullRequest: PullRequestSummary;
    }>
  | Readonly<{
      kind: "ambiguous";
      state: PlanningStateV1;
      pullRequests: readonly PullRequestSummary[];
    }>;

export async function publishPlanningPhase(input: {
  state: PlanningStateV1;
  phaseIndex: number;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  host: PullRequestHost;
  git: Pick<
    PlanningPublicationOperations,
    "verifyWorkspace" | "inspectRemoteHead" | "ensureRemoteHead"
  >;
  workspaces: PlanningWorkspaceLifecycle;
  now?: () => Date;
}): Promise<PlanningPhasePublicationResult>;
```

- [ ] **Step 1: Build a recording state/host/Git/workspace fixture**

Create valid spec and plan phase fixtures for all three accepted statuses. The
fake store must call `assertPlanningStateReplacement()`, require the exact lock,
record the complete replacement, and return it. Record every method call in one
ordered array. Never use a live host.

- [ ] **Step 2: Write exact push and checkpoint-recovery tests**

For `workspace-ready`, assert this order:

```text
workspace resume/validation
artifact workspace verification
resolve target repository
resolve head repository
validate provider repository rules
inspect/push/reinspect exact head
state replace -> branch-pushed
pull request discovery
```

Inject a state-write failure immediately after a successful push and assert no
host discovery/create or cleanup follows. Retry with the remote already at the
saved OID; assert no second push, then persist the same `branch-pushed`
evidence. A different remote OID must block before any state or host call.

- [ ] **Step 3: Write discovery, creation, and adoption tests**

From durable `branch-pushed` state, cover:

- zero exhaustive matches => create once with deterministic title/body, artifact
  paths, and one exact ownership marker;
- one exact match => adopt without create and without body update;
- more than one match => `ambiguous` before validation preference or create;
- incomplete search => propagate and do not create;
- one malformed marker, duplicate marker, wrong identity/branch/head, or
  noncanonical reference/URL => block and do not create;
- created/adopted summary => derive reference, call `getPullRequest()` exactly
  once, revalidate exact read-back, then persist `pull-request-open/ready` with
  canonical reference and URL;
- a read-back mismatch or state-write failure => retain `branch-pushed` and skip
  cleanup.

Assert created or adopted pull requests may already be `merged` or
`closed-unmerged`; publisher persists identity but does not reinterpret status.

- [ ] **Step 4: Write interrupted-create recovery**

Make `createPullRequest()` record a remote creation and then throw as if its
response was interrupted. Assert durable state remains `branch-pushed` and the
workspace remains. On retry, make exhaustive discovery return that one exact
pull request; assert it is adopted, read back, and checkpointed with no second
create.

- [ ] **Step 5: Write every cleanup checkpoint/retry test**

After pull request identity is durable, assert:

```text
get and validate exact pull request
inspect exact pushed remote head
removeWorktree
state replace -> pull-request-open/worktree-removed
removeBranch
state replace -> pull-request-open/removed
```

Inject failure:

1. before worktree removal;
2. after removal but before its state write;
3. after the worktree-removed checkpoint;
4. after branch deletion but before its state write;
5. after the removed checkpoint.

For each retry, assert only the issue #187 lifecycle operation permitted by the
saved cleanup discriminator runs, with the same ownership evidence. State-write
failure must prevent the next destructive effect. Dirty workspace, changed local
head, changed remote head, wrong registration, or lock/revision conflict must
preserve the last durable boundary and never force removal.

- [ ] **Step 6: Run publisher tests to prove RED**

```sh
node --test src/cli/commands/run-once/planning-phase-publisher.test.ts
```

Expected: FAIL because publisher and cleanup modules do not exist.

- [ ] **Step 7: Implement complete-document checkpoint replacement**

Keep one local `state` variable. For each checkpoint, replace only the selected
phase, increment revision by exactly one, set `updatedAt` from `now()`, and
call:

```ts
state = await stateStore.replace({
  issueNumber: state.issueNumber,
  expectedRunId: state.runId,
  expectedRevision: state.revision,
  next,
  lock,
});
```

Await it before any later effect. Reject an out-of-range phase index,
implementation phase, incomplete workspace artifacts, or unsupported current
status before mutation.

- [ ] **Step 8: Implement branch and pull request publication**

For `workspace-ready`, revalidate issue #187 ownership through `resume()`, call
`verifyWorkspace()`, resolve both repository identities, enforce provider rules,
and call `ensureRemoteHead()`. Immediately persist immutable publication
identity as `branch-pushed`.

For `branch-pushed`, use its exact repositories/branches in
`findPullRequests()`. Count results before selecting. Create only on zero; on
one validate it first; on multiple return `ambiguous`. For create, pass only the
saved base/head branches plus deterministic title/body. Validate create output,
then read exact reference with `getPullRequest()` and validate again before
persisting `pull-request-open/ready`.

- [ ] **Step 9: Implement shared checkpointed cleanup**

In `planning-phase-cleanup.ts`, export `finishPlanningPhaseCleanup()` for a
validated `pull-request-open` phase. Before starting, require the remote ref to
equal `publication.headOid`.

- `ready`: call `removeWorktree()`, persist `worktree-removed` with
  `pushedHeadOid`, and only then continue.
- `worktree-removed`: call `removeBranch()`; its issue #187 implementation
  reproves the remote head and performs expected-old-OID deletion. Persist
  `removed` only after success.
- `removed`: perform no local mutation.

Keep the remote branch. Export the helper for Task 7, but keep state replacement
inside the caller-supplied checkpoint callback so publisher and reconciler each
retain current revision safely.

- [ ] **Step 10: Format, run focused publication tests, and commit**

```sh
npx --no-install prettier --write \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts
node --test \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/git/planning-publication-git.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-store.test.ts
npm run check:types
npm run check:architecture
git add \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts
git commit -m "feat(run-once): publish planning pull requests"
```

---

### Task 7: Reconcile planning pull request outcomes

**Files:**

- Create: `src/cli/commands/run-once/planning-phase-reconciler.ts`
- Create: `src/cli/commands/run-once/planning-phase-reconciler.test.ts`

**Interfaces:**

- Consumes: exact validation, shared cleanup, `PullRequestHost`,
  `PlanningRemoteBaseGit`, `PlanningPublicationGit`, issue #187 workspace/store,
  and the caller-owned lock.
- Produces: the exact `PlanningPhaseReconciliation` union shown above.
- Performs no pull request create, push, force update, merge, remote branch
  deletion, workspace preparation, or replacement planning pull request.

Use this entry point:

```ts
export async function reconcilePlanningPhase(input: {
  state: PlanningStateV1;
  phaseIndex: number;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  host: PullRequestHost;
  remoteBase: Pick<PlanningRemoteBaseGit, "fetch">;
  git: Pick<
    PlanningPublicationOperations,
    "inspectRemoteHead" | "assertAncestor" | "assertRegularFiles"
  >;
  workspaces: PlanningWorkspaceLifecycle;
  now?: () => Date;
}): Promise<
  Readonly<{
    state: PlanningStateV1;
    outcome: PlanningPhaseReconciliation;
  }>
>;
```

- [ ] **Step 1: Write all public outcome tests**

Cover:

- `complete/remote-base` => `satisfied-by-base` with no host/Git mutation;
- open exact pull request => cleanup completes, then `review-pending`;
- merged exact pull request => cleanup plus merge proof, then `merged`;
- closed without merge => cleanup completes, then `closed-unmerged`;
- typed saved-reference absence => `missing` with reference;
- branch-pushed exhaustive zero => `missing` without reference;
- branch-pushed multiple => `ambiguous` with every result;
- branch-pushed one exact result => validate/read back, persist pull request
  identity, finish cleanup, then classify it.

Assert closed, missing, and ambiguous outcomes never create a workspace or pull
request and never advance the phase to complete.

- [ ] **Step 2: Write typed host failure and unchanged-state tests**

For a saved reference, only catch `PullRequestNotFoundError`. Table-test
authentication, authorization, rate-limit, transport, incomplete-search,
invalid-JSON, malformed-response, marker, and identity errors. Compare
`serializePlanningState()` bytes before/after and assert no state replacement or
cleanup occurred when the host read/discovery failed.

For a branch-pushed discovery, zero exhaustive results proves missing; an
`IncompletePullRequestSearchError` does not. Do not infer absence from an error
message, command exit text, or HTTP-like string.

- [ ] **Step 3: Write cleanup gating tests**

Return no `review-pending`, `merged`, or `closed-unmerged` outcome until cleanup
reaches `removed`. Inject dirty workspace, changed local/remote head, removal
failure, and each cleanup checkpoint failure. Assert the last durable cleanup
state is returned only through a later successful retry and merged-base fetch
never begins early.

- [ ] **Step 4: Write merged-base verification tests**

For a merged summary with `mergeCommit`, assert this order after cleanup:

```text
fetch saved workspace.remote + saved base.baseBranch
assert mergeCommit ancestor of fetched baseOid
assert every expected path regular at mergeCommit
assert every expected path regular at fetched baseOid
state replace -> complete/merged-pull-request
```

Reject a missing merge object, unrelated/non-ancestor merge, fetch failure,
missing artifact, symlink, or gitlink at either commit. Assert the original
saved base branch/remote are passed to fetch even if test configuration/current
checkout names differ.

The completion checkpoint must retain publication, pull request, and removed
workspace identity; set `mergeOid` and `mergedBaseOid`; and replace every
artifact with the same kind/path plus `source: "remote-base"` and
`commitOid: fetched.baseOid`.

- [ ] **Step 5: Add the human-edit real-Git regression test**

With a local bare remote:

1. create and push a planning head containing artifact text A;
2. create a review commit or squash result containing text B at the same path;
3. merge/push that result to the saved base branch;
4. return the merged object's OID from the fake host;
5. reconcile.

Assert completion succeeds, `mergedBaseOid` is the freshly fetched base tip, and
artifact evidence points to that tip even though its blob differs from the old
planning head. Add a guard assertion that the reconciler never requests a blob
comparison with the workspace commit.

- [ ] **Step 6: Run reconciler tests to prove RED**

```sh
node --test src/cli/commands/run-once/planning-phase-reconciler.test.ts
```

Expected: FAIL because the reconciler does not exist.

- [ ] **Step 7: Implement exact discovery/read and status classification**

For `branch-pushed`, perform exhaustive saved-identity discovery without create.
Zero and multiple return blocking outcomes without state replacement. For one,
validate discovery, call exact `getPullRequest()`, validate read-back,
checkpoint `pull-request-open/ready`, and continue.

For saved pull request evidence, call `getPullRequest(reference)` and validate
against immutable publication plus expected reference before interpreting
status. Catch only `PullRequestNotFoundError`. Pass the validated phase through
`finishPlanningPhaseCleanup()`, then map open and closed-unmerged directly.

- [ ] **Step 8: Implement verified merge completion**

For merged status, require `mergeCommit`, fetch with the phase's saved remote
and base branch, and invoke `assertAncestor()` plus `assertRegularFiles()` at
both merge/base objects. Build all-at-once merged-base artifact evidence and
persist one strict completion replacement. Await state persistence before
returning `merged`; on any proof/store failure leave the published phase
incomplete at its last cleanup checkpoint.

- [ ] **Step 9: Format, validate focused reconciliation, and commit**

```sh
npx --no-install prettier --write \
  src/cli/commands/run-once/planning-phase-reconciler.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts
node --test \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/git/planning-publication-git.test.ts \
  src/git/planning-remote-base.test.ts \
  src/workflow/planning-pull-request-validation.test.ts \
  src/workflow/planning-state.test.ts
npm run check:contract-tests
npm run check:types
npm run check:architecture
git add \
  src/cli/commands/run-once/planning-phase-reconciler.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts
git commit -m "feat(run-once): reconcile planning pull requests"
```

---

### Task 8: Run full validation and audit scope

**Files:**

- Verify only; no production or test file is created in this task.

**Interfaces:**

- Verifies: all issue #188 acceptance criteria and predecessor state/workspace,
  host, prompt, and legacy planning behavior.
- Verifies: no legacy pipeline routing, dependency/config migration, live host
  test, or implementation pull request behavior was added.

- [ ] **Step 1: Run all issue-focused and predecessor tests together**

```sh
node --test \
  src/workflow/planning-state.test.ts \
  src/workflow/planning-state-store.test.ts \
  src/workflow/planning-issue-lock.test.ts \
  src/workflow/planning-pull-requests.test.ts \
  src/workflow/planning-pull-request-validation.test.ts \
  src/git/planning-remote-base.test.ts \
  src/git/planning-workspaces.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/git/planning-publication-git.test.ts \
  src/host/factory.test.ts \
  src/host/github-gh-pull-requests.test.ts \
  src/host/github-gh-pull-request-operations.test.ts \
  src/host/forgejo-tea-pull-requests.test.ts \
  src/cli/commands/run-once/prompts.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/cli/commands/run-once/planning-phase-artifacts.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts
```

Expected: all focused state, Git, host, prompt, runner, publication, recovery,
cleanup, and reconciliation tests PASS with no live provider mutation.

- [ ] **Step 2: Run the approved spec's final validation commands**

Run in this exact order:

```sh
npm run test:run-once
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
git diff --check
```

Expected: every command exits with status `0`.

- [ ] **Step 3: Verify dependency and legacy wiring scope directly**

```sh
git diff --exit-code main...HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json \
  src/config \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/stage-advancement.ts
git diff --name-only main...HEAD
```

Expected: the first command has no diff. The changed-file list is limited to the
approved spec/plan and files named in this plan plus issue #187 prerequisite
files already present in the implementation base. If npm dependency metadata
changed unexpectedly, remove the accidental change or additionally run:

```sh
nix build
```

and record its result as required by `AGENTS.md`.

- [ ] **Step 4: Audit side effects, confidentiality, and module boundaries**

```sh
rg -n -- "--force|-f|git clean|git reset|git merge|git rebase|push.*--delete" \
  src/git/planning-publication-git.ts \
  src/cli/commands/run-once/planning-phase-*.ts
rg -n "body|stdout|stderr|diagnostics|ownershipId|remote" \
  src/git/planning-publication-git.ts \
  src/workflow/planning-pull-request-validation.ts \
  src/cli/commands/run-once/planning-phase-*.ts
wc -l \
  src/git/planning-publication-git.ts \
  src/workflow/planning-pull-request-validation.ts \
  src/cli/commands/run-once/planning-phase-artifacts.ts \
  src/cli/commands/run-once/planning-phase-cleanup.ts \
  src/cli/commands/run-once/planning-phase-publisher.ts \
  src/cli/commands/run-once/planning-phase-reconciler.ts
```

Inspect every match. Expected: no force/destructive forbidden operation; bodies
are used only for deterministic create and marker validation; raw diagnostics
are non-enumerable; no state bytes or credential-bearing URLs reach errors; and
each effect module remains near the under-200-meaningful-line target or has a
documented cohesive reason/split before handoff.

- [ ] **Step 5: Record completion evidence**

The implementation worker reports:

- the seven implementation commit hashes;
- focused and repository-wide validation results;
- observed RED evidence for each production task before implementation;
- the changed-file list and confirmation of no legacy pipeline wiring;
- confirmation that each push, create, worktree removal, and branch removal has
  both a durable checkpoint assertion and an interruption-recovery test;
- confirmation that no npm dependency metadata changed, or the successful Nix
  build result if it did;
- residual risks, including provider CLI behavior not exercised against a live
  host and platform-specific Git/filesystem behavior.
