# Configurable Specification and Plan Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repository-configurable specification and plan approval gates that
block `run-once` until required workflow approval labels are present.

**Architecture:** Introduce a workflow-owned approval policy model, keep triage
labels separate from workflow labels, and route `run-once` decisions through a
small approval-gates module. Configuration loading preserves compatibility with
`projectPolicy.planRequiresApproval`, while the pipeline consumes normalized
approval decisions for selection, plan-review stops, and approved-plan resume.

**Tech Stack:** TypeScript, Node test runner, Patchmill CLI run-once pipeline,
Forgejo/Gitea `tea` and GitHub `gh` host abstractions, Markdown docs.

---

## File structure

- Modify `src/config/types.ts` to add top-level workflow approval config types.
- Modify `src/config/defaults.ts` and `src/config/defaults.test.ts` to expose
  default workflow approval label names.
- Modify `src/config/load.ts` and `src/config/load.test.ts` to parse and merge
  `workflow.specApproval` and `workflow.planApproval` without losing default
  labels.
- Create `src/workflow/approval-policy.ts` and
  `src/workflow/approval-policy.test.ts` for normalized approval policy,
  compatibility alias resolution, and workflow label definitions.
- Modify `src/cli/commands/triage/labels.ts` and
  `src/cli/commands/triage/labels.test.ts` so label checks can aggregate triage
  labels plus workflow approval labels without adding approval labels to flat
  triage policy.
- Modify `src/cli/commands/labels/setup.ts` and
  `src/cli/commands/labels/setup.test.ts` to accept extra required label
  definitions.
- Modify `src/cli/commands/init/main.ts`, `src/cli/commands/init/main.test.ts`,
  `src/cli/commands/doctor/main.ts`, and `src/cli/commands/doctor/checks.ts` so
  init/doctor create or validate the combined label set.
- Modify `src/cli/commands/run-once/types.ts` for the approval policy config
  field and the `approval-required` pipeline result.
- Modify `src/cli/commands/run-once/args.ts`,
  `src/cli/commands/run-once/args.test.ts`, and
  `src/cli/commands/run-once/main.ts` to wire normalized approval policy into
  CLI config and JSON summaries.
- Create `src/cli/commands/run-once/approval-gates.ts` and
  `src/cli/commands/run-once/approval-gates.test.ts` for spec selection checks,
  explicit approval-required errors, plan-review stop decisions, and review
  label cleanup decisions.
- Modify `src/cli/commands/run-once/selection.ts` and
  `src/cli/commands/run-once/selection.test.ts` so automatic selection skips
  spec-unapproved candidates while explicit selection fails with a typed
  approval-required error.
- Modify `src/cli/commands/run-once/pipeline.ts` and
  `src/cli/commands/run-once/pipeline.test.ts` to use approval-gate decisions
  for spec approval, plan approval stops, plan-review labeling, ready
  restoration, and approved-plan resume.
- Modify `docs/configuration.md` and `docs/issue-agent-workflows.md` for the new
  workflow config and run-once approval states.

## Task 1: Add workflow approval config loading

**Files:**

- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/defaults.test.ts`
- Modify: `src/config/load.ts`
- Modify: `src/config/load.test.ts`

- [ ] **Step 1: Write failing default config tests**

Add workflow expectations to `src/config/defaults.test.ts` inside
`defaults match the current patchmill baseline configuration`:

```ts
assert.deepEqual(DEFAULT_PATCHMILL_CONFIG.workflow, {
  specApproval: {
    reviewLabel: "spec-review",
    approvedLabel: "spec-approved",
  },
  planApproval: {
    reviewLabel: "plan-review",
    approvedLabel: "plan-approved",
  },
});
```

Also add the same `workflow` object to the large `assert.deepEqual` literal in
that test:

```ts
workflow: {
  specApproval: {
    reviewLabel: "spec-review",
    approvedLabel: "spec-approved",
  },
  planApproval: {
    reviewLabel: "plan-review",
    approvedLabel: "plan-approved",
  },
},
```

- [ ] **Step 2: Write failing workflow load tests**

Add these tests near the other `loadPatchmillConfig` parser tests in
`src/config/load.test.ts`:

```ts
test("loadPatchmillConfig parses workflow approval config and preserves default labels", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-workflow-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      workflow: {
        specApproval: { required: true },
        planApproval: {
          reviewLabel: "awaiting-plan-review",
          approvedLabel: "plan-reviewed",
        },
      },
    }),
    "utf8",
  );

  const config = await loadPatchmillConfig(repoRoot, {}, []);

  assert.deepEqual(config.workflow, {
    specApproval: {
      required: true,
      reviewLabel: "spec-review",
      approvedLabel: "spec-approved",
    },
    planApproval: {
      reviewLabel: "awaiting-plan-review",
      approvedLabel: "plan-reviewed",
    },
  });
});

test("loadPatchmillConfig rejects invalid workflow approval config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-workflow-invalid-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      workflow: {
        planApproval: { required: "yes" },
      },
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadPatchmillConfig(repoRoot, {}, []),
    /workflow\.planApproval\.required must be a boolean/,
  );
});
```

- [ ] **Step 3: Run the failing config tests**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts
```

Expected: failures report that `workflow` is missing from
`DEFAULT_PATCHMILL_CONFIG` and parser output.

- [ ] **Step 4: Add workflow config types**

In `src/config/types.ts`, add these types after `PatchmillTriageConfig` and add
`workflow` to `PatchmillConfig`:

```ts
export type PatchmillWorkflowApprovalConfig = {
  required?: boolean;
  reviewLabel: string;
  approvedLabel: string;
};

export type PatchmillWorkflowConfig = {
  specApproval: PatchmillWorkflowApprovalConfig;
  planApproval: PatchmillWorkflowApprovalConfig;
};
```

Update `PatchmillConfig`:

```ts
export type PatchmillConfig = {
  host: PatchmillHostConfig;
  pi: PatchmillPiConfig;
  labels: PatchmillLabelsConfig;
  triage: PatchmillTriageConfig;
  workflow: PatchmillWorkflowConfig;
  skills: PatchmillSkillsConfig;
  paths: PatchmillPathsConfig;
  git: PatchmillGitConfig;
  cleanupHook?: string;
  projectPolicy: PatchmillProjectPolicyConfig;
};
```

- [ ] **Step 5: Add default workflow config**

In `src/config/defaults.ts`, add a constant after `DEFAULT_PATCHMILL_LABELS`:

```ts
const DEFAULT_PATCHMILL_WORKFLOW = {
  specApproval: {
    reviewLabel: "spec-review",
    approvedLabel: "spec-approved",
  },
  planApproval: {
    reviewLabel: "plan-review",
    approvedLabel: "plan-approved",
  },
};
```

Then add it to `DEFAULT_PATCHMILL_CONFIG` after `triage`:

```ts
workflow: DEFAULT_PATCHMILL_WORKFLOW,
```

- [ ] **Step 6: Implement workflow config cloning and merging**

In `src/config/load.ts`, add these type aliases below `PartialProjectPolicy`:

```ts
type PartialWorkflowApprovalConfig = Partial<
  PatchmillConfig["workflow"]["specApproval"]
>;

type PartialWorkflowConfig = Partial<{
  specApproval: PartialWorkflowApprovalConfig;
  planApproval: PartialWorkflowApprovalConfig;
}>;
```

Add `workflow` to `PartialConfig`:

```ts
workflow: PartialWorkflowConfig;
```

Add these helpers near the other clone and merge helpers:

```ts
function cloneWorkflowApprovalConfig(
  approval: PatchmillConfig["workflow"]["specApproval"],
): PatchmillConfig["workflow"]["specApproval"] {
  return {
    ...(approval.required !== undefined ? { required: approval.required } : {}),
    reviewLabel: approval.reviewLabel,
    approvedLabel: approval.approvedLabel,
  };
}

function mergeWorkflowApprovalConfig(
  base: PatchmillConfig["workflow"]["specApproval"],
  update: PartialWorkflowApprovalConfig | undefined,
): PatchmillConfig["workflow"]["specApproval"] {
  return {
    ...(update?.required !== undefined
      ? { required: update.required }
      : base.required !== undefined
        ? { required: base.required }
        : {}),
    reviewLabel: update?.reviewLabel ?? base.reviewLabel,
    approvedLabel: update?.approvedLabel ?? base.approvedLabel,
  };
}

function cloneWorkflowConfig(
  workflow: PatchmillConfig["workflow"],
): PatchmillConfig["workflow"] {
  return {
    specApproval: cloneWorkflowApprovalConfig(workflow.specApproval),
    planApproval: cloneWorkflowApprovalConfig(workflow.planApproval),
  };
}

function mergeWorkflowConfig(
  base: PatchmillConfig["workflow"],
  update: PartialWorkflowConfig | undefined,
): PatchmillConfig["workflow"] {
  return {
    specApproval: mergeWorkflowApprovalConfig(
      base.specApproval,
      update?.specApproval,
    ),
    planApproval: mergeWorkflowApprovalConfig(
      base.planApproval,
      update?.planApproval,
    ),
  };
}
```

In `mergeConfig`, include:

```ts
workflow: mergeWorkflowConfig(base.workflow, update.workflow),
```

In `absolutizePaths`, include a clone:

```ts
workflow: cloneWorkflowConfig(config.workflow),
```

- [ ] **Step 7: Implement workflow config parsing**

In `src/config/load.ts`, add this helper near `readTriageConfig`:

```ts
function readWorkflowApprovalConfig(
  source: Record<string, unknown>,
  key: "specApproval" | "planApproval",
): PartialWorkflowApprovalConfig | undefined {
  const value = readOptionalSection(source, key);
  if (!value) return undefined;

  const parsed: PartialWorkflowApprovalConfig = {};
  const required = readOptionalBoolean(
    value,
    "required",
    `workflow.${key}.required`,
  );
  const reviewLabel = readOptionalString(
    value,
    "reviewLabel",
    `workflow.${key}.reviewLabel`,
  );
  const approvedLabel = readOptionalString(
    value,
    "approvedLabel",
    `workflow.${key}.approvedLabel`,
  );

  if (required !== undefined) parsed.required = required;
  if (reviewLabel !== undefined) parsed.reviewLabel = reviewLabel;
  if (approvedLabel !== undefined) parsed.approvedLabel = approvedLabel;

  for (const entry of Object.keys(value)) {
    if (!["required", "reviewLabel", "approvedLabel"].includes(entry)) {
      throw configError(
        `workflow.${key}.${entry}`,
        "a supported workflow approval setting",
        value[entry],
      );
    }
  }

  return hasEntries(parsed) ? parsed : undefined;
}

function readWorkflowConfig(
  source: Record<string, unknown>,
): PartialWorkflowConfig | undefined {
  const value = source.workflow;
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw configError("workflow", "an object", value);

  const parsed: PartialWorkflowConfig = {};
  const specApproval = readWorkflowApprovalConfig(value, "specApproval");
  const planApproval = readWorkflowApprovalConfig(value, "planApproval");
  if (specApproval !== undefined) parsed.specApproval = specApproval;
  if (planApproval !== undefined) parsed.planApproval = planApproval;

  for (const entry of Object.keys(value)) {
    if (!["specApproval", "planApproval"].includes(entry)) {
      throw configError(
        `workflow.${entry}`,
        "a supported workflow setting",
        value[entry],
      );
    }
  }

  return hasEntries(parsed) ? parsed : undefined;
}
```

Call it in `parseConfigFile` after `readTriageConfig(data)`:

```ts
const workflow = readWorkflowConfig(data);
if (workflow !== undefined) {
  config.workflow = workflow;
}
```

- [ ] **Step 8: Run config tests and commit**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts
npm run lint:ts
```

Expected: config tests pass and TypeScript lint reports no errors.

Commit:

```bash
git add src/config/types.ts src/config/defaults.ts src/config/defaults.test.ts src/config/load.ts src/config/load.test.ts
git commit -m "feat(config): add workflow approval config"
```

## Task 2: Normalize approval policy and aggregate workflow labels

**Files:**

- Create: `src/workflow/approval-policy.ts`
- Create: `src/workflow/approval-policy.test.ts`
- Modify: `src/cli/commands/triage/labels.ts`
- Modify: `src/cli/commands/triage/labels.test.ts`
- Modify: `src/cli/commands/labels/setup.ts`
- Modify: `src/cli/commands/labels/setup.test.ts`
- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main.test.ts`
- Modify: `src/cli/commands/doctor/main.ts`
- Modify: `src/cli/commands/doctor/checks.ts`

- [ ] **Step 1: Write failing approval-policy tests**

Create `src/workflow/approval-policy.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../config/defaults.ts";
import { createTriagePolicy } from "../policy/triage.ts";
import { createWorkflowApprovalPolicy } from "./approval-policy.ts";

const projectPolicy = DEFAULT_PATCHMILL_CONFIG.projectPolicy;

test("createWorkflowApprovalPolicy defaults both gates to not required", () => {
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    { ...projectPolicy, planRequiresApproval: false },
  );

  assert.equal(policy.specApproval.required, false);
  assert.equal(policy.specApproval.reviewLabel, "spec-review");
  assert.equal(policy.specApproval.approvedLabel, "spec-approved");
  assert.equal(policy.planApproval.required, false);
  assert.equal(policy.planApproval.reviewLabel, "plan-review");
  assert.equal(policy.planApproval.approvedLabel, "plan-approved");
});

test("createWorkflowApprovalPolicy treats projectPolicy.planRequiresApproval as plan alias", () => {
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    { ...projectPolicy, planRequiresApproval: true },
  );

  assert.equal(policy.planApproval.required, true);
});

test("createWorkflowApprovalPolicy lets workflow.planApproval.required override the alias", () => {
  const policy = createWorkflowApprovalPolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.workflow,
      planApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
        required: false,
      },
    },
    { ...projectPolicy, planRequiresApproval: true },
  );

  assert.equal(policy.planApproval.required, false);
});

test("createWorkflowApprovalPolicy exposes workflow label definitions outside triage labels", () => {
  const triagePolicy = createTriagePolicy(
    DEFAULT_PATCHMILL_CONFIG.labels,
    DEFAULT_PATCHMILL_CONFIG.triage,
  );
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    projectPolicy,
  );

  assert.deepEqual(
    policy.labelDefinitions.map((label) => label.name),
    ["spec-review", "spec-approved", "plan-review", "plan-approved"],
  );
  assert.equal(
    triagePolicy.allowedLabels.some((label) => label.name === "spec-review"),
    false,
  );
});
```

- [ ] **Step 2: Write failing label aggregation tests**

In `src/cli/commands/triage/labels.test.ts`, add:

```ts
test("missingLabelDefinitions can include workflow approval labels", () => {
  const workflowLabels = [
    {
      name: "spec-review",
      color: "#5319e7",
      description: "Awaiting specification review",
    },
    {
      name: "spec-approved",
      color: "#0e8a16",
      description: "Specification approved for automation",
    },
  ];

  const missing = missingLabelDefinitions(
    [ready, "bug"],
    undefined,
    workflowLabels,
  );

  assert.ok(missing.some((label) => label.name === "needs-info"));
  assert.ok(missing.some((label) => label.name === "spec-review"));
  assert.ok(missing.some((label) => label.name === "spec-approved"));
});
```

In `src/cli/commands/labels/setup.test.ts`, add:

```ts
test("ensureRequiredLabels creates extra workflow labels with triage labels", async () => {
  const { host, created } = fakeHost({ existingLabels: requiredLabelNames });

  const result = await ensureRequiredLabels({
    host,
    policy,
    extraLabels: [
      {
        name: "plan-review",
        color: "#5319e7",
        description: "Awaiting implementation plan review",
      },
    ],
    isInteractive: false,
    assumeYes: true,
    command: "doctor",
  });

  assert.equal(result.status, "created");
  assert.deepEqual(created, ["plan-review"]);
});
```

- [ ] **Step 3: Run the failing policy and label tests**

Run:

```bash
node --test src/workflow/approval-policy.test.ts src/cli/commands/triage/labels.test.ts src/cli/commands/labels/setup.test.ts
```

Expected: failures report the missing approval-policy module and missing
`extraLabels` support.

- [ ] **Step 4: Implement normalized approval policy**

Create `src/workflow/approval-policy.ts`:

```ts
import type { PatchmillWorkflowConfig } from "../config/types.ts";
import type { LabelDefinition } from "../host/types.ts";
import type { PatchmillProjectPolicy } from "../policy/types.ts";

export type WorkflowApprovalKind = "spec" | "plan";

export type WorkflowApprovalStagePolicy = {
  kind: WorkflowApprovalKind;
  required: boolean;
  reviewLabel: string;
  approvedLabel: string;
};

export type WorkflowApprovalPolicy = {
  specApproval: WorkflowApprovalStagePolicy;
  planApproval: WorkflowApprovalStagePolicy;
  labelDefinitions: LabelDefinition[];
};

function workflowLabelDefinition(
  name: string,
  color: string,
  description: string,
): LabelDefinition {
  return { name, color, description };
}

function dedupeLabelDefinitions(labels: LabelDefinition[]): LabelDefinition[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

export function createWorkflowApprovalPolicy(
  workflow: PatchmillWorkflowConfig,
  projectPolicy: Pick<PatchmillProjectPolicy, "planRequiresApproval">,
): WorkflowApprovalPolicy {
  const specApproval: WorkflowApprovalStagePolicy = {
    kind: "spec",
    required: workflow.specApproval.required ?? false,
    reviewLabel: workflow.specApproval.reviewLabel,
    approvedLabel: workflow.specApproval.approvedLabel,
  };
  const planApproval: WorkflowApprovalStagePolicy = {
    kind: "plan",
    required:
      workflow.planApproval.required ?? projectPolicy.planRequiresApproval,
    reviewLabel: workflow.planApproval.reviewLabel,
    approvedLabel: workflow.planApproval.approvedLabel,
  };

  return {
    specApproval,
    planApproval,
    labelDefinitions: dedupeLabelDefinitions([
      workflowLabelDefinition(
        specApproval.reviewLabel,
        "#5319e7",
        "Awaiting specification review",
      ),
      workflowLabelDefinition(
        specApproval.approvedLabel,
        "#0e8a16",
        "Specification approved for automation",
      ),
      workflowLabelDefinition(
        planApproval.reviewLabel,
        "#5319e7",
        "Awaiting implementation plan review",
      ),
      workflowLabelDefinition(
        planApproval.approvedLabel,
        "#0e8a16",
        "Implementation plan approved for automation",
      ),
    ]),
  };
}
```

- [ ] **Step 5: Add extra label aggregation**

In `src/cli/commands/triage/labels.ts`, change `missingLabelDefinitions` to
accept extra definitions:

```ts
function dedupeLabelDefinitions(labels: LabelDefinition[]): LabelDefinition[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

export function missingLabelDefinitions(
  existingNames: string[],
  triagePolicy = DEFAULT_TRIAGE_POLICY,
  extraLabels: readonly LabelDefinition[] = [],
): LabelDefinition[] {
  const existing = new Set(existingNames);
  return dedupeLabelDefinitions([
    ...triagePolicy.allowedLabels,
    ...extraLabels,
  ]).filter((label) => !existing.has(label.name));
}
```

In `src/cli/commands/labels/setup.ts`, add `extraLabels` to options:

```ts
export type LabelSetupOptions = {
  host: IssueHostProvider;
  policy: PatchmillTriagePolicy;
  extraLabels?: readonly LabelDefinition[];
  prompt?: (question: string) => Promise<string>;
  isInteractive: boolean;
  assumeYes: boolean;
  command: "init" | "doctor";
};
```

Pass it into `missingLabelDefinitions`:

```ts
const missing = missingLabelDefinitions(
  await options.host.listLabels(),
  options.policy,
  options.extraLabels,
);
```

- [ ] **Step 6: Wire label setup and doctor to workflow labels**

In `src/cli/commands/init/main.ts`, import `createWorkflowApprovalPolicy` and
build extra labels from `result.config`:

```ts
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
```

Replace the label policy block with:

```ts
const policy = createTriagePolicy(result.config.labels, result.config.triage);
const approvalPolicy = createWorkflowApprovalPolicy(
  result.config.workflow,
  result.config.projectPolicy,
);
const labelSetup = await (options.setupLabels ?? ensureRequiredLabels)({
  host,
  policy,
  extraLabels: approvalPolicy.labelDefinitions,
  prompt: options.prompt ?? defaultPrompt,
  isInteractive,
  assumeYes: config.yes,
  command: "init",
});
```

In `src/cli/commands/doctor/main.ts`, import `createWorkflowApprovalPolicy` and
pass extra labels to `ensureRequiredLabels`:

```ts
const policy = createTriagePolicy(loaded.config.labels, loaded.config.triage);
const approvalPolicy = createWorkflowApprovalPolicy(
  loaded.config.workflow,
  loaded.config.projectPolicy,
);
const result = await ensureRequiredLabels({
  host,
  policy,
  extraLabels: approvalPolicy.labelDefinitions,
  prompt: promptLine,
  isInteractive,
  assumeYes: args.yes,
  command: "doctor",
});
```

In `src/cli/commands/doctor/checks.ts`, import `createWorkflowApprovalPolicy`,
compute it before the label check, and pass its label definitions to
`missingLabelDefinitions`:

```ts
const policy = createTriagePolicy(config.labels, config.triage);
const approvalPolicy = createWorkflowApprovalPolicy(
  config.workflow,
  config.projectPolicy,
);
const allLabelDefinitions = [
  ...policy.allowedLabels,
  ...approvalPolicy.labelDefinitions,
];
const missing = missingLabelDefinitions(
  await host.listLabels(),
  policy,
  approvalPolicy.labelDefinitions,
);
if (missing.length === 0) {
  results.push(
    pass("labels", allLabelDefinitions.map((label) => label.name).join(", ")),
  );
} else {
  results.push(
    fail("labels", `missing ${missing.map((label) => label.name).join(", ")}`, [
      "Patchmill doctor is read-only and did not create labels.",
      "",
      "Run the approved repair flow:",
      "  patchmill doctor --fix",
      "",
      "You can edit label names in patchmill.config.json before running --fix.",
    ]),
  );
}
```

- [ ] **Step 7: Update affected label setup expectations**

In `src/cli/commands/labels/setup.test.ts`, keep tests that use no `extraLabels`
unchanged. In init and doctor tests where mock `setupLabels` or label messages
assert the options shape, add assertions that
`extraLabels.map((label) => label.name)` equals:

```ts
["spec-review", "spec-approved", "plan-review", "plan-approved"];
```

When a test uses full default label counts after calling the real
`ensureRequiredLabels` with extra labels, update the expected count from `15` to
`19` and assert the four workflow names are present.

- [ ] **Step 8: Run policy and label tests, then commit**

Run:

```bash
node --test src/workflow/approval-policy.test.ts src/cli/commands/triage/labels.test.ts src/cli/commands/labels/setup.test.ts src/cli/commands/init/main.test.ts src/cli/commands/doctor/main.test.ts src/cli/commands/doctor/checks.test.ts
npm run lint:ts
```

Expected: all listed tests pass and TypeScript lint reports no errors.

Commit:

```bash
git add src/workflow/approval-policy.ts src/workflow/approval-policy.test.ts src/cli/commands/triage/labels.ts src/cli/commands/triage/labels.test.ts src/cli/commands/labels/setup.ts src/cli/commands/labels/setup.test.ts src/cli/commands/init/main.ts src/cli/commands/init/main.test.ts src/cli/commands/doctor/main.ts src/cli/commands/doctor/checks.ts
git commit -m "feat(workflow): normalize approval policy labels"
```

## Task 3: Wire approval policy through run-once CLI config

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/args.ts`
- Modify: `src/cli/commands/run-once/args.test.ts`
- Modify: `src/cli/commands/run-once/main.ts`

- [ ] **Step 1: Write failing run-once config and summary tests**

In `src/cli/commands/run-once/args.test.ts`, replace the default
`requirePlanApproval` expectation in
`parseArgs executes by default when no args are provided` with:

```ts
assert.equal(config.approvalPolicy.specApproval.required, false);
assert.equal(config.approvalPolicy.planApproval.required, false);
assert.equal(config.approvalPolicy.planApproval.approvedLabel, "plan-approved");
```

Add this test near the existing `loadCliConfig` tests:

```ts
test("loadCliConfig resolves workflow plan approval ahead of legacy project policy", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-run-once-approval-"),
  );
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      workflow: {
        specApproval: { required: true, approvedLabel: "spec-ok" },
        planApproval: { required: false, approvedLabel: "plan-ok" },
      },
      projectPolicy: { planRequiresApproval: true },
    }),
    "utf8",
  );

  const config = await loadCliConfig(["--dry-run"], repoRoot, {});

  assert.equal(config.approvalPolicy.specApproval.required, true);
  assert.equal(config.approvalPolicy.specApproval.approvedLabel, "spec-ok");
  assert.equal(config.approvalPolicy.planApproval.required, false);
  assert.equal(config.approvalPolicy.planApproval.approvedLabel, "plan-ok");
});
```

Add a `summarizeResult` test:

```ts
test("summarizeResult includes approval-required details", () => {
  assert.deepEqual(
    summarizeResult({
      status: "approval-required",
      issue: {
        number: 42,
        title: "Needs spec approval",
        body: "Body",
        labels: ["agent-ready"],
        state: "open",
      },
      approvalKind: "spec",
      missingLabel: "spec-approved",
      logPath: ".patchmill/runs/run.jsonl",
    }),
    {
      status: "approval-required",
      issueNumber: 42,
      approvalKind: "spec",
      missingLabel: "spec-approved",
      logPath: ".patchmill/runs/run.jsonl",
    },
  );
});
```

- [ ] **Step 2: Run the failing run-once args tests**

Run:

```bash
node --test src/cli/commands/run-once/args.test.ts
```

Expected: failures report missing `approvalPolicy` and missing
`approval-required` summary support.

- [ ] **Step 3: Update run-once types**

In `src/cli/commands/run-once/types.ts`, import `WorkflowApprovalPolicy`:

```ts
import type { WorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
```

Replace `requirePlanApproval: boolean;` in `AgentIssueConfig` with:

```ts
approvalPolicy: WorkflowApprovalPolicy;
```

Add this result type after `AgentIssuePlanCreatedResult`:

```ts
export type AgentIssueApprovalRequiredResult = {
  status: "approval-required";
  issue: IssueSummary;
  approvalKind: "spec" | "plan";
  missingLabel: string;
};
```

Add it to `AgentIssuePipelineResult` before the `blocked` case:

```ts
| AgentIssueApprovalRequiredResult
```

- [ ] **Step 4: Build approval policy in parseArgs**

In `src/cli/commands/run-once/args.ts`, import the approval policy factory:

```ts
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
```

In `parseArgs`, compute the policy after `projectPolicy`:

```ts
const approvalPolicy = createWorkflowApprovalPolicy(
  patchmillConfig.workflow,
  projectPolicy,
);
```

Replace `requirePlanApproval: projectPolicy.planRequiresApproval,` with:

```ts
approvalPolicy,
```

- [ ] **Step 5: Summarize approval-required JSON**

In `src/cli/commands/run-once/main.ts`, add the JSON result variant:

```ts
| {
    status: "approval-required";
    issueNumber: number;
    approvalKind: "spec" | "plan";
    missingLabel: string;
  }
```

In `summarizeResult`, add this case before `blocked`:

```ts
case "approval-required":
  return {
    status: result.status,
    issueNumber: result.issue.number,
    approvalKind: result.approvalKind,
    missingLabel: result.missingLabel,
    ...withLogPath,
  };
```

In `main`, make approval-required a non-zero completion like blocked:

```ts
return result.status === "blocked" || result.status === "approval-required"
  ? 1
  : 0;
```

- [ ] **Step 6: Update run-once tests that construct configs**

In `src/cli/commands/run-once/pipeline.test.ts`, import
`createWorkflowApprovalPolicy` and update `makeConfig` to set `approvalPolicy`:

```ts
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
```

Inside `makeConfig`, replace `requirePlanApproval: false,` with:

```ts
approvalPolicy: createWorkflowApprovalPolicy(
  DEFAULT_PATCHMILL_CONFIG.workflow,
  DEFAULT_PATCHMILL_POLICY,
),
```

For tests that currently pass `{ requirePlanApproval: true }`, replace the
override with:

```ts
approvalPolicy: createWorkflowApprovalPolicy(
  {
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required: true,
    },
  },
  DEFAULT_PATCHMILL_POLICY,
),
```

- [ ] **Step 7: Run run-once args tests and commit**

Run:

```bash
node --test src/cli/commands/run-once/args.test.ts src/cli/commands/run-once/pipeline.test.ts --test-name-pattern="plan approval|required|parseArgs|loadCliConfig|summarizeResult"
npm run lint:ts
```

Expected: focused run-once tests pass and TypeScript lint reports no errors.

Commit:

```bash
git add src/cli/commands/run-once/types.ts src/cli/commands/run-once/args.ts src/cli/commands/run-once/args.test.ts src/cli/commands/run-once/main.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "feat(run-once): pass approval policy through config"
```

## Task 4: Add spec approval selection gates

**Files:**

- Create: `src/cli/commands/run-once/approval-gates.ts`
- Create: `src/cli/commands/run-once/approval-gates.test.ts`
- Modify: `src/cli/commands/run-once/selection.ts`
- Modify: `src/cli/commands/run-once/selection.test.ts`

- [ ] **Step 1: Write failing approval-gates tests for spec approval**

Create `src/cli/commands/run-once/approval-gates.test.ts` with these initial
tests:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import {
  ApprovalRequiredError,
  assertExplicitIssueApprovals,
  issueMeetsAutomaticApprovals,
} from "./approval-gates.ts";
import type { IssueSummary } from "./types.ts";

function approvalPolicy(overrides = {}) {
  return createWorkflowApprovalPolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.workflow,
      specApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
        required: true,
        ...overrides,
      },
    },
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
  );
}

function issue(labels: string[]): IssueSummary {
  return { number: 7, title: "Issue", body: "Body", labels, state: "open" };
}

test("issueMeetsAutomaticApprovals accepts missing spec approval when the gate is disabled", () => {
  const policy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
  );

  assert.equal(
    issueMeetsAutomaticApprovals(issue(["agent-ready"]), policy),
    true,
  );
});

test("issueMeetsAutomaticApprovals filters missing spec approval when required", () => {
  const policy = approvalPolicy();

  assert.equal(
    issueMeetsAutomaticApprovals(issue(["agent-ready"]), policy),
    false,
  );
  assert.equal(
    issueMeetsAutomaticApprovals(
      issue(["agent-ready", "spec-approved"]),
      policy,
    ),
    true,
  );
});

test("assertExplicitIssueApprovals throws a typed missing-spec approval error", () => {
  const policy = approvalPolicy({ approvedLabel: "spec-ok" });

  assert.throws(
    () => assertExplicitIssueApprovals(issue(["agent-ready"]), policy),
    (error: unknown) => {
      assert(error instanceof ApprovalRequiredError);
      assert.equal(error.approvalKind, "spec");
      assert.equal(error.missingLabel, "spec-ok");
      assert.equal(error.issue.number, 7);
      return true;
    },
  );
});
```

- [ ] **Step 2: Write failing selection tests**

In `src/cli/commands/run-once/selection.test.ts`, import
`createWorkflowApprovalPolicy` and add:

```ts
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { ApprovalRequiredError } from "./approval-gates.ts";
```

Add helper:

```ts
function specApprovalPolicy(approvedLabel = "spec-approved") {
  return createWorkflowApprovalPolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.workflow,
      specApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
        required: true,
        approvedLabel,
      },
    },
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
  );
}
```

Add tests:

```ts
test("selectIssue skips spec-unapproved automatic candidates and can choose lower priority approved work", () => {
  const selected = selectIssue(
    [issue(1, [ready, critical]), issue(2, [ready, high, "spec-approved"])],
    { readyLabel: ready, approvalPolicy: specApprovalPolicy() },
  );

  assert.equal(selected?.number, 2);
});

test("selectIssue rejects explicit issue missing required spec approval", () => {
  assert.throws(
    () =>
      selectIssue([issue(5, [ready])], {
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

- [ ] **Step 3: Run the failing gate and selection tests**

Run:

```bash
node --test src/cli/commands/run-once/approval-gates.test.ts src/cli/commands/run-once/selection.test.ts
```

Expected: failures report the missing approval-gates module and unsupported
`approvalPolicy` selection option.

- [ ] **Step 4: Implement spec approval helpers**

Create `src/cli/commands/run-once/approval-gates.ts`:

```ts
import type { WorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import type { IssueSummary } from "./types.ts";

export class ApprovalRequiredError extends Error {
  readonly name = "ApprovalRequiredError";

  constructor(
    readonly issue: IssueSummary,
    readonly approvalKind: "spec" | "plan",
    readonly missingLabel: string,
  ) {
    super(
      `Issue #${issue.number} requires ${approvalKind} approval label ${missingLabel}`,
    );
  }
}

export function issueMeetsAutomaticApprovals(
  issue: IssueSummary,
  policy: WorkflowApprovalPolicy | undefined,
): boolean {
  if (!policy?.specApproval.required) return true;
  return issue.labels.includes(policy.specApproval.approvedLabel);
}

export function assertExplicitIssueApprovals(
  issue: IssueSummary,
  policy: WorkflowApprovalPolicy | undefined,
): void {
  if (!policy?.specApproval.required) return;
  if (issue.labels.includes(policy.specApproval.approvedLabel)) return;
  throw new ApprovalRequiredError(
    issue,
    "spec",
    policy.specApproval.approvedLabel,
  );
}
```

- [ ] **Step 5: Wire selection to spec approval helpers**

In `src/cli/commands/run-once/types.ts`, add `approvalPolicy` to
`IssueSelectionOptions`:

```ts
export type IssueSelectionOptions = Pick<
  AgentIssueConfig,
  "issueNumber" | "readyLabel" | "triagePolicy" | "approvalPolicy"
> & {
  priorityLabels?: readonly string[];
  excludedLabels?: readonly string[];
};
```

In `src/cli/commands/run-once/selection.ts`, import helpers:

```ts
import {
  assertExplicitIssueApprovals,
  issueMeetsAutomaticApprovals,
} from "./approval-gates.ts";
```

Add `approvalPolicy` to `ResolvedIssueSelectionOptions`:

```ts
approvalPolicy: IssueSelectionOptions["approvalPolicy"];
```

Set it in `resolveSelectionOptions`:

```ts
approvalPolicy: options.approvalPolicy,
```

Update automatic eligibility:

```ts
function isEligible(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): boolean {
  return (
    issue.state === "open" &&
    issue.labels.includes(options.readyLabel) &&
    blockingLabels(issue.labels, options.excludedLabels).length === 0 &&
    issueMeetsAutomaticApprovals(issue, options.approvalPolicy)
  );
}
```

In explicit selection, after blocked-label checks and before `return issue;`,
add:

```ts
assertExplicitIssueApprovals(issue, resolved.approvalPolicy);
```

- [ ] **Step 6: Run gate and selection tests, then commit**

Run:

```bash
node --test src/cli/commands/run-once/approval-gates.test.ts src/cli/commands/run-once/selection.test.ts
npm run lint:ts
```

Expected: all listed tests pass and TypeScript lint reports no errors.

Commit:

```bash
git add src/cli/commands/run-once/approval-gates.ts src/cli/commands/run-once/approval-gates.test.ts src/cli/commands/run-once/types.ts src/cli/commands/run-once/selection.ts src/cli/commands/run-once/selection.test.ts
git commit -m "feat(run-once): gate selection on spec approval"
```

## Task 5: Model plan approval stop and approved-plan resume decisions

**Files:**

- Modify: `src/cli/commands/run-once/approval-gates.ts`
- Modify: `src/cli/commands/run-once/approval-gates.test.ts`

- [ ] **Step 1: Write failing plan approval decision tests**

Append these tests to `src/cli/commands/run-once/approval-gates.test.ts`:

```ts
import {
  approvedWorkflowReviewLabelsToRemove,
  decidePlanApprovalGate,
} from "./approval-gates.ts";

function planApprovalPolicy(
  required: boolean,
  approvedLabel = "plan-approved",
) {
  return createWorkflowApprovalPolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.workflow,
      planApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
        required,
        approvedLabel,
      },
    },
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
  );
}

test("decidePlanApprovalGate proceeds when plan approval is disabled", () => {
  const decision = decidePlanApprovalGate({
    labels: ["agent-ready"],
    planOnly: false,
    policy: planApprovalPolicy(false),
  });

  assert.deepEqual(decision, { action: "proceed" });
});

test("decidePlanApprovalGate stops for review when plan approval is required and missing", () => {
  const decision = decidePlanApprovalGate({
    labels: ["in-progress"],
    planOnly: false,
    policy: planApprovalPolicy(true),
  });

  assert.deepEqual(decision, {
    action: "stop-for-plan-review",
    reviewLabel: "plan-review",
    missingLabel: "plan-approved",
  });
});

test("decidePlanApprovalGate proceeds when the approved plan label is present", () => {
  const decision = decidePlanApprovalGate({
    labels: ["in-progress", "plan-approved"],
    planOnly: false,
    policy: planApprovalPolicy(true),
  });

  assert.deepEqual(decision, { action: "proceed" });
});

test("decidePlanApprovalGate stops for plan-only without workflow review labels", () => {
  const decision = decidePlanApprovalGate({
    labels: ["in-progress"],
    planOnly: true,
    policy: planApprovalPolicy(false),
  });

  assert.deepEqual(decision, { action: "stop-for-plan-only" });
});

test("approvedWorkflowReviewLabelsToRemove clears active plan review after approval", () => {
  const labels = approvedWorkflowReviewLabelsToRemove(
    ["agent-ready", "plan-review", "plan-approved"],
    planApprovalPolicy(true),
  );

  assert.deepEqual(labels, ["plan-review"]);
});
```

- [ ] **Step 2: Run the failing approval-gates tests**

Run:

```bash
node --test src/cli/commands/run-once/approval-gates.test.ts
```

Expected: failures report missing plan approval decision exports.

- [ ] **Step 3: Implement plan approval decisions**

In `src/cli/commands/run-once/approval-gates.ts`, add these types and helpers:

```ts
export type PlanApprovalGateDecision =
  | { action: "proceed" }
  | { action: "stop-for-plan-only" }
  | {
      action: "stop-for-plan-review";
      reviewLabel: string;
      missingLabel: string;
    };

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

export function approvedWorkflowReviewLabelsToRemove(
  labels: string[],
  policy: WorkflowApprovalPolicy,
): string[] {
  const remove: string[] = [];
  if (
    labels.includes(policy.planApproval.reviewLabel) &&
    labels.includes(policy.planApproval.approvedLabel)
  ) {
    remove.push(policy.planApproval.reviewLabel);
  }
  return remove;
}
```

- [ ] **Step 4: Run approval-gates tests and commit**

Run:

```bash
node --test src/cli/commands/run-once/approval-gates.test.ts
npm run lint:ts
```

Expected: approval-gates tests pass and TypeScript lint reports no errors.

Commit:

```bash
git add src/cli/commands/run-once/approval-gates.ts src/cli/commands/run-once/approval-gates.test.ts
git commit -m "feat(run-once): model approval gate decisions"
```

## Task 6: Apply approval gates in the run-once pipeline

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Write failing pipeline tests for spec approval**

In `src/cli/commands/run-once/pipeline.test.ts`, add this helper near
`makeConfig`:

```ts
function approvalPolicy(
  overrides: {
    specRequired?: boolean;
    specApprovedLabel?: string;
    planRequired?: boolean;
    planReviewLabel?: string;
    planApprovedLabel?: string;
  } = {},
) {
  return createWorkflowApprovalPolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.workflow,
      specApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
        required: overrides.specRequired,
        approvedLabel:
          overrides.specApprovedLabel ??
          DEFAULT_PATCHMILL_CONFIG.workflow.specApproval.approvedLabel,
      },
      planApproval: {
        ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
        required: overrides.planRequired,
        reviewLabel:
          overrides.planReviewLabel ??
          DEFAULT_PATCHMILL_CONFIG.workflow.planApproval.reviewLabel,
        approvedLabel:
          overrides.planApprovedLabel ??
          DEFAULT_PATCHMILL_CONFIG.workflow.planApproval.approvedLabel,
      },
    },
    DEFAULT_PATCHMILL_POLICY,
  );
}
```

Add tests near the existing selection tests:

```ts
test("runOneIssue automatic selection skips spec-unapproved issues", async () => {
  const config = await makeConfig({
    approvalPolicy: approvalPolicy({ specRequired: true }),
  });
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                issue(1, ["agent-ready", "priority:critical"], "Needs spec"),
                issue(
                  2,
                  ["agent-ready", "priority:high", "spec-approved"],
                  "Spec approved",
                ),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 2);
});

test("runOneIssue returns approval-required for explicit spec-unapproved issue", async () => {
  const config = await makeConfig({
    issueNumber: 7,
    approvalPolicy: approvalPolicy({
      specRequired: true,
      specApprovedLabel: "spec-ok",
    }),
  });
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "7"
    ) {
      return {
        code: 0,
        stdout: issueViewPayload(issue(7, ["agent-ready"])),
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "approval-required");
  assert.equal(result.issue.number, 7);
  assert.equal(result.approvalKind, "spec");
  assert.equal(result.missingLabel, "spec-ok");
  assert.equal(
    runner.calls.some((call) => call.command === "git"),
    false,
  );
});
```

- [ ] **Step 2: Update and extend failing plan approval pipeline tests**

In the existing tests named
`runOneIssue stops after finding an existing plan when plan approval is required`
and `runOneIssue stops after creating a plan when plan approval is required`,
replace the config override with:

```ts
approvalPolicy: approvalPolicy({ planRequired: true }),
```

In the existing-plan test, assert the ready restoration edit adds both ready and
plan-review labels:

```ts
const editCalls = runner.calls.filter(
  (call) =>
    call.command === "tea" &&
    call.args[0] === "issues" &&
    call.args[1] === "edit",
);
const restoreCall = editCalls.at(-1);
assert.ok(restoreCall);
assert.equal(
  restoreCall.args[restoreCall.args.indexOf("--add-labels") + 1],
  "agent-ready,plan-review",
);
```

Add this approved-plan resume test near the plan approval tests:

```ts
test("runOneIssue proceeds when plan approval label is present and clears plan-review", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    approvalPolicy: approvalPolicy({ planRequired: true }),
  });
  const planPath = "docs/plans/2026-05-14-issue-49-approved-plan.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  const selected = issue(
    49,
    ["agent-ready", "plan-review", "plan-approved", "bug"],
    "Approved plan",
  );
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
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return {
        code: 0,
        stdout: labelListPayload([
          "agent-ready",
          "in-progress",
          "agent-done",
          "plan-review",
          "plan-approved",
        ]),
        stderr: "",
      };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/49",
          branch: "agent/issue-49-approved-plan",
          commits: ["abc123"],
          validation: [
            "node --test src/cli/commands/run-once/pipeline.test.ts",
          ],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  const claimCall = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit" &&
      call.args.includes("--remove-labels"),
  );
  assert.ok(claimCall);
  assert.equal(
    claimCall.args[claimCall.args.indexOf("--remove-labels") + 1],
    "agent-ready,plan-review",
  );
  assert.equal(
    claimCall.args[claimCall.args.indexOf("--add-labels") + 1],
    "in-progress",
  );
});
```

- [ ] **Step 3: Run the failing focused pipeline tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern="spec-unapproved|plan approval|approved plan"
```

Expected: failures show missing approval-required handling and current plan
approval stops do not add the workflow review label.

- [ ] **Step 4: Catch explicit approval-required selection errors**

In `src/cli/commands/run-once/pipeline.ts`, import approval helpers:

```ts
import {
  ApprovalRequiredError,
  approvedWorkflowReviewLabelsToRemove,
  decidePlanApprovalGate,
} from "./approval-gates.ts";
```

Wrap selection with a typed catch near the start of `runOneIssue`:

```ts
let selected: { issue: IssueSummary; resumed: boolean } | undefined;
try {
  selected = await selectResumableIssue(issues, config);
} catch (error) {
  if (error instanceof ApprovalRequiredError) {
    return withLogPath(
      {
        status: "approval-required",
        issue: error.issue,
        approvalKind: error.approvalKind,
        missingLabel: error.missingLabel,
      },
      options,
    );
  }
  throw error;
}
```

In `selectResumableIssue`, pass `approvalPolicy` to both `selectIssue` calls:

```ts
const selected = selectIssue(issues, {
  issueNumber: config.issueNumber,
  readyLabel: ready,
  triagePolicy: config.triagePolicy,
  approvalPolicy: config.approvalPolicy,
});
```

and:

```ts
const selected = selectIssue(issues, {
  issueNumber: config.issueNumber,
  readyLabel: ready,
  triagePolicy: config.triagePolicy,
  approvalPolicy: config.approvalPolicy,
});
```

- [ ] **Step 5: Clear approved plan-review labels during claim**

In `runOneIssue`, before computing `labels`, add:

```ts
const workflowReviewLabelsToRemove = approvedWorkflowReviewLabelsToRemove(
  issue.labels,
  config.approvalPolicy,
);
```

Change the fresh-claim label calculation to remove those labels:

```ts
let labels = resumed
  ? issue.labels.includes(inProgress)
    ? issue.labels
    : nextLabels(
        issue.labels,
        [ready, ...workflowReviewLabelsToRemove],
        [inProgress],
      )
  : nextLabels(
      issue.labels,
      [ready, ...workflowReviewLabelsToRemove],
      [inProgress],
    );
```

- [ ] **Step 6: Ensure workflow labels can be created on demand**

Change `ensureAutomationLabel` in `pipeline.ts` to accept extra workflow labels:

```ts
async function ensureAutomationLabel(
  host: IssueHostProvider,
  triagePolicy: PatchmillTriagePolicy | undefined,
  extraLabels: readonly LabelDefinition[],
  name: string,
): Promise<void> {
  const missing = missingLabelDefinitions(
    await host.listLabels(),
    triagePolicy ?? DEFAULT_TRIAGE_POLICY,
    extraLabels,
  );
  const label = missing.find((definition) => definition.name === name);
  if (!label) return;
  await host.createLabel(label);
}
```

Add `LabelDefinition` to the host type import:

```ts
import type {
  IssueHostProvider,
  LabelDefinition,
} from "../../../host/types.ts";
```

Update existing calls:

```ts
await ensureAutomationLabel(host, config.triagePolicy, [], inProgress);
await ensureAutomationLabel(host, config.triagePolicy, [], needsInfo);
await ensureAutomationLabel(host, config.triagePolicy, [], done);
```

- [ ] **Step 7: Replace inline plan approval branch with gate decision**

Replace this condition in `pipeline.ts`:

```ts
if (config.planOnly || config.requirePlanApproval) {
```

with:

```ts
const planGate = decidePlanApprovalGate({
  labels,
  planOnly: config.planOnly,
  policy: config.approvalPolicy,
});

if (planGate.action !== "proceed") {
  const labelsToAdd =
    planGate.action === "stop-for-plan-review"
      ? [ready, planGate.reviewLabel]
      : [ready];
  const finalLabels = nextLabels(labels, [inProgress], labelsToAdd);
```

Inside the branch, before the ready-label restoration `host.applyLabels`, ensure
the plan review label when the decision requires it:

```ts
if (planGate.action === "stop-for-plan-review") {
  await ensureAutomationLabel(
    host,
    config.triagePolicy,
    config.approvalPolicy.labelDefinitions,
    planGate.reviewLabel,
  );
}
```

Keep the existing plan-ready comment, run-state writes, final result, and
`plan-created`/`plan-found` return shape. The final labels must remove
`in-progress`, restore the ready label, and add `planGate.reviewLabel` only for
`stop-for-plan-review`.

- [ ] **Step 8: Run focused pipeline tests and commit**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern="spec-unapproved|plan approval|approved plan"
npm run lint:ts
```

Expected: focused pipeline tests pass and TypeScript lint reports no errors.

Commit:

```bash
git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "feat(run-once): enforce approval gates"
```

## Task 7: Document workflow approval configuration and states

**Files:**

- Modify: `docs/configuration.md`
- Modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Update configuration docs**

In `docs/configuration.md`, add `workflow` to the complete example after
`triage`:

```json
"workflow": {
  "specApproval": {
    "required": false,
    "reviewLabel": "spec-review",
    "approvedLabel": "spec-approved"
  },
  "planApproval": {
    "required": false,
    "reviewLabel": "plan-review",
    "approvedLabel": "plan-approved"
  }
},
```

Add this section after `## Triage state map`:

````md
## Workflow approval gates

`workflow.specApproval` and `workflow.planApproval` configure approval labels
that control when `patchmill run-once` may proceed. These labels are workflow
signals, not triage buckets, so they are not nested under the flat `labels`
object and are not added to `triage.stateMap`.

```json
{
  "workflow": {
    "specApproval": {
      "required": true,
      "reviewLabel": "spec-review",
      "approvedLabel": "spec-approved"
    },
    "planApproval": {
      "required": true,
      "reviewLabel": "plan-review",
      "approvedLabel": "plan-approved"
    }
  }
}
```

When specification approval is required, automatic `run-once` selection ignores
ready issues that do not have `workflow.specApproval.approvedLabel`. Explicit
`patchmill run-once --issue <number>` fails with an `approval-required` result
for the requested issue instead of silently choosing another issue.

When plan approval is required, Patchmill creates or finds the issue plan,
comments that the plan is ready, applies `workflow.planApproval.reviewLabel`,
restores the ready label, removes `in-progress`, records the run as finished,
and stops. After a human applies `workflow.planApproval.approvedLabel`, a later
`run-once` reuses the existing plan and proceeds to implementation. During the
claim step, Patchmill removes the active plan-review label when the approved
label is present.

`projectPolicy.planRequiresApproval` remains as a compatibility alias. If
`workflow.planApproval.required` is omitted, Patchmill derives plan approval
from `projectPolicy.planRequiresApproval`. If both are present,
`workflow.planApproval.required` wins.
````

- [ ] **Step 2: Update workflow docs and diagram**

In `docs/issue-agent-workflows.md`, update the run-once Mermaid flow so the
selection path contains a spec approval gate before the clean worktree step:

```md
G -->|yes| G1{Spec approval required and missing?} G1 -->|yes, automatic
selection| Z G1 -->|yes, explicit --issue| AR[Return approval-required] G1
-->|no| H
```

Update the plan branch so approval review labels are explicit:

```md
P --> R{Plan-only or plan approval missing?} P2 --> R R -->|plan-only|
R1[Comment plan ready, restore ready label, finish] R -->|approval missing|
R2[Comment plan ready, add plan-review, restore ready label, finish] R
-->|approved or not required| S[Render subagent support guidance]
```

Add these bullets to `### Issue selection and safety gates`:

```md
When `workflow.specApproval.required` is true, the automatic candidate set is
filtered before priority ordering so a high-priority unapproved issue does not
starve a lower-priority approved issue. Explicit `--issue` selection validates
the requested issue and returns `approval-required` with the missing spec
approved label if the approval is absent.
```

Add this paragraph near the plan-creation prompt section:

```md
Plan approval is a workflow stop. When required and missing, Patchmill comments
that the plan is ready, applies the configured plan-review label, restores the
ready label, removes `in-progress`, records the run as finished, and exits with
`plan-created` or `plan-found`. Once the configured plan-approved label is
present, a later `run-once` reuses the plan and proceeds to implementation.
```

- [ ] **Step 3: Verify docs formatting**

Run:

```bash
npx markdownlint-cli2 docs/configuration.md docs/issue-agent-workflows.md
```

Expected: markdownlint reports `0 error(s)`.

- [ ] **Step 4: Commit docs**

Commit:

```bash
git add docs/configuration.md docs/issue-agent-workflows.md
git commit -m "docs: document workflow approval gates"
```

## Task 8: Full verification and final review

**Files:**

- Review: all files changed by Tasks 1-7

- [ ] **Step 1: Run focused suites**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts src/workflow/approval-policy.test.ts src/cli/commands/triage/labels.test.ts src/cli/commands/labels/setup.test.ts src/cli/commands/run-once/approval-gates.test.ts src/cli/commands/run-once/selection.test.ts src/cli/commands/run-once/args.test.ts src/cli/commands/run-once/pipeline.test.ts src/cli/commands/init/main.test.ts src/cli/commands/doctor/main.test.ts src/cli/commands/doctor/checks.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 2: Run repository validation**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: tests pass, lint reports no errors, and TypeScript build completes.

- [ ] **Step 3: Review the diff for spec coverage**

Run:

```bash
git diff --stat main...HEAD
git diff main...HEAD -- src/config src/workflow src/cli/commands/run-once src/cli/commands/labels src/cli/commands/init src/cli/commands/doctor docs/configuration.md docs/issue-agent-workflows.md
```

Confirm these implementation points are visible in the diff:

- top-level `workflow.specApproval` and `workflow.planApproval` config;
- `projectPolicy.planRequiresApproval` alias resolution for plan approval;
- workflow label definitions aggregated into setup and doctor checks;
- automatic selection filters by spec approval before priority ordering;
- explicit `--issue` can return `approval-required` with the missing spec label;
- plan approval stop adds the configured plan-review label and restores ready;
- approved plan issues proceed to implementation and clear `plan-review` during
  claim.

- [ ] **Step 4: Commit final fixes if verification changed files**

If verification required fixes in the approval-gate integration, stage the files
from the scoped implementation areas and commit them:

```bash
git add src/config src/workflow src/cli/commands/run-once src/cli/commands/triage/labels.ts src/cli/commands/triage/labels.test.ts src/cli/commands/labels src/cli/commands/init src/cli/commands/doctor docs/configuration.md docs/issue-agent-workflows.md
git commit -m "fix(run-once): complete approval gate integration"
```

If no files changed after verification, record that no final fix commit was
needed in the implementation handoff.

## Self-review checklist

- Spec coverage: Tasks cover configuration, alias compatibility, approval policy
  labels, setup/doctor aggregation, automatic selection, explicit issue failure,
  plan approval stops, approved-plan resume, and docs.
- Placeholder scan: This plan contains no placeholder sections or deferred
  implementation steps.
- Type consistency: The plan consistently uses `WorkflowApprovalPolicy`,
  `approvalPolicy`, `approvalKind`, `missingLabel`, `specApproval`, and
  `planApproval` across config, policy, selection, pipeline, and JSON summary
  steps.
