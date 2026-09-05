# Issue 184 Provider-Neutral Planning Pull Request Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable provider-neutral contracts and pure planning rules for
later planning pull request work.

**Architecture:** Add one host contract module, one pure workflow module, and
one Git workspace contract module. Keep the current host factory and run-once
pipeline unchanged.

**Tech Stack:** TypeScript, Node.js 24, NodeNext modules, `node:test`, strict
TypeScript checks, ESLint, Prettier, and dependency-cruiser.

**Spec:**
`docs/specs/2026-09-01-issue-184-provider-neutral-planning-pull-request-foundations-design.md`

## Global Constraints

- Treat the issue #180 workflow decisions in the spec as fixed constraints.
- Use `RepositoryIdentity`, not `CanonicalRepositoryIdentity`.
- Keep `PLANNING_PR_WORKFLOW_VERSION` equal to `planning-pr-v1`.
- Keep the marker format exact:
  `<!-- patchmill:planning-pr-v1 issue=<number> phase=<phase> -->`.
- A successful pull request search means that the search is exhaustive.
- Keep incomplete search, proven absence, and identity mismatch as distinct
  errors.
- Keep the new `PullRequestHost` separate from `RunOnceHostProvider`.
- Do not modify the current host factory, provider adapters, pipeline, run
  state, labels, or publication code.
- Do not add production methods that throw `not implemented` errors.
- Do not implement Git commands in this issue.
- Keep the host and workspace fake adapters inside their colocated test files.
- Keep each production module below 200 meaningful lines.
- Do not add dependencies.
- Existing runtime and CLI behavior must stay unchanged.

---

## File and Module Map

### New production modules

- `src/host/pull-requests.ts` owns repository identity, normalized pull request
  contracts, host search semantics, and host contract errors.
- `src/workflow/planning-pull-requests.ts` owns phase derivation, phase
  workspace names, markers, planning titles, and planning bodies.
- `src/git/planning-workspaces.ts` owns local workspace snapshots, lifecycle
  operations, and workspace conflict errors.

### New test modules

- `src/host/pull-requests.test.ts` protects host contract behavior and contains
  one fake host adapter.
- `src/workflow/planning-pull-requests.test.ts` protects all pure workflow
  behavior.
- `src/git/planning-workspaces.test.ts` protects workspace contract behavior and
  contains one fake workspace adapter.

No existing source file changes in this issue.

---

### Task 1: Define the provider-neutral pull request host contract

**Files:**

- Create: `src/host/pull-requests.ts`
- Create: `src/host/pull-requests.test.ts`

**Interfaces:**

- Consumes: `PatchmillHostProviderId` from `src/config/types.ts`.
- Produces: `RepositoryIdentity`, `PullRequestStatus`, `PullRequestReference`,
  `PullRequestSummary`, `CreatePullRequestInput`, and `FindPullRequestsQuery`.
- Produces: `PullRequestHost` for later GitHub, Forgejo, and coordinator
  adapters.
- Produces: `sameRepositoryIdentity` for all repository identity comparisons.
- Produces: `IncompletePullRequestSearchError`, `PullRequestNotFoundError`, and
  `PullRequestIdentityError`.
- A `merged` summary requires `mergeCommit`. Other statuses prohibit it.
- A successful `findPullRequests` result is exhaustive by contract.

- [ ] **Step 1: Write the repository identity and error tests**

Create `src/host/pull-requests.test.ts` with these initial tests:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  PullRequestNotFoundError,
  sameRepositoryIdentity,
  type FindPullRequestsQuery,
  type RepositoryIdentity,
} from "./pull-requests.ts";

const githubRepository: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.com",
  owner: "rochecompaan",
  repository: "patchmill",
};

test("repository identity comparison normalizes host, owner, and repository case", () => {
  assert.equal(
    sameRepositoryIdentity(githubRepository, {
      provider: "github-gh",
      host: "GITHUB.COM",
      owner: "RocheCompaan",
      repository: "Patchmill",
    }),
    true,
  );
});

test("repository identity comparison requires the same provider", () => {
  assert.equal(
    sameRepositoryIdentity(githubRepository, {
      ...githubRepository,
      provider: "forgejo-tea",
    }),
    false,
  );
});

test("incomplete search error keeps the exact query and provider limit", () => {
  const query: FindPullRequestsQuery = {
    targetRepository: githubRepository,
    baseBranch: "main",
    headRepository: githubRepository,
    headBranch: "agent/issue-184-foundations-spec",
  };
  const error = new IncompletePullRequestSearchError(query, 100);

  assert.equal(error.name, "IncompletePullRequestSearchError");
  assert.deepEqual(error.query, query);
  assert.equal(error.limit, 100);
});

test("not found error keeps the exact pull request reference", () => {
  const reference = {
    targetRepository: githubRepository,
    number: 404,
  };
  const error = new PullRequestNotFoundError(reference);

  assert.equal(error.name, "PullRequestNotFoundError");
  assert.deepEqual(error.reference, reference);
});

test("identity error keeps expected and partial actual identity", () => {
  const error = new PullRequestIdentityError("repository mismatch", {
    expected: githubRepository,
    actual: { host: "forge.example.test" },
  });

  assert.equal(error.name, "PullRequestIdentityError");
  assert.equal(error.reason, "repository mismatch");
  assert.deepEqual(error.expected, githubRepository);
  assert.deepEqual(error.actual, { host: "forge.example.test" });
});
```

- [ ] **Step 2: Add a fake host contract test**

Add these imports and fixtures to the same test file:

```ts
import type {
  CreatePullRequestInput,
  PullRequestHost,
  PullRequestReference,
  PullRequestSummary,
} from "./pull-requests.ts";

const openPullRequest = {
  number: 12,
  url: "https://github.com/rochecompaan/patchmill/pull/12",
  status: "open",
  targetRepository: githubRepository,
  baseBranch: "main",
  headRepository: githubRepository,
  headBranch: "agent/issue-184-foundations-spec",
  headSha: "abc123",
  body: "Refs #184",
} satisfies PullRequestSummary;

function fakePullRequestHost(summary: PullRequestSummary): PullRequestHost {
  let body = summary.body;
  return {
    id: "github-gh",
    resolveTargetRepositoryIdentity: async () => githubRepository,
    resolveRemoteRepositoryIdentity: async () => githubRepository,
    createPullRequest: async (_input: CreatePullRequestInput) => summary,
    findPullRequests: async (_query: FindPullRequestsQuery) => [summary],
    getPullRequest: async (_reference: PullRequestReference) => summary,
    readPullRequestBody: async (_reference: PullRequestReference) => body,
    updatePullRequestBody: async (
      _reference: PullRequestReference,
      nextBody: string,
    ) => {
      body = nextBody;
    },
  };
}

test("a fake host satisfies the same contract as production adapters", async () => {
  const host = fakePullRequestHost(openPullRequest);
  const reference = {
    targetRepository: githubRepository,
    number: openPullRequest.number,
  };
  const query: FindPullRequestsQuery = {
    targetRepository: githubRepository,
    baseBranch: "main",
    headRepository: githubRepository,
    headBranch: openPullRequest.headBranch,
  };

  assert.deepEqual(await host.findPullRequests(query), [openPullRequest]);
  assert.deepEqual(await host.getPullRequest(reference), openPullRequest);
  await host.updatePullRequestBody(reference, "updated body");
  assert.equal(await host.readPullRequestBody(reference), "updated body");
});
```

This test adapter is local to this test file. Do not create a shared test
helper.

- [ ] **Step 3: Run the focused test to prove RED**

Run:

```sh
node --test src/host/pull-requests.test.ts
```

Expected: FAIL because `src/host/pull-requests.ts` does not exist.

- [ ] **Step 4: Implement the complete host contract module**

Create `src/host/pull-requests.ts` with this public surface and implementation:

```ts
import type { PatchmillHostProviderId } from "../config/types.ts";

export type RepositoryIdentity = {
  provider: PatchmillHostProviderId;
  host: string;
  owner: string;
  repository: string;
};

export type PullRequestStatus = "open" | "merged" | "closed-unmerged";

export type PullRequestReference = {
  targetRepository: RepositoryIdentity;
  number: number;
};

type PullRequestSummaryIdentity = {
  number: number;
  url: string;
  targetRepository: RepositoryIdentity;
  baseBranch: string;
  headRepository: RepositoryIdentity;
  headBranch: string;
  headSha: string;
  body: string;
};

export type PullRequestSummary = PullRequestSummaryIdentity &
  (
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

function sameCaseInsensitiveValue(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function sameRepositoryIdentity(
  left: RepositoryIdentity,
  right: RepositoryIdentity,
): boolean {
  return (
    left.provider === right.provider &&
    sameCaseInsensitiveValue(left.host, right.host) &&
    sameCaseInsensitiveValue(left.owner, right.owner) &&
    sameCaseInsensitiveValue(left.repository, right.repository)
  );
}

export class IncompletePullRequestSearchError extends Error {
  readonly query: FindPullRequestsQuery;
  readonly limit?: number;

  constructor(query: FindPullRequestsQuery, limit?: number) {
    super(
      limit === undefined
        ? "Pull request search was incomplete"
        : `Pull request search stopped at provider limit ${limit}`,
    );
    this.name = "IncompletePullRequestSearchError";
    this.query = query;
    if (limit !== undefined) this.limit = limit;
  }
}

export class PullRequestNotFoundError extends Error {
  readonly reference: PullRequestReference;

  constructor(reference: PullRequestReference) {
    super(`Pull request #${reference.number} was not found`);
    this.name = "PullRequestNotFoundError";
    this.reference = reference;
  }
}

export class PullRequestIdentityError extends Error {
  readonly reason: string;
  readonly expected?: RepositoryIdentity;
  readonly actual?: Partial<RepositoryIdentity>;

  constructor(
    reason: string,
    identities: {
      expected?: RepositoryIdentity;
      actual?: Partial<RepositoryIdentity>;
    } = {},
  ) {
    super(`Pull request identity is invalid: ${reason}`);
    this.name = "PullRequestIdentityError";
    this.reason = reason;
    if (identities.expected !== undefined) {
      this.expected = identities.expected;
    }
    if (identities.actual !== undefined) {
      this.actual = identities.actual;
    }
  }
}

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

Do not import or extend `RunOnceHostProvider`. Do not modify either production
provider.

- [ ] **Step 5: Format and run focused validation**

Run:

```sh
npx --no-install prettier --write \
  src/host/pull-requests.ts \
  src/host/pull-requests.test.ts
node --test src/host/pull-requests.test.ts
npm run check:types
```

Expected: the focused tests and strict TypeScript checks PASS.

- [ ] **Step 6: Commit the host contract**

```sh
git add src/host/pull-requests.ts src/host/pull-requests.test.ts
git commit -m "feat(host): define pull request contract"
```

---

### Task 2: Implement pure planning phase and pull request rules

**Files:**

- Create: `src/workflow/planning-pull-requests.ts`
- Create: `src/workflow/planning-pull-requests.test.ts`

**Interfaces:**

- Consumes: `GitWorktreeStrategyConfig` from `src/git/types.ts`.
- Consumes: `buildIssueBranchName` and `buildIssueWorktreePath` from
  `src/git/worktree-strategy.ts`.
- Produces: `PlanningPhaseKind`, `PlanningArtifactKind`, `PlanningGateSnapshot`,
  and `PlannedPhase`.
- Produces: `planningPhasePlan` with the exact four-row workflow matrix.
- Produces: `phaseWorkspaceIdentity` with the phase suffix outside `slugLength`.
- Produces: strict marker rendering and parsing for `planning-pr-v1`.
- Produces: fixed non-closing planning titles and bodies.
- Produces: `PlanningPullRequestMarkerError` for malformed identity markers.

- [ ] **Step 1: Write the four-combination phase planner test**

Create `src/workflow/planning-pull-requests.test.ts` with this table-driven
test:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  planningPhasePlan,
  type PlannedPhase,
  type PlanningGateSnapshot,
} from "./planning-pull-requests.ts";

const phaseCases: Array<{
  gates: PlanningGateSnapshot;
  expected: readonly PlannedPhase[];
}> = [
  {
    gates: { specRequired: false, planRequired: false },
    expected: [
      {
        kind: "implementation",
        artifactKinds: ["spec", "plan"],
        pullRequestRequired: true,
      },
    ],
  },
  {
    gates: { specRequired: true, planRequired: false },
    expected: [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
    ],
  },
  {
    gates: { specRequired: false, planRequired: true },
    expected: [
      {
        kind: "plan",
        artifactKinds: ["spec", "plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ],
  },
  {
    gates: { specRequired: true, planRequired: true },
    expected: [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "plan",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ],
  },
];

test("planning phase plan covers all spec and plan gate combinations", () => {
  for (const entry of phaseCases) {
    assert.deepEqual(planningPhasePlan(entry.gates), entry.expected);
  }
});
```

- [ ] **Step 2: Add workspace identity and marker tests**

Add these imports and tests to the same file:

```ts
import {
  PlanningPullRequestMarkerError,
  parsePlanningPullRequestMarker,
  phaseWorkspaceIdentity,
  renderPlanningPullRequestMarker,
} from "./planning-pull-requests.ts";
import type { GitWorktreeStrategyConfig } from "../git/types.ts";

const strategy: GitWorktreeStrategyConfig = {
  baseBranch: "main",
  baseRef: "HEAD",
  remote: "origin",
  branchPrefix: "agent/issue-",
  worktreeDir: ".worktrees",
  worktreePrefix: "patchmill-issue-",
  slugLength: 48,
  allowDirectLand: false,
};

test("phase workspace identity appends the phase outside the issue slug", () => {
  assert.deepEqual(
    phaseWorkspaceIdentity({
      issueNumber: 184,
      title: "Define provider-neutral planning pull request foundations",
      phase: "plan",
      strategy,
    }),
    {
      branch:
        "agent/issue-184-define-provider-neutral-planning-pull-request-fo-plan",
      worktreePath:
        ".worktrees/patchmill-issue-184-define-provider-neutral-planning-pull-request-fo-plan",
    },
  );
});

test("planning pull request marker renders and parses exact identity", () => {
  const marker = renderPlanningPullRequestMarker({
    issueNumber: 184,
    phase: "spec",
  });

  assert.equal(
    marker,
    "<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->",
  );
  assert.deepEqual(parsePlanningPullRequestMarker(`Header\n\n${marker}\n`), {
    workflowVersion: "planning-pr-v1",
    issueNumber: 184,
    phase: "spec",
  });
});

test("marker parser returns undefined when no planning marker exists", () => {
  assert.equal(parsePlanningPullRequestMarker("Refs #184"), undefined);
});

test("marker parser rejects duplicate and invalid planning markers", () => {
  const invalidBodies = [
    [
      "<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->",
      "<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->",
    ].join("\n"),
    "<!-- patchmill:planning-pr-v2 issue=184 phase=spec -->",
    "<!-- patchmill:planning-pr-v1 issue=0 phase=spec -->",
    "<!-- patchmill:planning-pr-v1 issue=184 phase=review -->",
    "<!-- patchmill:planning-pr-v1 issue=184 phase=spec",
  ];

  for (const body of invalidBodies) {
    assert.throws(
      () => parsePlanningPullRequestMarker(body),
      PlanningPullRequestMarkerError,
    );
  }
});
```

- [ ] **Step 3: Add planning title and body tests**

Add these imports and tests:

```ts
import {
  planningPullRequestBody,
  planningPullRequestTitle,
} from "./planning-pull-requests.ts";

const closingKeyword = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+/iu;

test("planning title identifies the phase and issue without untrusted issue text", () => {
  const specTitle = planningPullRequestTitle({
    issueNumber: 184,
    phase: "spec",
  });
  const planTitle = planningPullRequestTitle({
    issueNumber: 184,
    phase: "plan",
  });

  assert.equal(specTitle, "Spec for #184");
  assert.equal(planTitle, "Plan for #184");
  assert.doesNotMatch(specTitle, closingKeyword);
  assert.doesNotMatch(planTitle, closingKeyword);
});

test("planning body is non-closing and lists each artifact path once", () => {
  const body = planningPullRequestBody({
    issueNumber: 184,
    phase: "spec",
    artifactPaths: [
      "docs/specs/issue-184-design.md",
      "docs/specs/issue-184-design.md",
    ],
  });

  assert.match(body, /^Refs #184$/mu);
  assert.match(body, /^Spec$/mu);
  assert.equal(body.match(/docs\/specs\/issue-184-design\.md/gu)?.length, 1);
  assert.match(body, /Merge this pull request to unlock the next phase\./u);
  assert.match(body, /<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->/u);
  assert.doesNotMatch(body, closingKeyword);
});
```

- [ ] **Step 4: Run the focused test to prove RED**

Run:

```sh
node --test src/workflow/planning-pull-requests.test.ts
```

Expected: FAIL because `src/workflow/planning-pull-requests.ts` does not exist.

- [ ] **Step 5: Implement the pure workflow module**

Create `src/workflow/planning-pull-requests.ts` with this implementation:

```ts
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../git/worktree-strategy.ts";
import type { GitWorktreeStrategyConfig } from "../git/types.ts";

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
): readonly PlannedPhase[] {
  if (gates.specRequired && gates.planRequired) {
    return [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "plan",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ];
  }
  if (gates.specRequired) {
    return [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
    ];
  }
  if (gates.planRequired) {
    return [
      {
        kind: "plan",
        artifactKinds: ["spec", "plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ];
  }
  return [
    {
      kind: "implementation",
      artifactKinds: ["spec", "plan"],
      pullRequestRequired: true,
    },
  ];
}

export function phaseWorkspaceIdentity(input: {
  issueNumber: number;
  title: string;
  phase: PlanningPhaseKind;
  strategy: GitWorktreeStrategyConfig;
}): { branch: string; worktreePath: string } {
  const branch = buildIssueBranchName(
    input.issueNumber,
    input.title,
    input.strategy,
  );
  const worktreePath = buildIssueWorktreePath(
    input.issueNumber,
    input.title,
    input.strategy,
  );
  return {
    branch: `${branch}-${input.phase}`,
    worktreePath: `${worktreePath}-${input.phase}`,
  };
}

const markerCandidatePattern = /<!--\s*patchmill:planning-pr-[\s\S]*?-->/gu;
const validMarkerPattern =
  /^<!-- patchmill:(planning-pr-v1) issue=([1-9]\d*) phase=(spec|plan|implementation) -->$/u;
const markerPrefix = "patchmill:planning-pr-";

export class PlanningPullRequestMarkerError extends Error {
  readonly reason: string;
  readonly marker: string;

  constructor(reason: string, marker: string) {
    super(`Planning pull request marker is invalid: ${reason}`);
    this.name = "PlanningPullRequestMarkerError";
    this.reason = reason;
    this.marker = marker;
  }
}

function assertPositiveIssueNumber(issueNumber: number): void {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new RangeError("Issue number must be a positive safe integer");
  }
}

export function renderPlanningPullRequestMarker(input: {
  issueNumber: number;
  phase: PlanningPhaseKind;
}): string {
  assertPositiveIssueNumber(input.issueNumber);
  return `<!-- patchmill:${PLANNING_PR_WORKFLOW_VERSION} issue=${input.issueNumber} phase=${input.phase} -->`;
}

export function parsePlanningPullRequestMarker(body: string):
  | {
      workflowVersion: typeof PLANNING_PR_WORKFLOW_VERSION;
      issueNumber: number;
      phase: PlanningPhaseKind;
    }
  | undefined {
  const candidates = body.match(markerCandidatePattern) ?? [];
  if (candidates.length === 0) {
    if (body.includes(markerPrefix)) {
      throw new PlanningPullRequestMarkerError("malformed marker", body);
    }
    return undefined;
  }
  if (candidates.length !== 1) {
    throw new PlanningPullRequestMarkerError(
      "multiple markers",
      candidates.join("\n"),
    );
  }
  const marker = candidates[0]!;
  const match = validMarkerPattern.exec(marker);
  if (!match) {
    throw new PlanningPullRequestMarkerError("unsupported marker", marker);
  }
  const issueNumber = Number(match[2]);
  if (!Number.isSafeInteger(issueNumber)) {
    throw new PlanningPullRequestMarkerError("invalid issue number", marker);
  }
  return {
    workflowVersion: PLANNING_PR_WORKFLOW_VERSION,
    issueNumber,
    phase: match[3] as PlanningPhaseKind,
  };
}

export function planningPullRequestTitle(input: {
  issueNumber: number;
  phase: PlanningArtifactKind;
}): string {
  assertPositiveIssueNumber(input.issueNumber);
  const label = input.phase === "spec" ? "Spec" : "Plan";
  return `${label} for #${input.issueNumber}`;
}

export function planningPullRequestBody(input: {
  issueNumber: number;
  phase: PlanningArtifactKind;
  artifactPaths: readonly string[];
}): string {
  assertPositiveIssueNumber(input.issueNumber);
  const artifactPaths = [...new Set(input.artifactPaths)];
  if (artifactPaths.length === 0) {
    throw new RangeError("Planning pull request requires an artifact path");
  }
  const label = input.phase === "spec" ? "Spec" : "Plan";
  return [
    `Refs #${input.issueNumber}`,
    "",
    "## Planning phase",
    "",
    label,
    "",
    "## Artifacts",
    "",
    ...artifactPaths.map((path) => `- \`${path}\``),
    "",
    "Merge this pull request to unlock the next phase.",
    "",
    renderPlanningPullRequestMarker(input),
  ].join("\n");
}
```

Keep marker parsing strict. Do not accept unknown versions or phases.

- [ ] **Step 6: Format and run focused validation**

Run:

```sh
npx --no-install prettier --write \
  src/workflow/planning-pull-requests.ts \
  src/workflow/planning-pull-requests.test.ts
node --test src/workflow/planning-pull-requests.test.ts
npm run check:types
npm run check:architecture
```

Expected: the focused tests, strict TypeScript checks, and architecture check
PASS.

- [ ] **Step 7: Commit the pure workflow rules**

```sh
git add \
  src/workflow/planning-pull-requests.ts \
  src/workflow/planning-pull-requests.test.ts
git commit -m "feat(workflow): define planning pull request phases"
```

---

### Task 3: Define the planning workspace lifecycle contract

**Files:**

- Create: `src/git/planning-workspaces.ts`
- Create: `src/git/planning-workspaces.test.ts`

**Interfaces:**

- Produces: `PlanningWorkspaceIdentity` for an expected branch and worktree
  path.
- Produces: a discriminated `PlanningWorkspaceSnapshot` with `missing`,
  `branch-only`, and `ready` states.
- Produces: `PreparedPlanningWorkspace` with the fetched remote base and ready
  snapshot.
- Produces: `PlanningWorkspaceLifecycle` with `prepare`, `inspect`,
  `removeWorktree`, and `removeBranch`.
- Produces: `PlanningWorkspaceConflictReason` and
  `PlanningWorkspaceConflictError` for fail-closed state.
- The interface binds each concrete adapter to one repository root.
- The interface does not expose `CommandRunner` or Git command details.

- [ ] **Step 1: Write the fake workspace contract test**

Create `src/git/planning-workspaces.test.ts` with this in-memory adapter and
contract test:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningWorkspaceConflictError,
  type PlanningWorkspaceIdentity,
  type PlanningWorkspaceLifecycle,
  type PlanningWorkspaceSnapshot,
  type PreparedPlanningWorkspace,
} from "./planning-workspaces.ts";

const identity: PlanningWorkspaceIdentity = {
  branch: "agent/issue-184-foundations-spec",
  worktreePath: ".worktrees/patchmill-issue-184-foundations-spec",
};

class FakePlanningWorkspace implements PlanningWorkspaceLifecycle {
  readonly events: string[] = [];
  private snapshot: PlanningWorkspaceSnapshot = {
    state: "missing",
    identity,
  };

  async prepare(input: {
    identity: PlanningWorkspaceIdentity;
    remote: string;
    baseBranch: string;
    resume?: { baseSha: string; headSha: string };
  }): Promise<PreparedPlanningWorkspace> {
    this.events.push("prepare");
    const headSha = input.resume?.headSha ?? "head-1";
    const snapshot: Extract<PlanningWorkspaceSnapshot, { state: "ready" }> = {
      state: "ready",
      identity: input.identity,
      headSha,
      clean: true,
    };
    this.snapshot = snapshot;
    return {
      created: input.resume === undefined,
      remote: input.remote,
      baseBranch: input.baseBranch,
      baseSha: input.resume?.baseSha ?? "base-1",
      snapshot,
    };
  }

  async inspect(
    _identity: PlanningWorkspaceIdentity,
  ): Promise<PlanningWorkspaceSnapshot> {
    this.events.push("inspect");
    return this.snapshot;
  }

  async removeWorktree(
    _identity: PlanningWorkspaceIdentity,
  ): Promise<Extract<PlanningWorkspaceSnapshot, { state: "branch-only" }>> {
    this.events.push("remove-worktree");
    if (this.snapshot.state !== "ready") {
      throw new PlanningWorkspaceConflictError(
        "branch-owned-by-other-worktree",
        identity,
      );
    }
    if (!this.snapshot.clean) {
      throw new PlanningWorkspaceConflictError("dirty-worktree", identity);
    }
    this.snapshot = {
      state: "branch-only",
      identity,
      headSha: this.snapshot.headSha,
    };
    return this.snapshot;
  }

  async removeBranch(input: {
    identity: PlanningWorkspaceIdentity;
    pushedHeadSha: string;
  }): Promise<Extract<PlanningWorkspaceSnapshot, { state: "missing" }>> {
    this.events.push("remove-branch");
    if (
      this.snapshot.state !== "branch-only" ||
      this.snapshot.headSha !== input.pushedHeadSha
    ) {
      throw new PlanningWorkspaceConflictError("head-not-pushed", identity);
    }
    this.snapshot = { state: "missing", identity: input.identity };
    return this.snapshot;
  }
}

test("a coordinator can use the workspace lifecycle without Git commands", async () => {
  const workspace = new FakePlanningWorkspace();
  const prepared = await workspace.prepare({
    identity,
    remote: "origin",
    baseBranch: "main",
  });

  assert.equal(prepared.created, true);
  assert.equal(prepared.baseSha, "base-1");
  assert.deepEqual(await workspace.inspect(identity), prepared.snapshot);

  const branchOnly = await workspace.removeWorktree(identity);
  assert.equal(branchOnly.state, "branch-only");

  const missing = await workspace.removeBranch({
    identity,
    pushedHeadSha: "head-1",
  });
  assert.equal(missing.state, "missing");
  assert.deepEqual(workspace.events, [
    "prepare",
    "inspect",
    "remove-worktree",
    "remove-branch",
  ]);
});

test("workspace conflict error keeps the reason and identity", () => {
  const error = new PlanningWorkspaceConflictError(
    "unregistered-path",
    identity,
  );

  assert.equal(error.name, "PlanningWorkspaceConflictError");
  assert.equal(error.reason, "unregistered-path");
  assert.deepEqual(error.identity, identity);
});
```

Do not move this adapter to `test-support`. Later issue #188 can extract a
shared adapter after it has a second consumer.

- [ ] **Step 2: Run the focused test to prove RED**

Run:

```sh
node --test src/git/planning-workspaces.test.ts
```

Expected: FAIL because `src/git/planning-workspaces.ts` does not exist.

- [ ] **Step 3: Implement the workspace lifecycle types and interface**

Create `src/git/planning-workspaces.ts` with this code:

```ts
export type PlanningWorkspaceIdentity = {
  readonly branch: string;
  readonly worktreePath: string;
};

export type PlanningWorkspaceSnapshot =
  | {
      readonly state: "missing";
      readonly identity: PlanningWorkspaceIdentity;
    }
  | {
      readonly state: "branch-only";
      readonly identity: PlanningWorkspaceIdentity;
      readonly headSha: string;
    }
  | {
      readonly state: "ready";
      readonly identity: PlanningWorkspaceIdentity;
      readonly headSha: string;
      readonly clean: boolean;
    };

export type PreparedPlanningWorkspace = {
  readonly created: boolean;
  readonly remote: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly snapshot: Extract<PlanningWorkspaceSnapshot, { state: "ready" }>;
};

export type PlanningWorkspaceConflictReason =
  | "path-owned-by-other-branch"
  | "branch-owned-by-other-worktree"
  | "unregistered-path"
  | "detached-worktree"
  | "base-sha-mismatch"
  | "head-sha-mismatch"
  | "dirty-worktree"
  | "head-not-pushed";

export class PlanningWorkspaceConflictError extends Error {
  readonly reason: PlanningWorkspaceConflictReason;
  readonly identity: PlanningWorkspaceIdentity;

  constructor(
    reason: PlanningWorkspaceConflictReason,
    identity: PlanningWorkspaceIdentity,
  ) {
    super(`Planning workspace is unsafe: ${reason}`);
    this.name = "PlanningWorkspaceConflictError";
    this.reason = reason;
    this.identity = identity;
  }
}

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

Do not import `CommandRunner`. Do not add a production Git adapter in this task.

- [ ] **Step 4: Format and run focused validation**

Run:

```sh
npx --no-install prettier --write \
  src/git/planning-workspaces.ts \
  src/git/planning-workspaces.test.ts
node --test src/git/planning-workspaces.test.ts
npm run check:types
npm run check:architecture
```

Expected: the focused tests, strict TypeScript checks, and architecture check
PASS.

- [ ] **Step 5: Commit the workspace contract**

```sh
git add \
  src/git/planning-workspaces.ts \
  src/git/planning-workspaces.test.ts
git commit -m "feat(git): define planning workspace lifecycle"
```

---

## Final Validation

After Task 3, run all focused contract tests together:

```sh
node --test \
  src/host/pull-requests.test.ts \
  src/workflow/planning-pull-requests.test.ts \
  src/git/planning-workspaces.test.ts
```

Expected: all focused tests PASS.

Run the repository validation commands:

```sh
npm run check:types
npm run build
npm run check:architecture
npm run lint
npm test
git diff --check
```

Expected: every command exits with status 0.

Inspect the branch file list:

```sh
git diff --name-only main...HEAD
```

Expected branch files:

```text
docs/plans/2026-09-01-issue-184-provider-neutral-planning-pull-request-foundations.md
docs/specs/2026-09-01-issue-184-provider-neutral-planning-pull-request-foundations-design.md
src/git/planning-workspaces.test.ts
src/git/planning-workspaces.ts
src/host/pull-requests.test.ts
src/host/pull-requests.ts
src/workflow/planning-pull-requests.test.ts
src/workflow/planning-pull-requests.ts
```

No other production file changes belong in issue #184.

No Nix build is required because this issue does not change npm dependencies.

## Implementation Completion Report

The implementation worker reports:

- The three implementation commit hashes.
- The focused test result.
- The strict TypeScript, build, architecture, lint, and full test results.
- Any deviation from the six planned implementation files.
- Any residual risk in the contracts for issues #185, #186, or #187.
