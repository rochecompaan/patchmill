# Durable Workflow Approval Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve spec and plan approval labels as durable artifact facts,
reject approved issues whose artifacts cannot be resolved, and resume authorized
implementation without requiring humans to reapply approvals.

**Architecture:** Add a read-only approved-artifact preflight before claim,
using the existing planning-artifact resolver with generation disabled. Make
workflow-state resolution stage-aware, keep approval labels out of all automatic
cleanup, and let saved `implementing` state bypass approval gates already
satisfied by that run.

**Tech Stack:** TypeScript, Node.js built-in test runner, Patchmill run-state
and planning-artifact modules, Forgejo/GitHub label providers, Markdown/Astro
docs.

## Global Constraints

- Design source: `docs/specs/2026-08-02-durable-approval-labels-design.md`.
- `run-once` must never remove configured spec-approved or plan-approved labels.
- An approval label requires a resolvable corresponding artifact; missing or
  invalid approved artifacts fail before claim, Pi execution, comments, or label
  edits.
- An approved artifact is reused. Replacement requires a human to withdraw the
  corresponding approval first.
- A saved resumable `implementing` run must not revisit spec or plan approval
  gates.
- The configured label names, not default string literals, drive behavior.
- Do not change host-provider APIs or add dependencies.
- Use behavior tests for workflow transitions and recovery. Do not add tests
  that merely assert documentation or static configuration text.

---

## File and responsibility map

**Create:**

- `src/cli/commands/run-once/approval-artifact-preflight.ts` — read-only guard
  that resolves artifacts with generation disabled and rejects missing approved
  artifacts.
- `src/cli/commands/run-once/approval-artifact-preflight.test.ts` — focused
  tests for configured approval labels, missing artifacts, and resolved
  artifacts.

**Modify:**

- `src/cli/commands/run-once/artifacts.ts` — enumerate all matching issue
  artifacts so approved-artifact preflight can reject ambiguous discovery while
  preserving existing first-match behavior for unapproved workflows.
- `src/cli/commands/run-once/workflow-state.ts` — later-stage state precedence,
  durable cleanup helpers, simplified plan gate, and safe retry labels.
- `src/cli/commands/run-once/workflow-state.test.ts` — unit behavior for state,
  cleanup, and retry rules.
- `src/cli/commands/run-once/pipeline.ts` — invoke approved-artifact preflight
  before claim and pass authoritative resume state to planning.
- `src/cli/commands/run-once/stage-advancement.ts` — remove stale-approval
  branches and bypass completed approval gates on implementation resume.
- `src/cli/commands/run-once/pipeline-planning.test.ts` — strict
  approved-artifact failures and durable plan/spec transition labels.
- `src/cli/commands/run-once/pipeline-failures-scenarios.test.ts` — regression
  for unsupported implementation JSON followed by resume without relabeling.
- `src/cli/commands/run-once/pipeline-development-environment.test.ts` — durable
  approvals and non-fabricated retry labels.
- `site/src/content/docs/reference/workflow-labels.md` — durable approval and
  artifact-guard semantics.
- `site/src/content/docs/using-patchmill/run-once.md` — operator recovery and
  approval behavior.
- `site/src/content/docs/using-patchmill/workflow-artifacts.md` — approved
  artifact publication requirement.

Existing `pipeline-finish.ts` continues to call the shared cleanup helper. The
integration tests must prove that this indirect path preserves approvals, so a
separate finish implementation is unnecessary.

---

### Task 1: Resolve durable labels by the latest workflow stage

**Files:**

- Modify: `src/cli/commands/run-once/workflow-state.test.ts:44-85`
- Modify: `src/cli/commands/run-once/workflow-state.ts:66-90`

**Interfaces:**

- Consumes: `WorkflowStateOptions` and `WorkflowApprovalPolicy` unchanged.
- Produces: `resolveWorkflowState(labels, options): RunOnceWorkflowState` with
  plan review taking precedence over durable spec approval, while approval still
  wins over review for the same stage.

- [ ] **Step 1: Add failing later-stage precedence tests**

Add these cases beside the existing workflow-state resolution tests:

```ts
test("resolveWorkflowState treats plan review as later than durable spec approval", () => {
  assert.deepEqual(
    resolveWorkflowState(["spec-approved", "plan-review"], {
      readyLabel: ready,
      policy,
    }),
    { kind: "waiting-plan-review", missingLabel: "plan-approved" },
  );
});

test("resolveWorkflowState treats spec review as later than agent-ready", () => {
  assert.deepEqual(
    resolveWorkflowState([ready, "spec-review"], {
      readyLabel: ready,
      policy,
    }),
    { kind: "waiting-spec-review", missingLabel: "spec-approved" },
  );
});
```

Keep the existing tests proving that `spec-approved` wins over `spec-review` and
`plan-approved` wins over `plan-review`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test \
  --test-name-pattern="resolveWorkflowState" \
  src/cli/commands/run-once/workflow-state.test.ts
```

Expected: both new tests fail because the current resolver checks
`spec-approved` and `agent-ready` before later review labels.

- [ ] **Step 3: Implement stage-aware resolution**

Replace `resolveWorkflowState` with this ordering:

```ts
export function resolveWorkflowState(
  labels: string[],
  options: WorkflowStateOptions,
): RunOnceWorkflowState {
  const { readyLabel, policy } = options;
  const { specApproval, planApproval } = policy;

  if (has(labels, planApproval.approvedLabel)) return { kind: "plan-approved" };
  if (has(labels, planApproval.reviewLabel)) {
    return {
      kind: "waiting-plan-review",
      missingLabel: planApproval.approvedLabel,
    };
  }
  if (has(labels, specApproval.approvedLabel)) return { kind: "spec-approved" };
  if (has(labels, specApproval.reviewLabel)) {
    return {
      kind: "waiting-spec-review",
      missingLabel: specApproval.approvedLabel,
    };
  }
  if (has(labels, readyLabel)) return { kind: "agent-ready" };

  return { kind: "not-actionable" };
}
```

- [ ] **Step 4: Run the workflow-state tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/run-once/workflow-state.test.ts
```

Expected: all workflow-state tests pass.

- [ ] **Step 5: Commit the state precedence change**

```bash
git add \
  src/cli/commands/run-once/workflow-state.ts \
  src/cli/commands/run-once/workflow-state.test.ts
git commit -m "fix(run-once): resolve durable approval stages"
```

---

### Task 2: Reject approved issues whose artifacts cannot be resolved

**Files:**

- Create: `src/cli/commands/run-once/approval-artifact-preflight.ts`
- Create: `src/cli/commands/run-once/approval-artifact-preflight.test.ts`
- Modify: `src/cli/commands/run-once/artifacts.ts:47-68`
- Modify: `src/cli/commands/run-once/pipeline.ts:23-31,273-289`
- Modify: `src/cli/commands/run-once/workflow-state.ts:43-51,121-145`
- Modify: `src/cli/commands/run-once/workflow-state.test.ts:127-175`
- Modify:
  `src/cli/commands/run-once/stage-advancement.ts:247-255,544-550,684-789`
- Modify:
  `src/cli/commands/run-once/pipeline-planning.test.ts:1168-1251,2116-2200`

**Interfaces:**

- Consumes: `AgentIssueConfig`, `AgentIssueRunState`, `IssueSummary`,
  `ResolvedIssueArtifactSources`, and `resolvePlanningArtifacts()`.
- Produces:

```ts
export async function findIssueArtifacts(
  artifactDir: string,
  issueNumber: number,
): Promise<string[]>;

export type ApprovedArtifactPreflightOptions = {
  config: Pick<
    AgentIssueConfig,
    "repoRoot" | "specsDir" | "plansDir" | "approvalPolicy"
  >;
  issue: IssueSummary;
  existingState?: AgentIssueRunState;
  resolvedArtifacts: ResolvedIssueArtifactSources;
  now: Date;
};

export async function assertApprovedArtifactsResolvable(
  options: ApprovedArtifactPreflightOptions,
): Promise<void>;
```

- The function is read-only. It either returns or throws
  `PlanningArtifactSafetyError` before claim.

- [ ] **Step 1: Write failing preflight unit tests**

Create `approval-artifact-preflight.test.ts` with these fixtures and cases:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import {
  assertApprovedArtifactsResolvable,
  type ApprovedArtifactPreflightOptions,
} from "./approval-artifact-preflight.ts";
import type { ResolvedIssueArtifactSource } from "./artifact-sources.ts";
import type { IssueSummary } from "./types.ts";

const now = new Date("2026-08-02T12:00:00Z");

async function fixture() {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-approval-preflight-"),
  );
  const approvalPolicy = createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
    },
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required: true,
    },
  });
  const config: ApprovedArtifactPreflightOptions["config"] = {
    repoRoot,
    specsDir: join(repoRoot, "docs", "specs"),
    plansDir: join(repoRoot, "docs", "plans"),
    approvalPolicy,
  };
  const issue: IssueSummary = {
    number: 140,
    title: "Keep approved artifacts",
    body: "Approved workflow artifacts",
    labels: [],
    state: "open",
    comments: [],
  };
  return { config, issue };
}

function source(
  repoRoot: string,
  kind: "spec" | "plan",
): ResolvedIssueArtifactSource {
  const path =
    kind === "spec"
      ? "docs/specs/approved-design.md"
      : "docs/plans/approved-plan.md";
  return {
    path,
    absolutePath: join(repoRoot, path),
    content: `# Approved ${kind}`,
    evidence: `approved ${kind} fixture`,
  };
}

test("approved spec without a resolvable spec fails safely", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /spec-approved.*no spec artifact could be resolved/u,
  );
});

test("approved plan without a resolvable plan fails safely", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.planApproval.approvedLabel];

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /plan-approved.*no plan artifact could be resolved/u,
  );
});

test("resolved approved artifacts pass preflight", async () => {
  const { config, issue } = await fixture();
  issue.labels = [
    config.approvalPolicy.specApproval.approvedLabel,
    config.approvalPolicy.planApproval.approvedLabel,
  ];

  await assert.doesNotReject(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {
        spec: source(config.repoRoot, "spec"),
        plan: source(config.repoRoot, "plan"),
      },
      now,
    }),
  );
});

test("approved spec with multiple discovered specs fails as ambiguous", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];
  await mkdir(config.specsDir, { recursive: true });
  await writeFile(
    join(config.specsDir, "2026-08-01-issue-140-first-design.md"),
    "# First spec\n",
    "utf8",
  );
  await writeFile(
    join(config.specsDir, "2026-08-02-issue-140-second-design.md"),
    "# Second spec\n",
    "utf8",
  );

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /spec-approved.*multiple spec artifacts/u,
  );
});

test("preflight uses configured approval label names", async () => {
  const { config, issue } = await fixture();
  config.approvalPolicy = createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
      approvedLabel: "spec-reviewed",
    },
  });
  issue.labels = ["spec-reviewed"];

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /spec-reviewed.*no spec artifact could be resolved/u,
  );
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test src/cli/commands/run-once/approval-artifact-preflight.test.ts
```

Expected: FAIL because `approval-artifact-preflight.ts` does not exist.

- [ ] **Step 3: Expose all deterministic filename candidates**

Refactor `artifacts.ts` without changing existing unapproved discovery:

```ts
export async function findIssueArtifacts(
  artifactDir: string,
  issueNumber: number,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(artifactDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const marker = `-issue-${issueNumber}-`;
  return entries
    .filter((entry) => entry.isFile() && entry.name.includes(marker))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => join(artifactDir, entry));
}

export async function findIssueArtifact(
  artifactDir: string,
  issueNumber: number,
): Promise<string | undefined> {
  return (await findIssueArtifacts(artifactDir, issueNumber))[0];
}
```

The existing spec/plan discovery tests continue to prove that ordinary
unapproved workflow discovery selects the first deterministic match.

- [ ] **Step 4: Implement the read-only preflight module**

Create `approval-artifact-preflight.ts`:

```ts
import { basename, join } from "node:path";
import { findIssueArtifacts } from "./artifacts.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import {
  PlanningArtifactSafetyError,
  resolvePlanningArtifacts,
  type PlanningArtifactPolicy,
  type ResolvedPlanningArtifacts,
} from "./planning-artifacts.ts";
import { mirrorConfiguredPathInWorktree } from "./pipeline-workspace.ts";
import type {
  AgentIssueConfig,
  AgentIssueRunState,
  IssueSummary,
} from "./types.ts";

export type ApprovedArtifactPreflightOptions = {
  config: Pick<
    AgentIssueConfig,
    "repoRoot" | "specsDir" | "plansDir" | "approvalPolicy"
  >;
  issue: IssueSummary;
  existingState?: AgentIssueRunState;
  resolvedArtifacts: ResolvedIssueArtifactSources;
  now: Date;
};

function preflightPolicy(
  options: ApprovedArtifactPreflightOptions,
): PlanningArtifactPolicy {
  const { config, existingState } = options;
  const worktreeRoot = existingState?.worktreePath
    ? join(config.repoRoot, existingState.worktreePath)
    : undefined;
  const primaryRoot = worktreeRoot ?? config.repoRoot;

  return {
    kind: "fresh",
    primary: {
      repoRoot: primaryRoot,
      specsDir: mirrorConfiguredPathInWorktree(
        config.repoRoot,
        primaryRoot,
        config.specsDir,
      ),
      plansDir: mirrorConfiguredPathInWorktree(
        config.repoRoot,
        primaryRoot,
        config.plansDir,
      ),
      source: worktreeRoot ? "resume-worktree" : "primary-repo",
    },
    fallbacks: worktreeRoot
      ? [
          {
            repoRoot: config.repoRoot,
            specsDir: config.specsDir,
            plansDir: config.plansDir,
            source: "primary-repo",
          },
        ]
      : undefined,
    explicit: options.resolvedArtifacts,
    saved: {
      specPath: existingState?.specPath,
      specCommit: existingState?.specCommit,
      planPath: existingState?.planPath,
      planCommit: existingState?.planCommit,
      specCreated: existingState?.checkpoints?.specCreated,
      planCreated: existingState?.checkpoints?.planCreated,
    },
    allowGeneratedSpec: false,
    allowGeneratedPlan: false,
  };
}

function artifactDirs(
  options: ApprovedArtifactPreflightOptions,
  kind: "spec" | "plan",
): string[] {
  const configuredDir =
    kind === "spec" ? options.config.specsDir : options.config.plansDir;
  if (!options.existingState?.worktreePath) return [configuredDir];

  const worktreeRoot = join(
    options.config.repoRoot,
    options.existingState.worktreePath,
  );
  return [
    mirrorConfiguredPathInWorktree(
      options.config.repoRoot,
      worktreeRoot,
      configuredDir,
    ),
    configuredDir,
  ];
}

async function assertUnambiguousDiscovery(
  options: ApprovedArtifactPreflightOptions,
  kind: "spec" | "plan",
  label: string,
): Promise<void> {
  if (options.resolvedArtifacts[kind]) return;
  const savedPath =
    kind === "spec"
      ? options.existingState?.specPath
      : options.existingState?.planPath;
  if (savedPath) return;

  const candidates = (
    await Promise.all(
      artifactDirs(options, kind).map((dir) =>
        findIssueArtifacts(dir, options.issue.number),
      ),
    )
  ).flat();
  const names = [
    ...new Set(candidates.map((candidate) => basename(candidate))),
  ];
  if (names.length <= 1) return;

  throw new PlanningArtifactSafetyError(
    `Issue #${options.issue.number} has approval label ${label}, but multiple ${kind} artifacts could be resolved: ${names.join(", ")}`,
  );
}

function missingApprovedArtifact(
  issue: IssueSummary,
  label: string,
  kind: "spec" | "plan",
): PlanningArtifactSafetyError {
  return new PlanningArtifactSafetyError(
    `Issue #${issue.number} has approval label ${label}, but no ${kind} artifact could be resolved; remove ${label} before creating a new ${kind}`,
  );
}

export async function assertApprovedArtifactsResolvable(
  options: ApprovedArtifactPreflightOptions,
): Promise<void> {
  const specLabel = options.config.approvalPolicy.specApproval.approvedLabel;
  const planLabel = options.config.approvalPolicy.planApproval.approvedLabel;
  const requiresSpec = options.issue.labels.includes(specLabel);
  const requiresPlan = options.issue.labels.includes(planLabel);
  if (!requiresSpec && !requiresPlan) return;

  if (requiresSpec) {
    await assertUnambiguousDiscovery(options, "spec", specLabel);
  }
  if (requiresPlan) {
    await assertUnambiguousDiscovery(options, "plan", planLabel);
  }

  let artifacts: ResolvedPlanningArtifacts;
  try {
    artifacts = await resolvePlanningArtifacts({
      policy: preflightPolicy(options),
      issue: options.issue,
      now: options.now,
    });
  } catch (error) {
    if (error instanceof PlanningArtifactSafetyError) {
      const labels = [
        ...(requiresSpec ? [specLabel] : []),
        ...(requiresPlan ? [planLabel] : []),
      ].join(", ");
      throw new PlanningArtifactSafetyError(
        `Issue #${options.issue.number} has approval label ${labels}, but approved artifacts could not be resolved: ${error.message}`,
      );
    }
    throw error;
  }

  if (requiresSpec && !artifacts.spec.exists) {
    throw missingApprovedArtifact(options.issue, specLabel, "spec");
  }
  if (requiresPlan && !artifacts.plan.exists) {
    throw missingApprovedArtifact(options.issue, planLabel, "plan");
  }
}
```

- [ ] **Step 5: Run the preflight unit tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/run-once/approval-artifact-preflight.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Remove stale-approval gate branches made impossible by
      preflight**

In `workflow-state.ts`:

- remove `staleApprovedLabel` from `PlanApprovalGateDecision`;
- remove `planCreatedThisRun` from `decidePlanApprovalGate()` options;
- let a present configured plan-approved label always return `proceed`.

The final gate is:

```ts
export function decidePlanApprovalGate(options: {
  labels: string[];
  planOnly: boolean;
  policy: WorkflowApprovalPolicy;
}): PlanApprovalGateDecision {
  if (options.planOnly) return { action: "stop-for-plan-only" };
  const approval = options.policy.planApproval;
  if (!approval.required) return { action: "proceed" };
  if (options.labels.includes(approval.approvedLabel)) {
    return { action: "proceed" };
  }
  return {
    action: "stop-for-plan-review",
    reviewLabel: approval.reviewLabel,
    missingLabel: approval.approvedLabel,
  };
}
```

Delete the stale-plan unit test at `workflow-state.test.ts:161-175`. In
`stage-advancement.ts`, remove `specCreatedThisRun`, `planCreatedThisRun`, their
assignments, the `!specCreatedThisRun` condition, and the `planCreatedThisRun`
argument passed to `decidePlanApprovalGate()`.

- [ ] **Step 7: Wire preflight before claim**

Import `assertApprovedArtifactsResolvable` in `pipeline.ts`. Immediately after
`runArtifactSourceStage()` assigns `issueForRun` and `resolvedArtifacts`, and
before repository status checking or the claim label edit, add:

```ts
await assertApprovedArtifactsResolvable({
  config,
  issue: issueForRun,
  existingState,
  resolvedArtifacts,
  now: runOptions.now ?? new Date(),
});
```

Do not place this inside the later pipeline `try` block: a safety failure must
not become an unexpected-failure comment or mutate run state.

- [ ] **Step 8: Rewrite contradictory pipeline scenarios as safety failures**

Rename the test at `pipeline-planning.test.ts:1168` to:

```ts
test("runOneIssue rejects spec-approved when no spec can be resolved", async () => {
```

Keep its issue labels and missing-spec fixture, but replace the old result and
label assertions with:

```ts
await assert.rejects(
  () => runOneIssue(runner, config, { now: NOW }),
  /spec-approved.*no spec artifact could be resolved/u,
);
assert.equal(
  runner.calls.some((call) => call.command === "pi"),
  false,
);
assert.equal(
  runner.calls.some(
    (call) =>
      call.command === "tea" &&
      ((call.args[0] === "issues" && call.args[1] === "edit") ||
        call.args[0] === "comment"),
  ),
  false,
);
```

Rename the test at `pipeline-planning.test.ts:2116` to:

```ts
test("runOneIssue rejects plan-approved when no plan can be resolved", async () => {
```

Replace its Pi/result/label assertions with the corresponding
`plan-approved.*no plan artifact could be resolved` rejection and the same
no-Pi/no-label/no-comment checks.

- [ ] **Step 9: Run strict artifact tests and build**

Run:

```bash
node --test \
  src/cli/commands/run-once/approval-artifact-preflight.test.ts \
  src/cli/commands/run-once/workflow-state.test.ts
node --test \
  --test-name-pattern="no (spec|plan) can be resolved" \
  src/cli/commands/run-once/pipeline-planning.test.ts
npm run build
```

Expected: all selected tests pass and TypeScript builds without errors.

- [ ] **Step 10: Commit the approved-artifact guard**

```bash
git add \
  src/cli/commands/run-once/approval-artifact-preflight.ts \
  src/cli/commands/run-once/approval-artifact-preflight.test.ts \
  src/cli/commands/run-once/artifacts.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/workflow-state.ts \
  src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
git commit -m "fix(run-once): guard approved artifacts"
```

---

### Task 3: Preserve approvals through review, implementation, and completion

**Files:**

- Modify: `src/cli/commands/run-once/workflow-state.test.ts:187-228`
- Modify: `src/cli/commands/run-once/workflow-state.ts:147-188`
- Modify:
  `src/cli/commands/run-once/pipeline-planning.test.ts:1253-1336,2202-2312`

**Interfaces:**

- Consumes: existing `cleanupLabelsForSpecReview`, `cleanupLabelsForPlanReview`,
  and `cleanupLabelsForImplementation` signatures.
- Produces: cleanup functions that remove only lifecycle/review labels and never
  configured approval labels. `pipeline-finish.ts` inherits the behavior through
  `cleanupLabelsForImplementation()`.

- [ ] **Step 1: Change cleanup tests to require durable approvals**

Replace the three cleanup expectations with:

```ts
test("cleanupLabelsForSpecReview preserves approval labels", () => {
  assert.deepEqual(
    cleanupLabelsForSpecReview(
      [ready, "spec-approved", "plan-review", "plan-approved", "bug"],
      { readyLabel: ready, policy },
    ),
    ["spec-approved", "plan-approved", "bug", "spec-review"],
  );
});

test("cleanupLabelsForPlanReview preserves approval labels", () => {
  assert.deepEqual(
    cleanupLabelsForPlanReview(
      [ready, "spec-review", "spec-approved", "plan-approved", "bug"],
      { readyLabel: ready, policy },
    ),
    ["spec-approved", "plan-approved", "bug", "plan-review"],
  );
});

test("cleanupLabelsForImplementation preserves approval labels", () => {
  assert.deepEqual(
    cleanupLabelsForImplementation(
      [
        ready,
        "spec-review",
        "spec-approved",
        "plan-review",
        "plan-approved",
        "bug",
      ],
      { readyLabel: ready, policy },
    ),
    ["spec-approved", "plan-approved", "bug"],
  );
});
```

- [ ] **Step 2: Run cleanup tests and verify RED**

Run:

```bash
node --test \
  --test-name-pattern="cleanupLabels" \
  src/cli/commands/run-once/workflow-state.test.ts
```

Expected: all three tests fail because the current helpers remove approvals.

- [ ] **Step 3: Remove approval labels from cleanup removal sets**

Implement the three helpers as:

```ts
export function cleanupLabelsForSpecReview(
  labels: string[],
  options: WorkflowStateOptions,
): string[] {
  return addLabel(
    removeLabels(labels, [
      options.readyLabel,
      options.policy.planApproval.reviewLabel,
    ]),
    options.policy.specApproval.reviewLabel,
  );
}

export function cleanupLabelsForPlanReview(
  labels: string[],
  options: WorkflowStateOptions,
): string[] {
  return addLabel(
    removeLabels(labels, [
      options.readyLabel,
      options.policy.specApproval.reviewLabel,
    ]),
    options.policy.planApproval.reviewLabel,
  );
}

export function cleanupLabelsForImplementation(
  labels: string[],
  options: WorkflowStateOptions,
): string[] {
  return removeLabels(labels, [
    options.readyLabel,
    options.policy.specApproval.reviewLabel,
    options.policy.planApproval.reviewLabel,
  ]);
}
```

- [ ] **Step 4: Strengthen the plan-review integration assertion**

Rename the test at `pipeline-planning.test.ts:1253` to:

```ts
test("runOneIssue writes a plan and preserves spec approval at plan review", async () => {
```

Replace the weak `args.includes("spec-approved")` assertion with:

```ts
const removedLabels =
  finalEdit.args[finalEdit.args.indexOf("--remove-labels") + 1]?.split(",") ??
  [];
assert.deepEqual(removedLabels.sort(), ["in-progress", "spec-review"].sort());
assert.equal(removedLabels.includes("spec-approved"), false);
```

The expected add-label argument remains `plan-review`.

- [ ] **Step 5: Strengthen successful completion coverage**

In the test at `pipeline-planning.test.ts:2202`:

1. Create a resolvable spec because the issue carries `spec-approved`:

```ts
const specPath = "docs/specs/2026-05-14-issue-49-approved-spec-design.md";
await writeFile(join(config.repoRoot, specPath), "# spec\n", "utf8");
```

1. Rename the test to:

```ts
test("runOneIssue preserves approvals while clearing review labels", async () => {
```

1. Replace the four weak `args.includes()` assertions with an assertion over all
   label edits:

```ts
const removedLabels = editCalls.flatMap((call) => {
  const index = call.args.indexOf("--remove-labels");
  return index < 0 ? [] : (call.args[index + 1]?.split(",") ?? []);
});
assert.equal(removedLabels.includes("spec-approved"), false);
assert.equal(removedLabels.includes("plan-approved"), false);
assert.equal(removedLabels.includes("spec-review"), true);
assert.equal(removedLabels.includes("plan-review"), true);
assert.equal(removedLabels.includes("in-progress"), true);
```

This single scenario covers claim, implementation cleanup, and the
`pipeline-finish.ts` completion path.

- [ ] **Step 6: Run durable transition tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/run-once/workflow-state.test.ts
node --test \
  --test-name-pattern="preserves spec approval|preserves approvals while" \
  src/cli/commands/run-once/pipeline-planning.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit durable cleanup behavior**

```bash
git add \
  src/cli/commands/run-once/workflow-state.ts \
  src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
git commit -m "fix(run-once): preserve approval labels"
```

---

### Task 4: Resume authorized implementation without reapproval

**Files:**

- Modify:
  `src/cli/commands/run-once/stage-advancement.ts:89-121,222-255,544-550,784-801`
- Modify: `src/cli/commands/run-once/pipeline.ts:151-155,499-525`
- Modify: `src/cli/commands/run-once/workflow-state.ts:190-209`
- Modify: `src/cli/commands/run-once/workflow-state.test.ts:230-252`
- Modify:
  `src/cli/commands/run-once/pipeline-failures-scenarios.test.ts:886-1064`
- Modify:
  `src/cli/commands/run-once/pipeline-development-environment.test.ts:295-501`

**Interfaces:**

- Adds required input:

```ts
approvalGatesSatisfied: boolean;
```

to `AdvancePlanningStagesOptions`.

- `pipeline.ts` sets it only when the selected issue is an ordinary resumable
  run whose saved status is `implementing`.
- `retryableLabelsAfterDevelopmentEnvironmentFailure()` keeps its signature but
  restores `readyLabel`, not fabricated plan approval, when no original
  actionable label can be proven.

- [ ] **Step 1: Turn the unsupported-JSON scenario into the reported approval
      regression**

In `pipeline-failures-scenarios.test.ts:886`, first extend the shared fixture
import:

```ts
import {
  approvalPolicy,
  makeConfig,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";
```

Then change the existing test configuration and fixtures to require spec
approval:

```ts
const config = await makeConfig({
  dryRun: false,
  execute: true,
  approvalPolicy: approvalPolicy({ specRequired: true }),
});
const selected = issue(
  42,
  ["spec-review", "spec-approved", "enhancement"],
  "Handle implementation parse failure",
);
const existingSpecPath = join(
  config.specsDir,
  "2026-05-01-issue-42-handle-implementation-parse-failure-design.md",
);
await writeFile(existingSpecPath, "# spec\n", "utf8");
```

Keep the existing plan fixture and unsupported `{"status":"unknown"}` Pi result.
Remove the old `assert.equal(editCalls.length, 1)` check because claim and
review cleanup are separate idempotent edits for this label set. After the first
run, add:

```ts
const removedLabels = editCalls.flatMap((call) => {
  const index = call.args.indexOf("--remove-labels");
  return index < 0 ? [] : (call.args[index + 1]?.split(",") ?? []);
});
assert.equal(removedLabels.includes("spec-approved"), false);
```

Change the resumed issue payload to retain approval:

```ts
issue(
  42,
  ["in-progress", "spec-approved", "enhancement"],
  "Handle implementation parse failure",
);
```

Keep the final assertion that the rerun returns `pr-created`. This reproduces
the screenshot sequence without manual relabeling.

- [ ] **Step 2: Make the legacy resume test require plan approval**

In `pipeline-development-environment.test.ts:380`, add a required plan gate
while leaving the resumed issue labels as only `in-progress`:

```ts
const config = await makeConfig({
  dryRun: false,
  execute: true,
  approvalPolicy: specAndPlanApprovalPolicy(),
  skills: {
    ...DEFAULT_PATCHMILL_CONFIG.skills,
    developmentEnvironment: "./skills/development-environment",
  },
});
```

The existing saved state is `implementing` and has a saved plan. Keep the
assertion that the development-environment Pi prompt runs. Without authoritative
resume, this test stops at plan review before Pi.

- [ ] **Step 3: Update retry-label tests to forbid fabricated approval**

Change the unit test at `workflow-state.test.ts:242` to:

```ts
test("retryableLabelsAfterDevelopmentEnvironmentFailure restores ready for legacy resume", () => {
  assert.deepEqual(
    retryableLabelsAfterDevelopmentEnvironmentFailure(["in-progress", "bug"], {
      readyLabel: ready,
      policy,
      originalLabels: ["in-progress"],
      inProgressLabel: "in-progress",
    }),
    ["bug", ready],
  );
});
```

In `pipeline-development-environment.test.ts`:

- change the default not-ready expectation at lines 322-329 from added
  `plan-approved` to added `agent-ready`;
- in the durable-approval scenario at lines 333-378, assert that the final edit
  has no `--add-labels` argument and removes only `in-progress`;
- in the resumed legacy scenario at lines 493-500, expect `agent-ready` instead
  of `plan-approved`.

- [ ] **Step 4: Run recovery tests and verify RED**

Run:

```bash
node --test \
  --test-name-pattern="unexpected implementation failures|resumed development environment failure" \
  src/cli/commands/run-once/pipeline-failures-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts
node --test \
  --test-name-pattern="retryableLabelsAfterDevelopmentEnvironmentFailure" \
  src/cli/commands/run-once/workflow-state.test.ts
```

Expected: the legacy resumed run stops for plan approval, and retry-label tests
fail because current code fabricates `plan-approved`.

- [ ] **Step 5: Pass authoritative approval state into planning**

Add this required property to `AdvancePlanningStagesOptions`:

```ts
approvalGatesSatisfied: boolean;
```

Destructure it in `advancePlanningStages()`. In `pipeline.ts`, pass:

```ts
approvalGatesSatisfied:
  ordinaryResumableState && existingState?.status === "implementing",
```

Change spec approval calculation to:

```ts
const hasCurrentSpecApproval =
  approvalGatesSatisfied ||
  issue.labels.includes(config.approvalPolicy.specApproval.approvedLabel);
```

Change plan gate calculation to:

```ts
const planGate = approvalGatesSatisfied
  ? ({ action: "proceed" } as const)
  : decidePlanApprovalGate({
      labels,
      planOnly: config.planOnly,
      policy: config.approvalPolicy,
    });
```

Do not bypass artifact/worktree validation; bypass only the two human approval
gates.

- [ ] **Step 6: Stop fabricating plan approval on development-environment
      failure**

In `retryableLabelsAfterDevelopmentEnvironmentFailure()`, replace the fallback:

```ts
const restore =
  originalActionableLabels.length > 0
    ? originalActionableLabels
    : [options.readyLabel];
```

The existing `withoutInProgress` value already retains durable approvals, so
normal approved runs will not emit redundant add-label operations.

- [ ] **Step 7: Run recovery tests and verify GREEN**

Run:

```bash
node --test \
  src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts
node --test \
  --test-name-pattern="unexpected implementation failures" \
  src/cli/commands/run-once/pipeline-failures-scenarios.test.ts
```

Expected: all selected tests pass; the unsupported-JSON rerun reaches
`pr-created`; the legacy implementing run reaches the development-environment
stage despite missing approval labels; retryable failures never invent
`plan-approved`.

- [ ] **Step 8: Commit recovery semantics**

```bash
git add \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/workflow-state.ts \
  src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/run-once/pipeline-failures-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts
git commit -m "fix(run-once): resume authorized implementation"
```

---

### Task 5: Document durable approvals and run final verification

**Files:**

- Modify: `site/src/content/docs/reference/workflow-labels.md:47-107`
- Modify: `site/src/content/docs/using-patchmill/run-once.md:71-88`
- Modify: `site/src/content/docs/using-patchmill/workflow-artifacts.md:47-64`

**Interfaces:**

- Consumes: implemented workflow semantics from Tasks 1-4.
- Produces: operator-facing documentation. No runtime interface changes.

- [ ] **Step 1: Update the workflow-label reference**

After the actionable/waiting-state paragraph in `reference/workflow-labels.md`,
add:

```markdown
Approved labels are durable facts about the current resolvable artifacts.
Patchmill preserves them through claim, implementation, failure, resume, and
successful completion. Review, ready, in-progress, needs-info, and done labels
continue to represent transient workflow or lifecycle state.

An approved label requires its corresponding artifact to resolve. If
`spec-approved` has no valid spec, or `plan-approved` has no valid plan,
`run-once` stops with a safety error before claiming the issue or invoking Pi.
Remove approval explicitly before replacing an approved artifact.
```

Replace the final sentence at lines 105-107 with:

```markdown
Humans may either replace a review label with its approved label or leave both
in place. Approval wins over review for the same stage; a later-stage review,
such as `plan-review`, wins over durable approval from an earlier stage.
```

- [ ] **Step 2: Update run-once operator guidance**

After the paragraph that instructs users to add an approved label, add:

```markdown
Patchmill keeps that approval label after the workflow advances. A failed
implementation can therefore resume without asking a human to approve the same
artifact again. If an approved artifact is missing or invalid, restore the
published artifact or explicitly remove approval before creating a replacement.
```

- [ ] **Step 3: Update workflow-artifact guidance**

After the numbered recommended workflow, add:

```markdown
An approval label asserts that the corresponding artifact has been published or
otherwise resolves unambiguously and is the artifact Patchmill must reuse. Do
not apply `spec-approved` before a spec resolves or `plan-approved` before a
plan resolves. Patchmill fails safely rather than synthesizing a replacement for
a missing approved artifact.
```

- [ ] **Step 4: Verify documentation directly**

No new automated test is warranted for prose. Run format, Markdown lint, and the
site build instead:

```bash
npx prettier --check \
  site/src/content/docs/reference/workflow-labels.md \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/using-patchmill/workflow-artifacts.md
npx markdownlint-cli2 \
  site/src/content/docs/reference/workflow-labels.md \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/using-patchmill/workflow-artifacts.md
npm --prefix site run build
```

Expected: Prettier reports all files formatted, Markdown lint reports zero
errors, and the Astro site build exits 0.

- [ ] **Step 5: Run focused and full project verification**

Run:

```bash
npm run test:run-once
npm test
npm run lint
npm run build
git diff --check
```

Expected:

- run-once tests pass with zero failures;
- the full Node test suite passes with zero failures;
- Prettier, ESLint, and Markdown lint report zero errors;
- TypeScript build exits 0;
- `git diff --check` emits no output.

No Nix build is required because package dependencies and lock files do not
change.

- [ ] **Step 6: Commit documentation**

```bash
git add \
  site/src/content/docs/reference/workflow-labels.md \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/using-patchmill/workflow-artifacts.md
git commit -m "docs(run-once): explain durable approvals"
```

- [ ] **Step 7: Inspect final branch state**

Run:

```bash
git status --short
git log --oneline --decorate -8
```

Expected: working tree is clean and the branch contains the design commit, plan
commit, four code commits, and documentation commit described above.
