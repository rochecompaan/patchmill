# Run Once Workflow Advancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill run-once` advance issues through spec, plan, and
implementation workflow states while treating `agent-ready`, `spec-approved`,
and `plan-approved` as actionable labels.

**Architecture:** Add small pure workflow modules for state resolution and label
cleanup, then wire those into the existing run-once selection and pipeline. Add
spec artifact support parallel to existing plan artifact support, and keep
`pipeline.ts` as orchestration while extracting new deterministic rules into
focused modules.

**Tech Stack:** TypeScript, Node.js `node:test`, existing Patchmill CLI/host/Pi
abstractions.

---

## Spec reference

Implement the approved design in:

- `docs/specs/2026-06-13-run-once-workflow-advancement-design.md`

The most important invariants are:

- `agent-ready` means automation may advance the issue.
- `spec-approved` and `plan-approved` are actionable run-once states.
- `spec-review` and `plan-review` are waiting states unless the approved label
  is also present.
- The agent writes a spec before a plan and a plan before implementation.
- `run-once` cleans stale `spec-*` and `plan-*` labels when advancing past those
  stages.

## File structure

Create these focused modules:

- `src/cli/commands/run-once/workflow-state.ts`
  - Pure label/state resolution for run-once actionable and waiting workflow
    states.
  - Pure label cleanup helpers.
- `src/cli/commands/run-once/workflow-state.test.ts`
  - Unit tests for state priority, waiting states, approval-required decisions,
    and cleanup rules.
- `src/cli/commands/run-once/specs.ts`
  - Spec artifact filename/path lookup helpers, parallel to `plans.ts`.
- `src/cli/commands/run-once/specs.test.ts`
  - Unit tests for deterministic spec paths and lookup.

Modify these existing modules:

- `src/config/types.ts`, `src/config/defaults.ts`, `src/config/load.ts`, and
  config tests
  - Add `paths.specsDir` with default `docs/specs`.
- `src/cli/commands/run-once/types.ts`
  - Add spec path/commit state and pipeline/Pi result types.
- `src/cli/commands/run-once/run-state.ts` and tests
  - Persist spec path/commit and spec checkpoints.
- `src/cli/commands/run-once/pi.ts` and tests
  - Parse `spec-created` Pi output.
- `src/cli/commands/run-once/prompts.ts` and tests
  - Add `buildSpecCreationPrompt()` and teach plan prompts about a spec path.
- `src/cli/commands/run-once/selection.ts` and tests
  - Select actionable workflow states instead of only `agent-ready`.
- `src/cli/commands/run-once/pipeline.ts` and tests
  - Orchestrate spec creation/reuse, plan creation/reuse, label transitions, and
    cleanup.
- `src/cli/commands/run-once/main.ts` and args tests
  - Summarize new dry-run transitions and spec-review stop results.
- `README.md`, `docs/configuration.md`, `docs/issue-agent-workflows.md`,
  `docs/skills.md`
  - Update user-facing workflow semantics.

`pipeline.ts` is already large (~1685 lines). Do not add new rule-heavy helpers
there unless they are only meaningful beside the orchestration. Keep new
deterministic workflow decisions in `workflow-state.ts` and artifact path logic
in `specs.ts`.

---

## Task 1: Add pure workflow-state rules

**Files:**

- Create: `src/cli/commands/run-once/workflow-state.ts`
- Create: `src/cli/commands/run-once/workflow-state.test.ts`
- Modify: `src/cli/commands/run-once/approval-gates.ts`
- Test: `src/cli/commands/run-once/workflow-state.test.ts`

- [ ] **Step 1: Write failing workflow-state tests**

Create `src/cli/commands/run-once/workflow-state.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { ApprovalRequiredError } from "./approval-gates.ts";
import {
  cleanupLabelsForImplementation,
  cleanupLabelsForPlanReview,
  cleanupLabelsForSpecReview,
  assertExplicitWorkflowState,
  resolveWorkflowState,
} from "./workflow-state.ts";

const ready = DEFAULT_PATCHMILL_CONFIG.labels.ready;
const policy = createWorkflowApprovalPolicy({
  specApproval: {
    required: true,
    reviewLabel: "spec-review",
    approvedLabel: "spec-approved",
  },
  planApproval: {
    required: true,
    reviewLabel: "plan-review",
    approvedLabel: "plan-approved",
  },
});

test("resolveWorkflowState treats agent-ready as actionable", () => {
  assert.deepEqual(
    resolveWorkflowState([ready], { readyLabel: ready, policy }),
    {
      kind: "agent-ready",
    },
  );
});

test("resolveWorkflowState treats spec-approved as actionable even with spec-review", () => {
  assert.deepEqual(
    resolveWorkflowState(["spec-review", "spec-approved"], {
      readyLabel: ready,
      policy,
    }),
    { kind: "spec-approved" },
  );
});

test("resolveWorkflowState treats plan-approved as stronger than other workflow labels", () => {
  assert.deepEqual(
    resolveWorkflowState(
      [ready, "spec-approved", "plan-review", "plan-approved"],
      {
        readyLabel: ready,
        policy,
      },
    ),
    { kind: "plan-approved" },
  );
});

test("resolveWorkflowState treats review-only labels as waiting", () => {
  assert.deepEqual(
    resolveWorkflowState(["spec-review"], { readyLabel: ready, policy }),
    { kind: "waiting-spec-review", missingLabel: "spec-approved" },
  );
  assert.deepEqual(
    resolveWorkflowState(["plan-review"], { readyLabel: ready, policy }),
    { kind: "waiting-plan-review", missingLabel: "plan-approved" },
  );
});

test("assertExplicitWorkflowState returns actionable state for explicit issues", () => {
  assert.deepEqual(
    assertExplicitWorkflowState(["plan-review", "plan-approved"], {
      readyLabel: ready,
      policy,
      issue: {
        number: 12,
        title: "Issue 12",
        body: "",
        labels: [],
        state: "open",
      },
    }),
    { kind: "plan-approved" },
  );
});

test("assertExplicitWorkflowState throws approval-required for waiting spec review", () => {
  assert.throws(
    () =>
      assertExplicitWorkflowState(["spec-review"], {
        readyLabel: ready,
        policy,
        issue: {
          number: 7,
          title: "Issue 7",
          body: "",
          labels: [],
          state: "open",
        },
      }),
    (error: unknown) => {
      assert(error instanceof ApprovalRequiredError);
      assert.equal(error.approvalKind, "spec");
      assert.equal(error.missingLabel, "spec-approved");
      return true;
    },
  );
});

test("cleanupLabelsForSpecReview removes agent-ready and stale later approvals", () => {
  assert.deepEqual(
    cleanupLabelsForSpecReview(
      [ready, "spec-approved", "plan-review", "plan-approved", "bug"],
      {
        readyLabel: ready,
        policy,
      },
    ),
    ["bug", "spec-review"],
  );
});

test("cleanupLabelsForPlanReview removes ready and all spec labels", () => {
  assert.deepEqual(
    cleanupLabelsForPlanReview(
      [ready, "spec-review", "spec-approved", "plan-approved", "bug"],
      {
        readyLabel: ready,
        policy,
      },
    ),
    ["bug", "plan-review"],
  );
});

test("cleanupLabelsForImplementation removes all workflow review and approval labels", () => {
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
    ["bug"],
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test src/cli/commands/run-once/workflow-state.test.ts
```

Expected: FAIL because `workflow-state.ts` does not exist.

- [ ] **Step 3: Implement workflow-state helpers**

Create `src/cli/commands/run-once/workflow-state.ts`:

```ts
import type { WorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { ApprovalRequiredError } from "./approval-gates.ts";
import type { IssueSummary } from "./types.ts";

export type ActionableWorkflowState =
  | { kind: "agent-ready" }
  | { kind: "spec-approved" }
  | { kind: "plan-approved" };

export type WaitingWorkflowState =
  | { kind: "waiting-spec-review"; missingLabel: string }
  | { kind: "waiting-plan-review"; missingLabel: string };

export type RunOnceWorkflowState =
  | ActionableWorkflowState
  | WaitingWorkflowState
  | { kind: "not-actionable" };

export type WorkflowStateOptions = {
  readyLabel: string;
  policy: WorkflowApprovalPolicy;
};

function has(labels: string[], label: string): boolean {
  return labels.includes(label);
}

function removeLabels(labels: string[], remove: string[]): string[] {
  const removed = new Set(remove);
  return labels.filter((label) => !removed.has(label));
}

function addLabel(labels: string[], label: string): string[] {
  return labels.includes(label) ? labels : [...labels, label];
}

export function resolveWorkflowState(
  labels: string[],
  options: WorkflowStateOptions,
): RunOnceWorkflowState {
  const { readyLabel, policy } = options;
  const { specApproval, planApproval } = policy;

  if (has(labels, planApproval.approvedLabel)) return { kind: "plan-approved" };
  if (has(labels, specApproval.approvedLabel)) return { kind: "spec-approved" };
  if (has(labels, readyLabel)) return { kind: "agent-ready" };
  if (has(labels, specApproval.reviewLabel)) {
    return {
      kind: "waiting-spec-review",
      missingLabel: specApproval.approvedLabel,
    };
  }
  if (has(labels, planApproval.reviewLabel)) {
    return {
      kind: "waiting-plan-review",
      missingLabel: planApproval.approvedLabel,
    };
  }

  return { kind: "not-actionable" };
}

export function isActionableWorkflowState(
  state: RunOnceWorkflowState,
): state is ActionableWorkflowState {
  return (
    state.kind === "agent-ready" ||
    state.kind === "spec-approved" ||
    state.kind === "plan-approved"
  );
}

export function assertExplicitWorkflowState(
  labels: string[],
  options: WorkflowStateOptions & { issue: IssueSummary },
): ActionableWorkflowState {
  const state = resolveWorkflowState(labels, options);
  if (isActionableWorkflowState(state)) return state;

  if (state.kind === "waiting-spec-review") {
    throw new ApprovalRequiredError(options.issue, "spec", state.missingLabel);
  }
  if (state.kind === "waiting-plan-review") {
    throw new ApprovalRequiredError(options.issue, "plan", state.missingLabel);
  }

  throw new Error(
    `Issue #${options.issue.number} is open but not labeled ${options.readyLabel}, ${options.policy.specApproval.approvedLabel}, or ${options.policy.planApproval.approvedLabel}`,
  );
}

export function cleanupLabelsForSpecReview(
  labels: string[],
  options: WorkflowStateOptions,
): string[] {
  return addLabel(
    removeLabels(labels, [
      options.readyLabel,
      options.policy.specApproval.approvedLabel,
      options.policy.planApproval.reviewLabel,
      options.policy.planApproval.approvedLabel,
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
      options.policy.specApproval.approvedLabel,
      options.policy.planApproval.approvedLabel,
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
    options.policy.specApproval.approvedLabel,
    options.policy.planApproval.reviewLabel,
    options.policy.planApproval.approvedLabel,
  ]);
}
```

- [ ] **Step 4: Run the workflow-state test**

Run:

```bash
node --test src/cli/commands/run-once/workflow-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/run-once/workflow-state.ts src/cli/commands/run-once/workflow-state.test.ts
git commit -m "feat(run-once): add workflow state rules"
```

---

## Task 2: Add spec artifact configuration and helpers

**Files:**

- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/load.ts`
- Modify: `src/config/defaults.test.ts`
- Modify: `src/config/load.test.ts`
- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/args.ts`
- Create: `src/cli/commands/run-once/specs.ts`
- Create: `src/cli/commands/run-once/specs.test.ts`
- Test: `src/config/defaults.test.ts`, `src/config/load.test.ts`,
  `src/cli/commands/run-once/specs.test.ts`

- [ ] **Step 1: Write failing spec artifact tests**

Create `src/cli/commands/run-once/specs.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSpecFilename, buildSpecPath, findIssueSpec } from "./specs.ts";

test("buildSpecFilename creates deterministic issue spec filenames", () => {
  assert.equal(
    buildSpecFilename(
      42,
      "Add reusable pagination widget!",
      new Date("2026-06-13T10:00:00Z"),
    ),
    "2026-06-13-issue-42-add-reusable-pagination-widget-design.md",
  );
});

test("buildSpecPath joins configured specs directory and filename", () => {
  assert.equal(
    buildSpecPath("docs/specs", 7, "Empty issue", "2026-06-13T12:00:00Z"),
    join("docs/specs", "2026-06-13-issue-7-empty-issue-design.md"),
  );
});

test("findIssueSpec returns the first matching issue spec", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-specs-"));
  await writeFile(join(dir, "2026-06-12-issue-4-other-design.md"), "# Other\n");
  await writeFile(join(dir, "2026-06-13-issue-5-widget-design.md"), "# Spec\n");
  await writeFile(
    join(dir, "2026-06-14-issue-5-widget-v2-design.md"),
    "# Spec 2\n",
  );

  assert.equal(
    await findIssueSpec(dir, 5),
    join(dir, "2026-06-13-issue-5-widget-design.md"),
  );
});

test("findIssueSpec returns undefined when specs directory is missing", async () => {
  assert.equal(
    await findIssueSpec(join(tmpdir(), "missing-specs-dir"), 99),
    undefined,
  );
});
```

Add this assertion to the existing paths assertion in
`src/config/defaults.test.ts`:

```ts
specsDir: "docs/specs",
```

Add this test to `src/config/load.test.ts` near the existing paths tests:

```ts
test("loadPatchmillConfig parses specsDir path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-specs-dir-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({ paths: { specsDir: "engineering/specs" } }),
    "utf8",
  );

  const config = await loadPatchmillConfig(dir);

  assert.equal(config.paths.specsDir, "engineering/specs");
});
```

Add this assertion to the existing normalized path test in
`src/config/load.test.ts`:

```ts
assert.equal(config.paths.specsDir, join(dir, "engineering/specs"));
```

In that normalized path test's JSON config, include:

```json
"specsDir": "engineering/specs"
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test src/cli/commands/run-once/specs.test.ts src/config/defaults.test.ts src/config/load.test.ts
```

Expected: FAIL because `specs.ts` and `paths.specsDir` do not exist yet.

- [ ] **Step 3: Add `paths.specsDir` to config types/defaults/load**

In `src/config/types.ts`, change `PatchmillPathsConfig` to include:

```ts
export type PatchmillPathsConfig = {
  specsDir: string;
  plansDir: string;
  runStateDir: string;
  triageLogDir: string;
  worktreeDir: string;
  cleanStatusIgnorePrefixes: string[];
};
```

In `src/config/defaults.ts`, update `paths`:

```ts
paths: {
  specsDir: "docs/specs",
  plansDir: "docs/plans",
  runStateDir: ".patchmill/runs",
  triageLogDir: ".patchmill/triage-runs",
  worktreeDir: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.worktreeDir,
  cleanStatusIgnorePrefixes: [".patchmill/runs/", ".patchmill/triage-runs/"],
},
```

In `src/config/load.ts`, update `absolutizePaths()` paths:

```ts
paths: {
  specsDir: absolutize(root, config.paths.specsDir),
  plansDir: absolutize(root, config.paths.plansDir),
  runStateDir: absolutize(root, config.paths.runStateDir),
  triageLogDir: absolutize(root, config.paths.triageLogDir),
  worktreeDir: absolutize(root, config.paths.worktreeDir),
  cleanStatusIgnorePrefixes: cloneStringArray(
    config.paths.cleanStatusIgnorePrefixes,
  ),
},
```

In `src/config/load.ts`, update `readPatchmillConfigData()` path parsing:

```ts
const specsDir = readOptionalString(paths, "specsDir", "paths.specsDir");
const plansDir = readOptionalString(paths, "plansDir", "paths.plansDir");
```

and later:

```ts
if (specsDir !== undefined) parsed.specsDir = specsDir;
if (plansDir !== undefined) parsed.plansDir = plansDir;
```

- [ ] **Step 4: Add spec path to run-once config**

In `src/cli/commands/run-once/types.ts`, add `specsDir` beside `plansDir`:

```ts
specsDir: string;
plansDir: string;
```

In `src/cli/commands/run-once/args.ts`, set it when constructing `config`:

```ts
specsDir:
  normalizedConfig?.paths.specsDir ??
  join(repoRoot, patchmillConfig.paths.specsDir),
plansDir:
  normalizedConfig?.paths.plansDir ??
  join(repoRoot, patchmillConfig.paths.plansDir),
```

- [ ] **Step 5: Implement spec artifact helpers**

Create `src/cli/commands/run-once/specs.ts`:

```ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

function datePrefix(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

export function buildSpecFilename(
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return `${datePrefix(date)}-issue-${issueNumber}-${slugify(title)}-design.md`;
}

export function buildSpecPath(
  specsDir: string,
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return join(specsDir, buildSpecFilename(issueNumber, title, date));
}

export async function findIssueSpec(
  specsDir: string,
  issueNumber: number,
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(specsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  const marker = `-issue-${issueNumber}-`;
  const match = entries
    .filter((entry) => entry.isFile() && entry.name.includes(marker))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))[0];

  return match ? join(specsDir, match) : undefined;
}
```

- [ ] **Step 6: Run focused config/spec tests**

Run:

```bash
node --test src/cli/commands/run-once/specs.test.ts src/config/defaults.test.ts src/config/load.test.ts src/cli/commands/run-once/args.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts src/config/defaults.ts src/config/load.ts src/config/defaults.test.ts src/config/load.test.ts src/cli/commands/run-once/types.ts src/cli/commands/run-once/args.ts src/cli/commands/run-once/specs.ts src/cli/commands/run-once/specs.test.ts
git commit -m "feat(run-once): configure spec artifact paths"
```

---

## Task 3: Add spec run-state, Pi parsing, and spec prompt

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/run-state.ts`
- Modify: `src/cli/commands/run-once/run-state.test.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`
- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/prompts.test.ts`
- Test: run-state, pi, prompts tests

- [ ] **Step 1: Write failing type/parser/state/prompt tests**

Add this test to `src/cli/commands/run-once/pi.test.ts` near plan-created
parsing tests:

```ts
test("parsePiResult parses spec-created result", () => {
  assert.deepEqual(
    parsePiResult(
      'spec done\n{"status":"spec-created","specPath":"docs/specs/spec.md","commit":"abc123"}',
    ),
    {
      status: "spec-created",
      specPath: "docs/specs/spec.md",
      commit: "abc123",
    },
  );
});
```

Add this test to `src/cli/commands/run-once/run-state.test.ts`:

```ts
test("writeRunState preserves spec path and commit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-run-state-spec-"));

  await writeRunState(dir, {
    issueNumber: 42,
    title: "Spec issue",
    status: "planning",
    specPath: "docs/specs/spec.md",
    specCommit: "abc123",
    checkpoints: { specPathResolved: true, specCreated: true },
  });

  const state = await readRunState(dir, 42);

  assert.equal(state?.specPath, "docs/specs/spec.md");
  assert.equal(state?.specCommit, "abc123");
  assert.deepEqual(state?.checkpoints, {
    specPathResolved: true,
    specCreated: true,
  });
});
```

Add this test to `src/cli/commands/run-once/prompts.test.ts`:

```ts
test("buildSpecCreationPrompt instructs Pi to save and commit the spec", () => {
  const prompt = buildSpecCreationPrompt({
    issue,
    specPath: "docs/specs/2026-06-13-issue-42-add-once-runner-design.md",
    projectPolicy,
    specApprovalRequired: true,
    skills: DEFAULT_PATCHMILL_SKILLS,
    triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
  });

  assert.match(prompt, /Create a design spec/);
  assert.match(
    prompt,
    /docs\/specs\/2026-06-13-issue-42-add-once-runner-design\.md/,
  );
  assert.match(
    prompt,
    /Stop after writing the spec and wait for explicit manual approval/,
  );
  assert.match(prompt, /"status": "spec-created"/);
  assert.match(
    prompt,
    /"specPath": "docs\/specs\/2026-06-13-issue-42-add-once-runner-design\.md"/,
  );
});
```

If `issue`, `projectPolicy`, or `DEFAULT_PATCHMILL_SKILLS` are not already in
scope in `prompts.test.ts`, reuse the existing fixtures in that file; otherwise
import them consistently with the current test style.

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/run-state.test.ts src/cli/commands/run-once/prompts.test.ts
```

Expected: FAIL because spec-created parsing, spec state fields, and the prompt
builder do not exist yet.

- [ ] **Step 3: Extend run-once types**

In `src/cli/commands/run-once/types.ts`, add spec checkpoints:

```ts
export type AgentIssueRunCheckpoint =
  | "claimed"
  | "startedCommentPosted"
  | "specPathResolved"
  | "specCreated"
  | "specReadyCommentPosted"
  | "planPathResolved"
  | "planCreated"
  | "planReadyCommentPosted"
  | "readyLabelRestored"
  | "worktreeReady"
  | "implementationCompleted"
  | "visualEvidenceUploaded"
  | "handoffCommentPosted"
  | "doneLabelEnsured"
  | "doneLabelApplied";
```

Add fields to `AgentIssueRunState`:

```ts
specPath?: string;
specCommit?: string;
```

Add fields to `AgentIssueRunStateUpdate`:

```ts
specPath?: string;
specCommit?: string;
```

Add result type:

```ts
export type AgentIssueSpecCreatedResult = {
  status: "spec-created";
  specPath: string;
  commit?: string;
};
```

Update `AgentIssuePiResult`:

```ts
export type AgentIssuePiResult =
  | AgentIssueBlockedResult
  | AgentIssueSpecCreatedResult
  | AgentIssuePlanCreatedResult
  | AgentIssuePrCreatedResult
  | AgentIssueMergedResult;
```

Update `AgentIssuePipelineResult` to include spec stops:

```ts
| {
    status: "spec-created" | "spec-found";
    issue: IssueSummary;
    specPath: string;
  }
| {
    status: "plan-created" | "plan-found";
    issue: IssueSummary;
    specPath?: string;
    planPath: string;
  }
```

Also add optional `specPath?: string` to blocked and implementation result
branches so summaries can include it later.

- [ ] **Step 4: Persist spec fields in run state**

In `src/cli/commands/run-once/run-state.ts`, add spec fields to `next` in
`mergeRunState()`:

```ts
specPath: update.specPath ?? existing?.specPath,
specCommit: update.specCommit ?? existing?.specCommit,
```

After the `if (next.worktreePath === undefined)` block, add:

```ts
if (next.specPath === undefined) {
  delete next.specPath;
}
if (next.specCommit === undefined) {
  delete next.specCommit;
}
```

- [ ] **Step 5: Parse `spec-created` Pi results**

In `src/cli/commands/run-once/pi.ts`, add this block before the existing
`plan-created` parser block:

```ts
if (parsed.status === "spec-created" && typeof parsed.specPath === "string") {
  return {
    status: "spec-created",
    specPath: parsed.specPath,
    commit: typeof parsed.commit === "string" ? parsed.commit : undefined,
  };
}
```

- [ ] **Step 6: Add spec prompt input and builder**

In `src/cli/commands/run-once/prompts.ts`, add this exported type near
`PlanCreationPromptInput`:

```ts
export type SpecCreationPromptInput = {
  issue: IssueSummary;
  specPath: string;
  projectPolicy: PatchmillProjectPolicy;
  specApprovalRequired?: boolean;
  skills?: PatchmillSkillsConfig;
  triageLabels?: Partial<PromptTriageLabels>;
};
```

Add this function before `buildPlanCreationPrompt()`:

```ts
export function buildSpecCreationPrompt(
  input: SpecCreationPromptInput,
): string {
  const { issue, specPath, projectPolicy } = input;
  const specApprovalRequired = input.specApprovalRequired ?? false;
  const skills = input.skills ?? DEFAULT_PATCHMILL_SKILLS;
  const { ready, needsInfo } = resolvePromptTriageLabels(input.triageLabels);
  const workflow = numberedWorkflow([
    renderPlanContextInstruction(projectPolicy),
    `Treat \`${ready}\` as meaning the issue is clear enough for automation to write a design spec. Do not implement code.`,
    "Write a concise design spec that captures requirements, proposed behavior, affected components, and verification strategy.",
    `Save the spec to ${specPath}.`,
    specApprovalRequired
      ? "Stop after writing the spec and wait for explicit manual approval before planning continues."
      : "Do not stop for an additional manual spec-approval gate. Continue to planning in the next Patchmill workflow step.",
    renderTodoWorkflowStep(projectPolicy, "plan", issue.number),
    "Commit only the spec document using a Conventional Commit message.",
  ]);

  return `Create a design spec for ${formatIssueTarget(projectPolicy)} #${issue.number}: ${issue.title}

Issue data:
- Number: #${issue.number}
- Title: ${issue.title}
- Labels: ${formatLabels(issue.labels)}
- Author: ${issue.author ?? "unknown"}
- Updated: ${issue.updated ?? "unknown"}

${untrustedIssueContentBoundary()}

Issue body:
${issueBody(issue.body)}

Recent issue comments:
${formatComments(issue.comments)}

Spec output path:
${specPath}

Required workflow:
${workflow}

Blocker contract:
If the issue is not actually clear enough to write a safe spec, do not invent requirements. Instead, write no spec, make no code changes, keep the reason and questions concise enough to post directly as a \`${needsInfo}\` comment, and return this exact JSON object as the final response:
{
  "status": "blocked",
  "reason": "short reason",
  "questions": [
    {
      "question": "question a human must answer",
      "recommendedAnswer": "recommended answer and reasoning"
    }
  ]
}

Successful final response:
Return this exact JSON object after the spec commit succeeds:
{
  "status": "spec-created",
  "specPath": "${specPath}",
  "commit": "<commit sha>"
}
`;
}
```

- [ ] **Step 7: Teach plan prompt about spec path**

Update `PlanCreationPromptInput` in `prompts.ts`:

```ts
export type PlanCreationPromptInput = {
  issue: IssueSummary;
  specPath?: string;
  planPath: string;
  projectPolicy: PatchmillProjectPolicy;
  planApprovalRequired?: boolean;
  skills?: PatchmillSkillsConfig;
  triageLabels?: Partial<PromptTriageLabels>;
};
```

In `buildPlanCreationPrompt()`, destructure `specPath`:

```ts
const { issue, specPath, planPath, projectPolicy } = input;
```

Add this workflow step after `renderPlanContextInstruction(projectPolicy)`:

```ts
specPath
  ? `Read and base the implementation plan on the approved spec at ${specPath}.`
  : "No separate spec artifact was found; write the minimum design context needed in the implementation plan before task steps.",
```

Add this line to the issue data block after labels:

```ts
${specPath ? `- Spec path: ${specPath}\n` : ""}- Author: ${issue.author ?? "unknown"}
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/run-state.test.ts src/cli/commands/run-once/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/run-once/types.ts src/cli/commands/run-once/run-state.ts src/cli/commands/run-once/run-state.test.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts
git commit -m "feat(run-once): add spec creation contract"
```

---

## Task 4: Update issue selection to use actionable workflow states

**Files:**

- Modify: `src/cli/commands/run-once/selection.ts`
- Modify: `src/cli/commands/run-once/selection.test.ts`
- Test: `src/cli/commands/run-once/selection.test.ts`

- [ ] **Step 1: Replace obsolete selection tests**

In `src/cli/commands/run-once/selection.test.ts`, replace the old test named
`selectIssue skips spec-unapproved automatic candidates and can choose lower priority approved work`
with:

```ts
test("selectIssue automatic selection includes agent-ready when spec approval is required", () => {
  const selected = selectIssue(
    [issue(1, [ready, critical]), issue(2, [ready, high, "spec-approved"])],
    { readyLabel: ready, approvalPolicy: specApprovalPolicy() },
  );

  assert.equal(selected?.number, 1);
});
```

Add these tests after it:

```ts
test("selectIssue automatic selection includes spec-approved without agent-ready", () => {
  const selected = selectIssue(
    [issue(1, ["spec-approved", high]), issue(2, [ready, low])],
    { readyLabel: ready, approvalPolicy: specApprovalPolicy() },
  );

  assert.equal(selected?.number, 1);
});

test("selectIssue automatic selection includes plan-approved without agent-ready", () => {
  const policyWithPlan = createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required: true,
    },
  });

  const selected = selectIssue(
    [issue(1, ["plan-approved", high]), issue(2, [ready, low])],
    { readyLabel: ready, approvalPolicy: policyWithPlan },
  );

  assert.equal(selected?.number, 1);
});

test("selectIssue automatic selection ignores review-only workflow states", () => {
  const policyWithBoth = createWorkflowApprovalPolicy({
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
    },
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required: true,
    },
  });

  const selected = selectIssue(
    [issue(1, ["spec-review", critical]), issue(2, ["plan-review", high])],
    { readyLabel: ready, approvalPolicy: policyWithBoth },
  );

  assert.equal(selected, undefined);
});
```

Replace `selectIssue rejects explicit issue missing required spec approval`
with:

```ts
test("selectIssue rejects explicit issue waiting for spec approval", () => {
  assert.throws(
    () =>
      selectIssue([issue(5, ["spec-review"])], {
        readyLabel: ready,
        issueNumber: 5,
        approvalPolicy: specApprovalPolicy("spec-ok"),
      }),
    (error: unknown) => {
      assert(error instanceof ApprovalRequiredError);
      assert.equal(error.missingLabel, "spec-ok");
      return true;
    },
  );
});
```

Add:

```ts
test("selectIssue accepts explicit spec-approved issue without agent-ready", () => {
  const selected = selectIssue([issue(5, ["spec-approved"])], {
    readyLabel: ready,
    issueNumber: 5,
    approvalPolicy: specApprovalPolicy(),
  });

  assert.equal(selected?.number, 5);
});
```

- [ ] **Step 2: Run failing selection tests**

Run:

```bash
node --test src/cli/commands/run-once/selection.test.ts
```

Expected: FAIL because selection still only accepts `agent-ready` and still
filters by required spec approval.

- [ ] **Step 3: Update `selection.ts`**

In `src/cli/commands/run-once/selection.ts`, remove imports of
`assertExplicitIssueApprovals` and `issueMeetsAutomaticApprovals` from
`approval-gates.ts`. Import workflow helpers instead:

```ts
import {
  assertExplicitWorkflowState,
  isActionableWorkflowState,
  resolveWorkflowState,
} from "./workflow-state.ts";
```

In `isEligible()`, replace the body with:

```ts
function isEligible(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): boolean {
  if (issue.state !== "open") return false;
  if (blockingLabels(issue.labels, options.excludedLabels).length > 0) {
    return false;
  }

  return isActionableWorkflowState(
    resolveWorkflowState(issue.labels, {
      readyLabel: options.readyLabel,
      policy:
        options.approvalPolicy ??
        createWorkflowApprovalPolicy(DEFAULT_PATCHMILL_CONFIG.workflow),
    }),
  );
}
```

Add the missing import at the top:

```ts
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
```

In the explicit issue branch, replace the ready-label check and
`assertExplicitIssueApprovals()` call with:

```ts
assertExplicitWorkflowState(issue.labels, {
  readyLabel: resolved.readyLabel,
  policy:
    resolved.approvalPolicy ??
    createWorkflowApprovalPolicy(DEFAULT_PATCHMILL_CONFIG.workflow),
  issue,
});
```

Keep the existing blocking-label check before `assertExplicitWorkflowState()` so
in-progress/done/protection labels still fail before workflow-state validation.

- [ ] **Step 4: Run selection tests**

Run:

```bash
node --test src/cli/commands/run-once/selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/run-once/selection.ts src/cli/commands/run-once/selection.test.ts
git commit -m "feat(run-once): select actionable workflow states"
```

---

## Task 5: Wire spec stage and workflow transitions into the pipeline

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Test: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Add focused pipeline tests for the new transitions**

Add a new section near the existing plan-approval tests in
`src/cli/commands/run-once/pipeline.test.ts`.

Add this helper near existing local helpers if it does not already exist:

```ts
function specAndPlanApprovalPolicy() {
  return approvalPolicy({ specRequired: true, planRequired: true });
}
```

Add these concrete transition tests. Each mock runner handles the same host
commands used by adjacent plan-approval tests: issue listing, clean git status,
label listing, issue edits, comments, and Pi calls.

```ts
test("runOneIssue writes spec and stops at spec-review when spec approval is required", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(31, ["agent-ready", "enhancement"], "Needs spec");
  const expectedSpecPath = "docs/specs/2026-05-09-issue-31-needs-spec-design.md";
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create a design spec/);
      return {
        code: 0,
        stdout: `spec done
{"status":"spec-created","specPath":"${expectedSpecPath}","commit":"abc123"}`,
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "spec-created");
  assert.equal(result.specPath, expectedSpecPath);
  const editCalls = runner.calls.filter((call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit");
  const finalEdit = editCalls.at(-1);
  assert.ok(finalEdit);
  assert.equal(finalEdit.args[finalEdit.args.indexOf("--add-labels") + 1], "spec-review");
  assert.equal(finalEdit.args.includes("agent-ready"), false);
});

test("runOneIssue writes plan from spec-approved and cleans spec labels at plan-review", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(32, ["spec-review", "spec-approved", "enhancement"], "Needs plan");
  const specPath = "docs/specs/2026-05-09-issue-32-needs-plan-design.md";
  await writeFile(join(config.repoRoot, specPath), "# Spec
", "utf8");
  const expectedPlanPath = "docs/plans/2026-05-09-issue-32-needs-plan.md";
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create an implementation plan/);
      assert.match(prompt, new RegExp(specPath.replace(/[.*+?^${}()|[\]\]/g, "\\$&")));
      return {
        code: 0,
        stdout: `plan done
{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"def456"}`,
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, expectedPlanPath);
  const editCalls = runner.calls.filter((call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit");
  const finalEdit = editCalls.at(-1);
  assert.ok(finalEdit);
  assert.equal(finalEdit.args[finalEdit.args.indexOf("--add-labels") + 1], "plan-review");
  assert.equal(finalEdit.args.includes("spec-review"), false);
  assert.equal(finalEdit.args.includes("spec-approved"), false);
});
```

Update the existing test
`runOneIssue proceeds when plan approval label is present and clears plan-review`
so the selected issue includes all stale workflow labels:

```ts
const selected = issue(
  49,
  [
    "agent-ready",
    "spec-review",
    "spec-approved",
    "plan-review",
    "plan-approved",
    "bug",
  ],
  "Approved plan",
);
```

In the same test, extend `labelListPayload()` to include `spec-review` and
`spec-approved`, and replace the claim-call cleanup assertions with final
cleanup assertions:

```ts
const editCalls = runner.calls.filter(
  (call) =>
    call.command === "tea" &&
    call.args[0] === "issues" &&
    call.args[1] === "edit",
);
const finalEdit = editCalls.at(-1);
assert.ok(finalEdit);
assert.equal(finalEdit.args.includes("spec-review"), false);
assert.equal(finalEdit.args.includes("spec-approved"), false);
assert.equal(finalEdit.args.includes("plan-review"), false);
assert.equal(finalEdit.args.includes("plan-approved"), false);
```

Add one compact skipped-gate pipeline test for the plan-only approval path. This
exercises `agent-ready -> plan-review` and proves the first Pi call is spec
creation and the second Pi call is plan creation:

```ts
test("runOneIssue writes spec then plan and stops at plan-review when only plan approval is required", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: approvalPolicy({ specRequired: false, planRequired: true }),
  });
  const selected = issue(
    33,
    ["agent-ready", "enhancement"],
    "Needs spec and plan",
  );
  const expectedSpecPath =
    "docs/specs/2026-05-09-issue-33-needs-spec-and-plan-design.md";
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-33-needs-spec-and-plan.md";
  let piCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      piCalls += 1;
      if (piCalls === 1) {
        return {
          code: 0,
          stdout: `{"status":"spec-created","specPath":"${expectedSpecPath}","commit":"abc123"}`,
          stderr: "",
        };
      }
      return {
        code: 0,
        stdout: `{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"def456"}`,
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.specPath, expectedSpecPath);
  assert.equal(result.planPath, expectedPlanPath);
  assert.equal(piCalls, 2);
});
```

- [ ] **Step 2: Run the failing pipeline tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: FAIL because the pipeline does not create specs or use workflow-state
transitions yet.

- [ ] **Step 3: Import new helpers in `pipeline.ts`**

In `src/cli/commands/run-once/pipeline.ts`, add imports:

```ts
import { buildSpecPath, findIssueSpec } from "./specs.ts";
import {
  cleanupLabelsForImplementation,
  cleanupLabelsForPlanReview,
  cleanupLabelsForSpecReview,
  resolveWorkflowState,
} from "./workflow-state.ts";
import {
  buildImplementationPrompt,
  buildPlanCreationPrompt,
  buildSpecCreationPrompt,
} from "./prompts.ts";
```

Remove `approvedWorkflowReviewLabelsToRemove` from the approval-gates import
after the new cleanup helpers replace it.

- [ ] **Step 4: Add comments for spec review**

Near `planComment()` in `pipeline.ts`, add:

```ts
function specComment(specPath: string, created: boolean): string {
  return `${created ? "Spec ready" : "Existing spec ready"}: \`${specPath}\``;
}
```

- [ ] **Step 5: Resolve workflow state before claiming**

After lifecycle labels are loaded in `runOneIssue()`, add:

```ts
const workflowState = resolveWorkflowState(issue.labels, {
  readyLabel: ready,
  policy: config.approvalPolicy,
});
```

Replace the current `workflowReviewLabelsToRemove`/`labels` initialization with:

```ts
let labels = resumed
  ? issue.labels.includes(inProgress)
    ? issue.labels
    : nextLabels(issue.labels, [ready], [inProgress])
  : nextLabels(issue.labels, [ready], [inProgress]);
```

Do not remove `spec-approved` or `plan-approved` at claim time. Later gates need
the original labels and `workflowState` to decide what stage is being advanced.

- [ ] **Step 6: Add spec path resolution and creation before plan lookup**

Before the existing `let planPath` block in `pipeline.ts`, add:

```ts
let specPath: string | undefined;
let specCommit: string | undefined;
let specCreated = false;
let specCreatedThisRun = false;
```

Inside the `try` block, before existing plan lookup, insert a spec-resolution
section:

```ts
await progress(options, "info", "spec", "finding spec", {
  issueNumber: issue.number,
});
let savedSpecExists = false;
if (existingState?.specPath) {
  const savedSpecPath = repoPath(config.repoRoot, existingState.specPath);
  try {
    await access(savedSpecPath.absolute);
    specPath = savedSpecPath.relative;
    savedSpecExists = true;
    specCreated = existingState.checkpoints?.specCreated === true;
  } catch {
    specPath = undefined;
  }
}

const foundSpec = specPath
  ? undefined
  : await findIssueSpec(config.specsDir, issue.number);
specPath ??= foundSpec
  ? repoPath(config.repoRoot, foundSpec).relative
  : promptBodyPath(
      config.repoRoot,
      buildSpecPath(
        config.specsDir,
        issue.number,
        issue.title,
        options.now ?? new Date(),
      ),
    );
const hasExistingSpec = savedSpecExists || foundSpec !== undefined;
await writeRunState(
  config.runStateDir,
  {
    issueNumber: issue.number,
    status: "planning",
    specPath,
    checkpoints: {
      specPathResolved: true,
      ...(specCreated ? { specCreated: true } : {}),
    },
  },
  timestamp,
);
checkpoints.specPathResolved = true;
if (specCreated) checkpoints.specCreated = true;
```

- [ ] **Step 7: Create the spec when needed**

Immediately after spec path resolution, add:

```ts
const shouldCreateSpec = !hasExistingSpec;
if (shouldCreateSpec) {
  const specResult = await runStep("create spec", async () => {
    await progress(options, "info", "pi-spec", "creating spec with pi", {
      issueNumber: issue.number,
    });
    return await runPiPrompt(
      runner,
      config.repoRoot,
      buildSpecCreationPrompt({
        issue,
        specPath,
        projectPolicy: config.projectPolicy,
        specApprovalRequired: config.approvalPolicy.specApproval.required,
        skills: config.skills,
        triageLabels: { ready, needsInfo },
      }),
      {
        progress: options.progress,
        stage: "pi-plan",
        skillPaths: skillInvocationPaths(
          [config.skills.planning],
          config.repoRoot,
        ),
        streamOutput: options.streamPiOutput,
        issueNumber: issue.number,
        repoRoot: config.repoRoot,
        heartbeatMs: options.heartbeatMs,
        tokenUsageState,
        observeSession: true,
        verbosePiOutput: options.verbosePiOutput,
        onObservation: observePi("pi-plan"),
        taskContract: config.projectPolicy.pi.taskContract,
        piAgentDir,
      },
    );
  });
  if (specResult.status === "blocked") {
    return blockIssue(
      host,
      config,
      issue,
      labels,
      specResult,
      { specPath },
      timestamp,
      options,
    );
  }
  if (specResult.status !== "spec-created") {
    throw new Error(
      `Expected spec-created from Pi but received ${specResult.status}`,
    );
  }

  specPath = repoPath(config.repoRoot, specResult.specPath).relative;
  specCommit = specResult.commit;
  specCreated = true;
  specCreatedThisRun = true;
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      status: "planning",
      specPath,
      specCommit,
      checkpoints: { specCreated: true },
    },
    timestamp,
  );
  checkpoints.specCreated = true;
  if (specCommit) await emitSimpleStep(options, issue.number, "commit spec");
}
```

If TypeScript complains about `blockIssue()` details not accepting `specPath`,
update `blockIssue()` details type in the same file to include
`specPath?: string` and pass it through to run state where appropriate.

- [ ] **Step 8: Stop at spec-review when required**

After spec creation/reuse and before plan lookup, add:

```ts
const mustStopForSpecReview =
  config.approvalPolicy.specApproval.required &&
  workflowState.kind === "agent-ready" &&
  specCreatedThisRun;

if (mustStopForSpecReview) {
  const finalLabels = cleanupLabelsForSpecReview(labels, {
    readyLabel: ready,
    policy: config.approvalPolicy,
  });
  if (!checkpoints.specReadyCommentPosted) {
    await host.commentIssue(issue.number, specComment(specPath, specCreated));
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        specPath,
        specCommit,
        checkpoints: { specReadyCommentPosted: true },
      },
      timestamp,
    );
    checkpoints.specReadyCommentPosted = true;
  }
  await ensureAutomationLabel(
    host,
    config,
    config.approvalPolicy.specApproval.reviewLabel,
  );
  await host.applyLabels(planLabelChange(issue.number, labels, finalLabels));
  labels = finalLabels;
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      status: "finished",
      specPath,
      specCommit,
      checkpoints: { readyLabelRestored: true },
    },
    timestamp,
  );
  await emitSimpleStep(options, issue.number, "final result spec-created");
  return withLogPath(
    {
      status: specCreated ? "spec-created" : "spec-found",
      issue,
      specPath,
    },
    options,
  );
}
```

The name `readyLabelRestored` is no longer perfect, but keep it for
compatibility in this task. Rename checkpoints in a later cleanup only if
needed.

- [ ] **Step 9: Pass spec path into plan prompt and result objects**

In the existing `buildPlanCreationPrompt()` call, add:

```ts
specPath,
```

In every `writeRunState()` call after spec resolution where plan fields are
written, include `specPath` and `specCommit` when available.

In plan stop returns, change:

```ts
{
  status: planCreated ? "plan-created" : "plan-found",
  issue,
  specPath,
  planPath,
}
```

- [ ] **Step 10: Use cleanup helpers at plan-review and implementation**

In the plan gate block, replace `labelsToAdd`, `labelsToRemove`, and
`finalLabels` with:

```ts
const finalLabels =
  planGate.action === "stop-for-plan-review"
    ? cleanupLabelsForPlanReview(labels, {
        readyLabel: ready,
        policy: config.approvalPolicy,
      })
    : nextLabels(labels, [inProgress], [ready]);
```

For `stop-for-plan-review`, ensure the final labels also remove `inProgress`:

```ts
const finalLabels =
  planGate.action === "stop-for-plan-review"
    ? nextLabels(
        cleanupLabelsForPlanReview(labels, {
          readyLabel: ready,
          policy: config.approvalPolicy,
        }),
        [inProgress],
        [],
      )
    : nextLabels(labels, [inProgress], [ready]);
```

Before implementation starts, after the plan gate proceeds, update `labels`:

```ts
const implementationLabels = nextLabels(
  cleanupLabelsForImplementation(labels, {
    readyLabel: ready,
    policy: config.approvalPolicy,
  }),
  [],
  [inProgress],
);
if (implementationLabels.join("\0") !== labels.join("\0")) {
  await host.applyLabels(
    planLabelChange(issue.number, labels, implementationLabels),
  );
  labels = implementationLabels;
}
```

At final done label application, replace:

```ts
const doneLabels = nextLabels(labels, [inProgress], [done]);
```

with:

```ts
const doneLabels = nextLabels(
  cleanupLabelsForImplementation(labels, {
    readyLabel: ready,
    policy: config.approvalPolicy,
  }),
  [inProgress],
  [done],
);
```

- [ ] **Step 11: Run pipeline tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "feat(run-once): advance spec and plan workflow states"
```

---

## Task 6: Update CLI summaries, help, and documentation

**Files:**

- Modify: `src/cli/commands/run-once/main.ts`
- Modify: `src/cli/commands/run-once/args.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/issue-agent-workflows.md`
- Modify: `docs/skills.md`
- Test: `src/cli/commands/run-once/args.test.ts`, markdown lint

- [ ] **Step 1: Write failing summary/help tests**

In `src/cli/commands/run-once/args.test.ts`, add or update the summary test for
spec-created:

```ts
test("summarizeResult includes spec-created details", () => {
  assert.deepEqual(
    summarizeResult({
      status: "spec-created",
      issue: { number: 42, title: "Spec", body: "", labels: [], state: "open" },
      specPath: "docs/specs/spec.md",
      logPath: ".patchmill/runs/run.jsonl",
    }),
    {
      status: "spec-created",
      issueNumber: 42,
      specPath: "docs/specs/spec.md",
      logPath: ".patchmill/runs/run.jsonl",
    },
  );
});
```

Add an assertion to the existing help text test:

```ts
assert.match(
  HELP_TEXT,
  /Advance one actionable issue through spec, plan, or implementation/,
);
```

- [ ] **Step 2: Run failing summary tests**

Run:

```bash
node --test src/cli/commands/run-once/args.test.ts
```

Expected: FAIL because `summarizeResult()` and `HELP_TEXT` do not include
spec-created semantics yet.

- [ ] **Step 3: Update CLI JSON summary**

In `src/cli/commands/run-once/main.ts`, update `HELP_TEXT` first paragraph:

```ts
Advance one actionable issue through spec, plan, or implementation workflow states.
Claims and processes one eligible issue by default.
```

Update `JsonResult` union with:

```ts
| {
    status: "spec-created" | "spec-found";
    issueNumber: number;
    specPath: string;
  }
```

Update plan-created/plan-found JSON result to optionally include spec path:

```ts
| {
    status: "plan-created" | "plan-found";
    issueNumber: number;
    specPath?: string;
    planPath: string;
  }
```

Add cases in `summarizeResult()` before plan cases:

```ts
case "spec-created":
case "spec-found":
  return {
    status: result.status,
    issueNumber: result.issue.number,
    specPath: result.specPath,
    ...withLogPath,
  };
```

In the plan cases, include:

```ts
specPath: result.specPath,
```

- [ ] **Step 4: Update documentation text**

In `README.md`, replace the current `run-once` bullet with:

```md
- `patchmill run-once` is the one-issue production run. It advances one
  actionable issue through spec writing, plan writing, implementation, and any
  configured human approval stops.
```

In `docs/configuration.md`, replace the current workflow approval behavior
section with the four transition tables from
`docs/specs/2026-06-13-run-once-workflow-advancement-design.md`.

In `docs/issue-agent-workflows.md`, update the selection section to state:

```md
`patchmill run-once` processes one actionable issue. Actionable labels are the
configured ready label, the configured spec-approved label, and the configured
plan-approved label. Review labels without their approved counterparts are
waiting states and are ignored by automatic selection.
```

In `docs/skills.md`, update the run-once eligibility sentence so it no longer
says an issue is eligible only when it has the ready label. Use:

```md
For `patchmill run-once`, an issue is eligible when it is open, has no
protection/exclusion label, and carries an actionable workflow label:
`agent-ready`, `spec-approved`, or `plan-approved` by default.
```

- [ ] **Step 5: Run summary tests and markdown lint**

Run:

```bash
node --test src/cli/commands/run-once/args.test.ts
npm run lint:md
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/run-once/main.ts src/cli/commands/run-once/args.test.ts README.md docs/configuration.md docs/issue-agent-workflows.md docs/skills.md
git commit -m "docs(run-once): describe workflow advancement states"
```

---

## Task 7: Full verification and cleanup

**Files:**

- Modify only files needed to fix failures found by verification.
- Test: full run-once suite, full test suite, lint, build.

- [ ] **Step 1: Run the full run-once suite**

Run:

```bash
npm run test:run-once
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected:

- `git diff --check` prints nothing.
- Only intentional source, test, and documentation files are changed.

- [ ] **Step 6: Commit final fixes if needed**

If Step 1-5 required any fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix(run-once): complete workflow advancement integration"
```

If no fixes were needed and the previous task commits already contain all
changes, skip this commit.

---

## Self-review checklist

Spec coverage:

- `agent-ready`, `spec-approved`, and `plan-approved` are actionable: Task 1 and
  Task 4.
- `spec-review` and `plan-review` are waiting states: Task 1 and Task 4.
- Spec before plan before implementation: Task 3 and Task 5.
- Approval-gate transition tables: Task 5.
- Tolerate both review and approved labels: Task 1 and Task 4.
- Cleanup stale `spec-*` and `plan-*` labels: Task 1 and Task 5.
- Dry-run/summary/docs reflect state-machine semantics: Task 6.
- Tests cover selection, pipeline transitions, cleanup, and docs-adjacent
  behavior: Tasks 1-7.

Placeholder scan:

- The two Task 5 skipped-gate tests contain explicit instructions to replace
  setup comments with concrete mock code before committing. Do not commit those
  comments in test code.
- No production code step uses deferred-work markers or undefined function
  names.

Type consistency:

- `specPath` and `specCommit` are used consistently across Pi results, run
  state, prompts, pipeline results, and CLI summaries.
- `spec-created` mirrors existing `plan-created` naming.
- `workflow-state.ts` owns label-state decisions; `pipeline.ts` orchestrates
  side effects.
