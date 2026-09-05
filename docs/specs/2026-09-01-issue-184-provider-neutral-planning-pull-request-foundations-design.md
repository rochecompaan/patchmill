# Issue 184 provider-neutral planning pull request foundations design

## Status

The design decisions are approved in chat. This written specification awaits
document review.

Issue #184 is the first delivery slice of issue #180. This design treats the
approved workflow decisions from issue #180 as constraints.

## Summary

Patchmill needs stable foundations for planning pull requests before it adds
GitHub, Forgejo, and Git workspace implementations.

This change defines three focused modules:

1. A provider-neutral pull request host contract.
2. Pure planning phase and pull request rules.
3. A planning workspace lifecycle contract.

This change does not connect the new contracts to the current run-once workflow.
Existing runtime behavior stays unchanged.

## Goals

- Define complete repository and pull request identities.
- Define pull request search completeness and error semantics.
- Define the phase sequence for all four planning gate combinations.
- Define deterministic planning pull request markers, titles, and bodies.
- Define deterministic phase branch and worktree names.
- Hide Git command sequences behind a small workspace interface.
- Prove the host and workspace seams with test adapters.
- Give later issues stable types and functions to implement and consume.

## Non-goals

- Add GitHub commands.
- Add Forgejo commands.
- Implement Git worktree operations.
- Change the host factory or `RunOnceHostProvider`.
- Add production methods that throw `not implemented` errors.
- Add run recovery state, locks, phase coordination, or publication.
- Change issue labels, artifact comments, or pipeline behavior.
- Publish or merge a planning pull request.

## Module map

### `src/host/pull-requests.ts`

This module owns provider-neutral repository and pull request contracts. It
contains no CLI commands and no provider response fields.

### `src/workflow/planning-pull-requests.ts`

This module owns pure planning workflow rules. It derives phases and renders or
parses deterministic identity text.

### `src/git/planning-workspaces.ts`

This module owns the seam for the local phase workspace lifecycle. It defines
observable snapshots and high-level lifecycle operations.

Each module has one colocated test file. The test adapters stay in those test
files until another test needs the same implementation.

## Repository identity

The public type is `RepositoryIdentity`. The word `Canonical` is not part of the
identifier.

```ts
export type RepositoryIdentity = {
  provider: PatchmillHostProviderId;
  host: string;
  owner: string;
  repository: string;
};
```

A `RepositoryIdentity` is complete and provider-normalized:

- `provider` identifies the active host adapter.
- `host` contains the canonical host name without a URL scheme or path.
- `owner` contains the provider-resolved repository owner.
- `repository` contains the provider-resolved repository name.

An owner and repository slug without a host is not a complete identity. A raw
Git remote URL is not a `RepositoryIdentity`.

`sameRepositoryIdentity(left, right)` compares `provider` exactly. It compares
`host`, `owner`, and `repository` without case sensitivity.

## Pull request contract

### Types

The module defines these public types:

```ts
export type PullRequestStatus = "open" | "merged" | "closed-unmerged";

export type PullRequestReference = {
  targetRepository: RepositoryIdentity;
  number: number;
};

export type PullRequestSummary = {
  number: number;
  url: string;
  targetRepository: RepositoryIdentity;
  baseBranch: string;
  headRepository: RepositoryIdentity;
  headBranch: string;
  headSha: string;
  body: string;
} & (
  | { status: "open"; mergeCommit?: undefined }
  | { status: "merged"; mergeCommit: string }
  | { status: "closed-unmerged"; mergeCommit?: undefined }
);

export type CreatePullRequestInput = {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
};

export type FindPullRequestsQuery = {
  targetRepository: RepositoryIdentity;
  baseBranch: string;
  headRepository: RepositoryIdentity;
  headBranch: string;
};
```

A merged summary always has a merge commit. An open or closed-unmerged summary
does not have a merge commit.

### Host interface

```ts
export interface PullRequestHost {
  readonly id: PatchmillHostProviderId;

  resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity>;

  resolveRemoteRepositoryIdentity(remote: string): Promise<RepositoryIdentity>;

  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestSummary>;

  findPullRequests(
    query: FindPullRequestsQuery,
  ): Promise<readonly PullRequestSummary[]>;

  getPullRequest(reference: PullRequestReference): Promise<PullRequestSummary>;

  readPullRequestBody(reference: PullRequestReference): Promise<string>;

  updatePullRequestBody(
    reference: PullRequestReference,
    body: string,
  ): Promise<void>;
}
```

The interface is separate from `RunOnceHostProvider`. Issues #185 and #186 can
implement this interface without temporary production stubs.

### Completeness semantics

A successful `findPullRequests` call means that the result is exhaustive. The
adapter must search all pull request states and all available pages.

The adapter throws `IncompletePullRequestSearchError` if it cannot prove that
the result is complete. A partial result must not appear as a successful result.

The adapter throws `PullRequestNotFoundError` only after it proves that the
requested pull request does not exist.

The adapter throws `PullRequestIdentityError` for incomplete identity data or a
repository mismatch.

The errors expose these stable fields:

```ts
export class IncompletePullRequestSearchError extends Error {
  readonly query: FindPullRequestsQuery;
  readonly limit?: number;
}

export class PullRequestNotFoundError extends Error {
  readonly reference: PullRequestReference;
}

export class PullRequestIdentityError extends Error {
  readonly reason: string;
  readonly expected?: RepositoryIdentity;
  readonly actual?: Partial<RepositoryIdentity>;
}
```

Authentication, transport, rate-limit, and malformed-response errors retain
their original error type. The host contract does not misclassify these errors
as a missing pull request.

## Planning phases

The workflow version is `planning-pr-v1`.

```ts
export const PLANNING_PR_WORKFLOW_VERSION = "planning-pr-v1" as const;

export type PlanningPhaseKind = "spec" | "plan" | "implementation";
export type PlanningArtifactKind = "spec" | "plan";

export type PlanningGateSnapshot = {
  specRequired: boolean;
  planRequired: boolean;
};

export type PlannedPhase = {
  kind: PlanningPhaseKind;
  artifactKinds: readonly PlanningArtifactKind[];
  pullRequestRequired: true;
};

export function planningPhasePlan(
  gates: PlanningGateSnapshot,
): readonly PlannedPhase[];
```

The function returns these exact phase sequences:

| Spec gate | Plan gate | Phase sequence                                                          |
| --------- | --------- | ----------------------------------------------------------------------- |
| Disabled  | Disabled  | Implementation contains the spec and plan.                              |
| Enabled   | Disabled  | Spec contains the spec. Implementation contains the plan.               |
| Disabled  | Enabled   | Plan contains the spec and plan. Implementation follows.                |
| Enabled   | Enabled   | Spec contains the spec. Plan contains the plan. Implementation follows. |

Every listed phase ends in a pull request. The implementation phase also
contains code, but `artifactKinds` lists planning artifacts only.

A remote-base artifact can satisfy a planning gate without a new pull request.
Later reconciliation logic owns that decision. The pure phase plan does not
inspect repositories or run state.

## Phase workspace identity

`phaseWorkspaceIdentity` uses the existing issue slug and strategy helpers. It
appends the phase suffix after the complete issue branch and worktree name.

```ts
export function phaseWorkspaceIdentity(input: {
  issueNumber: number;
  title: string;
  phase: PlanningPhaseKind;
  strategy: GitWorktreeStrategyConfig;
}): {
  branch: string;
  worktreePath: string;
};
```

The phase suffix does not count against `slugLength`.

For issue #184, the names have this form:

```text
agent/issue-184-<slug>-spec
.worktrees/patchmill-issue-184-<slug>-spec
```

The `plan` and `implementation` phases use their matching suffix.

## Planning pull request identity

### Marker

The marker format is:

```html
<!-- patchmill:planning-pr-v1 issue=<number> phase=<phase> -->
```

For the spec phase of issue #184, the marker is:

```html
<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->
```

The marker is an invisible pull request body comment. It is not part of the
committed spec or plan.

The marker helps Patchmill recover from an uncertain create response. A later
run can find the pull request by repository and branch identity. The marker then
proves the workflow version, issue, and phase.

The parser returns `undefined` when the body has no Patchmill planning marker.
It throws `PlanningPullRequestMarkerError` for these conditions:

- More than one marker exists.
- A marker is malformed.
- The workflow version is unsupported.
- The issue number is not a positive integer.
- The phase is not `spec`, `plan`, or `implementation`.

Human-readable title or body text is not an identity source.

### Titles

Planning pull request titles use these forms:

```text
Spec for #<issue>
Plan for #<issue>
```

The title identifies the issue and phase without untrusted issue text. It does
not contain an issue-closing keyword.

### Bodies

A planning pull request body contains these items in order:

1. `Refs #<issue>` as a non-closing reference.
2. The planning phase.
3. The repository-relative artifact paths.
4. A statement that the merge unlocks the next phase.
5. The planning pull request marker.

The renderer preserves the first occurrence of each artifact path. It omits
later duplicate occurrences. It does not inspect the filesystem.

Only the implementation pull request can use `Closes #<issue>`. Implementation
pull request body rules remain outside issue #184.

## Planning workspace lifecycle

The workspace module defines an interface. Issue #187 will add the Git
implementation.

### Identity and snapshots

```ts
export type PlanningWorkspaceIdentity = {
  branch: string;
  worktreePath: string;
};

export type PlanningWorkspaceSnapshot =
  | {
      state: "missing";
      identity: PlanningWorkspaceIdentity;
    }
  | {
      state: "branch-only";
      identity: PlanningWorkspaceIdentity;
      headSha: string;
    }
  | {
      state: "ready";
      identity: PlanningWorkspaceIdentity;
      headSha: string;
      clean: boolean;
    };

export type PreparedPlanningWorkspace = {
  created: boolean;
  remote: string;
  baseBranch: string;
  baseSha: string;
  snapshot: Extract<PlanningWorkspaceSnapshot, { state: "ready" }>;
};
```

A valid snapshot has one of three states. Unexpected filesystem and Git
combinations do not create more snapshot variants.

### Interface

```ts
export interface PlanningWorkspaceLifecycle {
  prepare(input: {
    identity: PlanningWorkspaceIdentity;
    remote: string;
    baseBranch: string;
    resume?: {
      baseSha: string;
      headSha: string;
    };
  }): Promise<PreparedPlanningWorkspace>;

  inspect(
    identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot>;

  removeWorktree(
    identity: PlanningWorkspaceIdentity,
  ): Promise<Extract<PlanningWorkspaceSnapshot, { state: "branch-only" }>>;

  removeBranch(input: {
    identity: PlanningWorkspaceIdentity;
    pushedHeadSha: string;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>>;
}
```

A concrete adapter binds this interface to one repository root.

`prepare` fetches the configured remote base before it creates a new workspace.
It creates the branch from the fetched remote base commit. It can resume only
when the expected identity and saved commits agree with live Git state.

`removeWorktree` does not force removal. A dirty worktree blocks the operation.

`removeBranch` proves that the exact local head exists on the remote branch. It
then removes the local branch.

The two cleanup operations stay separate. Later run recovery state can record
worktree removal before branch removal.

Push and pull request creation are not workspace responsibilities. Later
publication code owns those operations.

### Workspace errors

`PlanningWorkspaceConflictError` reports unsafe or inconsistent state. Its
reason identifies at least these conditions:

- The expected path belongs to another branch.
- The expected branch belongs to another worktree.
- An unregistered directory exists at the expected path.
- A worktree is detached.
- A saved base or head commit does not match live state.
- A worktree is dirty during removal.
- The local branch head is not proven on the remote branch.

The adapter blocks instead of using force flags or deleting uncertain state.

## Test design

### Pull request contract tests

`src/host/pull-requests.test.ts` covers:

- Case-insensitive comparison of host, owner, and repository.
- Exact comparison of provider IDs.
- The status and merge commit invariants.
- Error fields for incomplete search, missing PR, and identity mismatch.
- A small fake host that satisfies `PullRequestHost`.

### Pure workflow tests

`src/workflow/planning-pull-requests.test.ts` covers:

- The exact phase sequence for all four gate combinations.
- Phase suffix placement outside the configured slug limit.
- Exact marker rendering.
- Valid marker parsing.
- Rejection of duplicate, malformed, and unsupported markers.
- Non-closing planning titles and bodies.
- One rendered list item for each artifact path.

### Workspace contract tests

`src/git/planning-workspaces.test.ts` covers:

- The three snapshot states.
- The return state for each lifecycle operation.
- A small in-memory adapter that satisfies `PlanningWorkspaceLifecycle`.
- Coordinator-style calls through the interface without Git command details.

The host and workspace test adapters stay local to their test files. A later
issue can extract shared adapters after a second test needs the same behavior.

### Validation commands

Implementation work will use these commands:

```sh
node --test src/host/pull-requests.test.ts
node --test src/workflow/planning-pull-requests.test.ts
node --test src/git/planning-workspaces.test.ts
npm run build
npm run lint
npm test
```

These tests pass the Testing Value Gate. They protect reusable contracts,
workflow decisions, parsing, validation, and fail-closed errors.

No dependency changes are planned. A Nix build is not required for this slice.

## Module size

Each production module has one reason to change:

- Host contract changes affect `src/host/pull-requests.ts`.
- Planning policy changes affect `src/workflow/planning-pull-requests.ts`.
- Workspace lifecycle changes affect `src/git/planning-workspaces.ts`.

Each production module targets fewer than 200 meaningful lines. If the workflow
module exceeds that target, marker parsing is the first private implementation
to extract.

## Compatibility

This slice adds contracts and pure functions only. It does not change current
host adapters, factories, pipeline stages, run state, labels, or publication.

Existing runtime behavior and public CLI behavior stay unchanged.

## Acceptance criteria

- `RepositoryIdentity` contains provider, host, owner, and repository identity.
- Pull request summaries use normalized status and complete repository identity.
- Successful pull request searches are exhaustive.
- Incomplete searches, proven absence, and identity mismatches remain distinct.
- The phase planner covers all four planning gate combinations.
- Planning markers, titles, bodies, and workspace names are deterministic.
- The workspace interface hides Git command sequencing.
- Workspace cleanup blocks unsafe or uncertain deletion.
- Fake host and workspace adapters satisfy the production interfaces.
- Existing runtime behavior stays unchanged.
