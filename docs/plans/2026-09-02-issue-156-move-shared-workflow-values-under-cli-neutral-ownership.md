# CLI-Neutral Shared Workflow Value Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give shared command, issue, label, human-decision, and Issue run/Pi
contracts focused CLI-neutral owners while preserving every existing public type
shape and runtime behavior.

**Architecture:** Add four small canonical type modules under `src/command/`,
`src/issue/`, `src/workflow/`, and `src/issue-run/`. Existing triage, run-once,
prompt, and Host type paths become type-only compatibility boundaries, while
production and test-support consumers import the canonical owner for each moved
value directly; command implementations, Host capabilities, Issue run behavior,
and Pi execution remain in their current modules.

**Tech Stack:** TypeScript 6, Node.js 22, ESM type-only imports/exports,
`node:test`, ESLint, Prettier, markdownlint, dependency-cruiser, and the
existing npm/Nix build.

**Spec:**
`docs/specs/2026-09-02-issue-156-move-shared-workflow-values-under-cli-neutral-ownership-design.md`

## Global Constraints

- This is an ownership and import-direction change only. Do not alter command
  spawning, `selectIssue()`/`selectIssueWithDiagnostics()` behavior, label
  ordering or mutation, workflow gates, Pi result parsing, persisted JSON,
  prompt JSON, CLI output, error text, or command order.
- Preserve every moved public name, discriminant, literal, field, optionality,
  mutable array shape, and callback signature exactly.
- Canonical owners are exactly `src/command/types.ts`, `src/issue/types.ts`,
  `src/workflow/decisions.ts`, and `src/issue-run/types.ts`; do not create a
  shared barrel, generic dependency bag, context object, or hypothetical adapter
  interface.
- `src/issue-run/types.ts` owns only the existing Issue run/Pi exchange values.
  Command configuration, selection diagnostics, pipeline options, Run recovery
  state, persistence helpers, progress rendering, and recovery decisions remain
  in `src/cli/commands/run-once/types.ts`.
- `src/cli/commands/triage/types.ts`, `src/cli/commands/run-once/types.ts`,
  `src/cli/commands/run-once/prompts.ts`, and `src/host/types.ts` retain
  type-only compatibility re-exports. They must not retain duplicate structural
  definitions for moved values.
- The canonical modules must not import CLI modules, Host implementations, Pi
  implementations, or command factories. `src/issue-run/types.ts` may import
  `HumanDecisionQuestion` from `src/workflow/decisions.ts`.
- Behavioral imports from `src/pi` to the existing run-once prompt builder and
  Pi execution functions are intentionally unchanged; moving those functions is
  a later architecture issue.
- Keep new modules cohesive and below the module-size review threshold. Moving
  the Issue run/Pi exchange types out of the current 483-line run-once type
  module should reduce that module rather than introduce another catch-all.
- Use the domain term **Issue run** from `CONTEXT.md` for the logical lifecycle.
- Apply Patchmill's Testing Value Gate. Do not add tests that merely inspect
  filenames, import strings, or re-export syntax. This change has no production
  behavior to drive with a new failing runtime test, so use existing behavioral
  suites, strict TypeScript checking, and direct bounded ownership scans. Add a
  focused type-contract test only if implementation reveals a public shape that
  these checks cannot prove.
- No dependency-file change is expected. If `package.json`, `package-lock.json`,
  or `npm-shrinkwrap.json` changes, explain the necessity and run
  `nix build .#patchmill --print-build-logs` as required by `AGENTS.md`.

---

## File Structure and Responsibilities

### New canonical owners

- `src/command/types.ts` — owns only `CommandResult`, `CommandRunOptions`, and
  `CommandRunner`.
- `src/issue/types.ts` — owns only `IssueCommentSummary`, `IssueSummary`,
  `LabelDefinition`, and `LabelChangePlan`.
- `src/workflow/decisions.ts` — owns only `HumanDecisionQuestion`.
- `src/issue-run/types.ts` — owns blocker-question, implementation-resume,
  prompt-label, development-environment, visual-evidence, and discriminated Pi
  result contracts shared across the Issue run/Pi boundary.

### Compatibility boundaries

- `src/cli/commands/triage/types.ts` — retains triage-only configuration,
  previews, logs, progress, and result types; imports moved types needed by
  local declarations and re-exports command, issue/label, and human-decision
  types.
- `src/cli/commands/run-once/types.ts` — retains command configuration,
  selection, pipeline, Run recovery state, recovery, and persistence types;
  imports moved types needed by those local declarations and re-exports the
  existing public command, issue, decision, and Issue run names.
- `src/cli/commands/run-once/prompts.ts` — retains prompt input types and prompt
  builders while re-exporting `PromptTriageLabels` from
  `src/issue-run/types.ts`.
- `src/host/types.ts` — retains Host capability and repository/PR types while
  importing and re-exporting canonical issue and label exchange values.

### Intentionally unchanged responsibilities

- `src/cli/commands/triage/command.ts` continues to own the concrete
  `createCommandRunner()` implementation.
- Host provider interfaces remain in `src/host/types.ts`; only the shared issue
  and label records move.
- Selection algorithms, label catalogs/transitions, workflow approval logic,
  prompt rendering, Pi parsing/execution, and Run recovery logic keep their
  existing implementations.
- `package.json`, npm lock/shrinkwrap files, Nix files, and dependency-cruiser
  policy require no implementation change.

---

### Task 1: Canonical Command Execution Contract

**Files:**

- Create: `src/command/types.ts`
- Modify compatibility modules: `src/cli/commands/triage/types.ts`,
  `src/cli/commands/run-once/types.ts`
- Modify command consumers under doctor: `src/cli/commands/doctor/checks.ts`,
  `src/cli/commands/doctor/checks.test.ts`, `src/cli/commands/doctor/main.ts`,
  `src/cli/commands/doctor/main.test.ts`
- Modify command consumers under init: `src/cli/commands/init/git-policy.ts`,
  `src/cli/commands/init/git-policy.test.ts`,
  `src/cli/commands/init/git-setup-push.ts`,
  `src/cli/commands/init/git-setup-push.test.ts`,
  `src/cli/commands/init/main.ts`,
  `src/cli/commands/init/main-git-policy.test.ts`,
  `src/cli/commands/init/pi-smoke-test.ts`,
  `src/cli/commands/init/pi-smoke-test.test.ts`
- Modify command consumers under run/reset and setup-test-repo:
  `src/cli/commands/run/reset/reset.ts`,
  `src/cli/commands/setup-test-repo/main.ts`,
  `src/cli/commands/setup-test-repo/main.test.ts`
- Modify command consumers under run-once:
  `src/cli/commands/run-once/approval-artifact-preflight.ts`,
  `src/cli/commands/run-once/artifact-source-materialization.ts`,
  `src/cli/commands/run-once/artifact-source-materialization.test.ts`,
  `src/cli/commands/run-once/development-environment-stage.ts`,
  `src/cli/commands/run-once/git.ts`, `src/cli/commands/run-once/main.ts`,
  `src/cli/commands/run-once/pi.ts`, `src/cli/commands/run-once/pi.test.ts`,
  `src/cli/commands/run-once/pipeline-finish.ts`,
  `src/cli/commands/run-once/pipeline-implementation.ts`,
  `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts`,
  `src/cli/commands/run-once/pipeline-recovery.ts`,
  `src/cli/commands/run-once/pipeline.ts`,
  `src/cli/commands/run-once/recovery-assessment.ts`,
  `src/cli/commands/run-once/recovery-legacy.ts`,
  `src/cli/commands/run-once/recovery-mutation-helpers.ts`,
  `src/cli/commands/run-once/recovery-mutation-recreate.ts`,
  `src/cli/commands/run-once/recovery-mutation-refresh.ts`,
  `src/cli/commands/run-once/recovery-mutation-reset.ts`,
  `src/cli/commands/run-once/recovery-mutation.ts`,
  `src/cli/commands/run-once/recovery.test.ts`,
  `src/cli/commands/run-once/stage-advancement.ts`,
  `src/cli/commands/run-once/visual-evidence.ts`,
  `src/cli/commands/run-once/visual-evidence.test.ts`
- Modify triage command consumers: `src/cli/commands/triage/command.ts`,
  `src/cli/commands/triage/dry-run-agent.ts`,
  `src/cli/commands/triage/dry-run-agent.test.ts`,
  `src/cli/commands/triage/execute-agent.ts`,
  `src/cli/commands/triage/execute-agent.test.ts`,
  `src/cli/commands/triage/execute-issues.ts`,
  `src/cli/commands/triage/forgejo.ts`, `src/cli/commands/triage/main.ts`,
  `src/cli/commands/triage/main.test.ts`, `src/cli/commands/triage/pipeline.ts`
- Modify Host and Pi consumers: `src/host/factory.ts`,
  `src/host/factory.test.ts`, `src/host/forgejo-pr-body.ts`,
  `src/host/forgejo-pr-body.test.ts`, `src/host/forgejo-tea.ts`,
  `src/host/forgejo-tea.test.ts`, `src/host/github-gh.ts`,
  `src/host/github-gh.test.ts`, `src/host/github-pr-body.ts`,
  `src/host/github-pr-body.test.ts`, `src/pi/hooks.ts`, `src/pi/runner.ts`,
  `src/pi/runner.test.ts`
- Modify test-support consumers: `test-support/command-runner.ts`,
  `test-support/run-once/assertions.ts`, `test-support/run-once/mock-runner.ts`,
  `test-support/run-once/pipeline-fixtures.ts`

**Interfaces:**

- Consumes: the exact command contract currently declared in
  `src/cli/commands/triage/types.ts` and the unchanged `createCommandRunner()`
  implementation.
- Produces:

```ts
export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
};

export type CommandRunner = {
  run(
    command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult>;
};
```

- `src/cli/commands/triage/types.ts` and `src/cli/commands/run-once/types.ts`
  continue to export all three names, but both paths refer to the canonical
  declarations above.

- [ ] **Step 1: Establish the command behavior baseline**

Run existing behavior tests before changing ownership:

```sh
node --test \
  src/cli/commands/triage/command.test.ts \
  src/host/factory.test.ts \
  src/host/forgejo-pr-body.test.ts \
  src/host/forgejo-tea.test.ts \
  src/host/github-gh.test.ts \
  src/host/github-pr-body.test.ts \
  src/pi/hooks.test.ts \
  src/pi/runner.test.ts
```

Expected: PASS. These tests already cover command process capture/streaming,
abort behavior, Host invocation, and Pi runner inputs. Per the Testing Value
Gate, do not add a runtime test for the location of a type declaration.

- [ ] **Step 2: Create the canonical command type owner**

Create `src/command/types.ts` with exactly the three declarations in the
Interfaces block. Do not move `createCommandRunner()`, add runtime exports, or
introduce an index barrel.

- [ ] **Step 3: Replace CLI definitions with compatibility imports and exports**

In `src/cli/commands/triage/types.ts`, delete the three structural definitions
and add only this compatibility export:

```ts
export type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../../../command/types.ts";
```

In `src/cli/commands/run-once/types.ts`, import `CommandRunner` from the
canonical owner for `PlanRunRecoveryInput`, and re-export the complete command
contract directly from the same module:

```ts
import type { CommandRunner } from "../../../command/types.ts";

export type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../../../command/types.ts";
```

Do not route either compatibility module through the other CLI command.

- [ ] **Step 4: Migrate CLI command and Issue run consumers**

For every doctor, init, run/reset, setup-test-repo, triage, and run-once file in
this task's Files list, import `CommandResult`, `CommandRunOptions`, and/or
`CommandRunner` from the relative path to `src/command/types.ts`. When one
existing import also names CLI-local types, split it instead of moving the local
types. For example:

```ts
import type { CommandResult, CommandRunner } from "../../../command/types.ts";
import type { AgentIssuePipelineResult } from "./types.ts";
```

For the deeper run-once directory the canonical path is
`../../../command/types.ts`; for triage, doctor, init, and setup-test-repo it is
also `../../../command/types.ts`; for `src/cli/commands/run/reset/reset.ts` it
is `../../../../command/types.ts`.

Do not alter function bodies. In particular,
`src/cli/commands/triage/command.ts` changes only its type import source.

- [ ] **Step 5: Migrate Host, Pi, and test-support command consumers**

Use these canonical relative paths:

```ts
// src/host/* and src/pi/*
import type { CommandRunner } from "../command/types.ts";

// test-support/command-runner.ts
import type { CommandResult, CommandRunner } from "../src/command/types.ts";

// test-support/run-once/*
import type { CommandResult, CommandRunner } from "../../src/command/types.ts";
```

Split mixed imports so Host capability types continue to come from
`src/host/types.ts`, Pi contract types continue to come from `src/pi/types.ts`,
and run-once-local types continue to come from the run-once compatibility
module.

- [ ] **Step 6: Verify command types and behavior**

Run:

```sh
npm run check:types
node --test \
  src/cli/commands/triage/command.test.ts \
  src/host/factory.test.ts \
  src/host/forgejo-pr-body.test.ts \
  src/host/forgejo-tea.test.ts \
  src/host/github-gh.test.ts \
  src/host/github-pr-body.test.ts \
  src/pi/hooks.test.ts \
  src/pi/runner.test.ts
rg -n '^export type (CommandResult|CommandRunOptions|CommandRunner) =' src
```

Expected: type checking and tests PASS. The final scan reports structural
command declarations only in `src/command/types.ts`; compatibility modules may
contain `export type { ... } from` statements but no duplicate definitions.

- [ ] **Step 7: Commit the command ownership move**

```sh
git add src/command/types.ts \
  src/cli/commands/doctor \
  src/cli/commands/init \
  src/cli/commands/run/reset/reset.ts \
  src/cli/commands/run-once \
  src/cli/commands/setup-test-repo \
  src/cli/commands/triage \
  src/host \
  src/pi/hooks.ts src/pi/runner.ts src/pi/runner.test.ts \
  test-support/command-runner.ts test-support/run-once
git diff --cached --check
git commit -m "refactor: centralize command contracts"
```

---

### Task 2: Canonical Issue and Label Exchange Values

**Files:**

- Create: `src/issue/types.ts`
- Modify compatibility modules: `src/cli/commands/triage/types.ts`,
  `src/cli/commands/run-once/types.ts`, `src/host/types.ts`
- Modify labels/setup and setup-test-repo consumers:
  `src/cli/commands/labels/setup.ts`, `src/cli/commands/labels/setup.test.ts`,
  `src/cli/commands/setup-test-repo/labels.ts`,
  `src/cli/commands/setup-test-repo/main.test.ts`
- Modify run/reset consumers: `src/cli/commands/run/reset/reset.ts`,
  `src/cli/commands/run/reset/reset.test.ts`
- Modify run-once consumers:
  `src/cli/commands/run-once/approval-artifact-preflight.ts`,
  `src/cli/commands/run-once/approval-artifact-preflight.test.ts`,
  `src/cli/commands/run-once/artifact-source-stage.ts`,
  `src/cli/commands/run-once/artifact-source-stage.test.ts`,
  `src/cli/commands/run-once/artifact-sources.ts`,
  `src/cli/commands/run-once/artifact-sources.test.ts`,
  `src/cli/commands/run-once/development-environment-stage.ts`,
  `src/cli/commands/run-once/pipeline-comments.ts`,
  `src/cli/commands/run-once/pipeline-failures.ts`,
  `src/cli/commands/run-once/pipeline-finish.ts`,
  `src/cli/commands/run-once/pipeline-implementation.ts`,
  `src/cli/commands/run-once/pipeline-selection.ts`,
  `src/cli/commands/run-once/pipeline.ts`,
  `src/cli/commands/run-once/planning-artifacts.ts`,
  `src/cli/commands/run-once/planning-artifacts.test.ts`,
  `src/cli/commands/run-once/prompts.ts`,
  `src/cli/commands/run-once/prompts.test.ts`,
  `src/cli/commands/run-once/selection.ts`,
  `src/cli/commands/run-once/selection.test.ts`,
  `src/cli/commands/run-once/stage-advancement.ts`,
  `src/cli/commands/run-once/workflow-state.ts`
- Modify triage consumers: `src/cli/commands/triage/blocked-preprocessor.ts`,
  `src/cli/commands/triage/blocked.ts`,
  `src/cli/commands/triage/blocked.test.ts`,
  `src/cli/commands/triage/dry-run-agent.ts`,
  `src/cli/commands/triage/dry-run-agent.test.ts`,
  `src/cli/commands/triage/execute-agent.ts`,
  `src/cli/commands/triage/execute-agent.test.ts`,
  `src/cli/commands/triage/execute-issues.ts`,
  `src/cli/commands/triage/forgejo.ts`, `src/cli/commands/triage/labels.ts`,
  `src/cli/commands/triage/pipeline.ts`, `src/cli/commands/triage/reporting.ts`,
  `src/cli/commands/triage/reporting.test.ts`
- Modify Host provider consumers: `src/host/forgejo-tea.ts`,
  `src/host/forgejo-tea.test.ts`, `src/host/github-gh.ts`,
  `src/host/github-gh.test.ts`
- Modify policy/workflow consumers: `src/policy/label-catalog.ts`,
  `src/policy/labels.ts`, `src/policy/triage.ts`,
  `src/workflow/approval-policy.ts`
- Modify Pi and test-support consumers: `src/pi/types.ts`,
  `src/pi/runner.test.ts`, `test-support/run-once/issue-fixtures.ts`,
  `test-support/run-once/pipeline-fixtures.ts`

**Interfaces:**

- Consumes: the structurally equivalent issue/label declarations currently
  duplicated in triage and Host type modules.
- Produces:

```ts
export type IssueCommentSummary = {
  body: string;
  authorLogin?: string;
  created?: string;
};

export type IssueSummary = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  url?: string;
  author?: string;
  created?: string;
  updated?: string;
  comments?: IssueCommentSummary[];
};

export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};

export type LabelChangePlan = {
  issueNumber: number;
  oldLabels: string[];
  newLabels: string[];
  addLabels: string[];
  removeLabels: string[];
};
```

- `src/host/types.ts`, `src/cli/commands/triage/types.ts`, and
  `src/cli/commands/run-once/types.ts` continue to export their existing moved
  names, all referring to the canonical type identity.

- [ ] **Step 1: Establish issue-selection, label, and Host baselines**

Run:

```sh
node --test \
  src/cli/commands/run-once/selection.test.ts \
  src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/triage/labels.test.ts \
  src/policy/label-catalog.test.ts \
  src/policy/labels.test.ts \
  src/policy/triage.test.ts \
  src/workflow/approval-policy.test.ts \
  src/host/factory.test.ts \
  src/host/forgejo-tea.test.ts \
  src/host/github-gh.test.ts
```

Expected: PASS, preserving explicit selection, blocking labels, priority and
issue-number ordering, label catalog content/order, deduplication, mutation
plans, approval labels, and Host exchange behavior.

- [ ] **Step 2: Create the canonical issue type owner**

Create `src/issue/types.ts` with exactly the declarations in the Interfaces
block. Keep arrays mutable as they are today; do not add `readonly`, schemas,
validators, constructors, or runtime exports.

- [ ] **Step 3: Collapse duplicate definitions into compatibility boundaries**

In `src/cli/commands/triage/types.ts`, import `IssueSummary` for triage-local
fields and re-export all four issue/label names:

```ts
import type { IssueSummary } from "../../../issue/types.ts";
export type {
  IssueCommentSummary,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "../../../issue/types.ts";
```

In `src/cli/commands/run-once/types.ts`, import `IssueSummary` for selection and
pipeline declarations and re-export it directly from the canonical owner.

In `src/host/types.ts`, import `IssueSummary`, `LabelChangePlan`, and
`LabelDefinition` for Host capability signatures, re-export all four canonical
names, and delete the duplicate structures:

```ts
import type {
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "../issue/types.ts";
export type {
  IssueCommentSummary,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "../issue/types.ts";
```

Keep `RepositoryTarget`, `HostIssueCreateInput`, `RepositoryInfo`,
`HostCliCheck`, PR capabilities, and Host provider interfaces in
`src/host/types.ts` unchanged.

- [ ] **Step 4: Migrate CLI and Issue run consumers by concern**

For every labels/setup, setup-test-repo, run/reset, run-once, and triage file in
this task's Files list, import the moved issue/label names from the relative
path to `src/issue/types.ts`. Split mixed imports so command-local declarations
stay in their current local type modules. Typical run-once and triage imports
are:

```ts
import type { IssueSummary } from "../../../issue/types.ts";
import type { AgentIssueConfig, IssueSelectionDiagnostics } from "./types.ts";
```

Use `../../../../issue/types.ts` from `src/cli/commands/run/reset/reset.ts` and
its test. When importing `LabelDefinition` alongside Host capabilities in
labels/setup or setup-test-repo, keep the capability import from
`src/host/types.ts` and add a separate canonical issue import.

Do not edit selection comparisons, label arrays, label descriptions, transition
logic, or Host payload conversion.

- [ ] **Step 5: Migrate Host, policy, workflow, Pi, and test-support consumers**

Use these ownership paths and keep capability imports separate:

```ts
// src/host/*, src/policy/*, src/workflow/*, and src/pi/*
import type {
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "../issue/types.ts";

// test-support/run-once/*
import type { IssueSummary } from "../../src/issue/types.ts";
```

Only import the names each file uses. `src/pi/types.ts` keeps its behavioral
`RunPiPromptOptions` import from run-once Pi code; only `IssueSummary` moves to
its canonical owner.

- [ ] **Step 6: Verify issue and label compatibility and behavior**

Run:

```sh
npm run check:types
node --test \
  src/cli/commands/run-once/selection.test.ts \
  src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/triage/labels.test.ts \
  src/policy/label-catalog.test.ts \
  src/policy/labels.test.ts \
  src/policy/triage.test.ts \
  src/workflow/approval-policy.test.ts \
  src/host/factory.test.ts \
  src/host/forgejo-tea.test.ts \
  src/host/github-gh.test.ts
rg -n '^export type (IssueCommentSummary|IssueSummary|LabelDefinition|LabelChangePlan) =' src
```

Expected: type checking and tests PASS. The scan reports each structural
issue/label declaration only in `src/issue/types.ts` and no definitions in
triage or Host compatibility modules.

- [ ] **Step 7: Commit the issue and label ownership move**

```sh
git add src/issue/types.ts \
  src/cli/commands/labels \
  src/cli/commands/run/reset \
  src/cli/commands/run-once \
  src/cli/commands/setup-test-repo \
  src/cli/commands/triage \
  src/host \
  src/pi/types.ts src/pi/runner.test.ts \
  src/policy src/workflow/approval-policy.ts \
  test-support/run-once
git diff --cached --check
git commit -m "refactor: centralize issue and label contracts"
```

---

### Task 3: Canonical Human Decision and Issue Run/Pi Contracts

**Files:**

- Create: `src/workflow/decisions.ts`
- Create: `src/issue-run/types.ts`
- Modify compatibility modules: `src/cli/commands/triage/types.ts`,
  `src/cli/commands/run-once/types.ts`, `src/cli/commands/run-once/prompts.ts`
- Modify Issue run consumers:
  `src/cli/commands/run-once/development-environment-stage.ts`,
  `src/cli/commands/run-once/pi.ts`,
  `src/cli/commands/run-once/pipeline-comments.ts`,
  `src/cli/commands/run-once/pipeline-failures.ts`,
  `src/cli/commands/run-once/pipeline-implementation.ts`,
  `src/cli/commands/run-once/pipeline-lifecycle.ts`,
  `src/cli/commands/run-once/pipeline-selection.ts`,
  `src/cli/commands/run-once/result-summary.ts`,
  `src/cli/commands/run-once/stage-advancement.ts`,
  `src/cli/commands/run-once/visual-evidence.ts`,
  `src/cli/commands/run-once/visual-evidence.test.ts`
- Modify Pi boundary consumer: `src/pi/types.ts`

**Interfaces:**

- Consumes: `HumanDecisionQuestion` from triage, `PromptTriageLabels` from the
  prompt module, and the Issue run/Pi exchange declarations currently embedded
  in run-once types.
- Produces `src/workflow/decisions.ts`:

```ts
export type HumanDecisionQuestion = {
  question: string;
  recommendedAnswer: string;
};
```

- Produces `src/issue-run/types.ts`:

```ts
import type { HumanDecisionQuestion } from "../workflow/decisions.ts";

export type AgentIssueImplementationResumeContext = {
  resumed: boolean;
  worktreeCreated: boolean;
  existingCommits: string[];
  priorBlockerReason?: string;
  priorBlockerQuestions?: AgentIssueBlockerQuestion[];
  priorValidation?: string[];
};

export type AgentIssueBlockerQuestion = string | HumanDecisionQuestion;

export type PromptTriageLabels = {
  ready: string;
  needsInfo: string;
};

export type AgentIssueBlockedResult = {
  status: "blocked";
  reason: string;
  questions: AgentIssueBlockerQuestion[];
  commits: string[];
  validation: string[];
};

export type AgentIssueSpecCreatedResult = {
  status: "spec-created";
  specPath: string;
  commit?: string;
};

export type AgentIssuePlanCreatedResult = {
  status: "plan-created";
  planPath: string;
  commit?: string;
};

export type AgentIssueDevelopmentEnvironmentReadyResult = {
  status: "ready";
  summary: string;
  evidence: string[];
  environment?: Record<string, string>;
};

export type AgentIssueDevelopmentEnvironmentNotReadyResult = {
  status: "not-ready";
  reason: string;
  evidence: string[];
  remediation: string[];
};

export type AgentIssueDevelopmentEnvironmentResult =
  | AgentIssueDevelopmentEnvironmentReadyResult
  | AgentIssueDevelopmentEnvironmentNotReadyResult;

export type AgentIssueDevelopmentEnvironmentHandoff =
  AgentIssueDevelopmentEnvironmentReadyResult & {
    completedAt: string;
  };

export type AgentIssueVisualEvidence = {
  screenshotPath: string;
  caption?: string;
  referencePaths?: string[];
  url?: string;
};

export type AgentIssuePrCreatedResult = {
  status: "pr-created";
  prUrl: string;
  branch: string;
  commits: string[];
  validation: string[];
  reviewSummary?: string;
  landingDecision?: string;
  visualEvidence?: AgentIssueVisualEvidence[];
};

export type AgentIssueMergedResult = {
  status: "merged";
  branch: string;
  mergeCommit: string;
  commits: string[];
  validation: string[];
  reviewSummary?: string;
  landingDecision?: string;
};

export type AgentIssuePiResult =
  | AgentIssueBlockedResult
  | AgentIssueSpecCreatedResult
  | AgentIssuePlanCreatedResult
  | AgentIssuePrCreatedResult
  | AgentIssueMergedResult;
```

- `AgentIssueApprovalRequiredResult`, `AgentIssuePipelineResult`, Run recovery
  contracts, command configuration, and progress contracts remain in
  `src/cli/commands/run-once/types.ts`.

- [ ] **Step 1: Establish prompt, Pi parsing, and result behavior baselines**

Run:

```sh
node --test \
  src/cli/commands/run-once/pi-result-parsing.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/cli/commands/run-once/prompts.test.ts \
  src/cli/commands/run-once/visual-evidence.test.ts \
  src/pi/runner.test.ts
```

Expected: PASS for blocker questions, development-environment results, prompt
labels/resume context, all Pi result discriminants, visual evidence, and Pi
runner prompt inputs.

- [ ] **Step 2: Create the focused decision and Issue run owners**

Create `src/workflow/decisions.ts` and `src/issue-run/types.ts` with exactly the
Interfaces declarations. Preserve names such as
`AgentIssueImplementationResumeContext`, `AgentIssueBlockerQuestion`,
`PromptTriageLabels`, and `AgentIssuePiResult`; do not rename the `AgentIssue*`
family as part of this ownership move.

- [ ] **Step 3: Convert triage and run-once type modules into compatibility
      boundaries**

In `src/cli/commands/triage/types.ts`, import `HumanDecisionQuestion` for
`TriageQuestion`, delete its local structural definition, and re-export it:

```ts
import type { HumanDecisionQuestion } from "../../../workflow/decisions.ts";
export type { HumanDecisionQuestion } from "../../../workflow/decisions.ts";

export type TriageQuestion = string | HumanDecisionQuestion;
```

In `src/cli/commands/run-once/types.ts`, import only the moved types still used
by local Run recovery/pipeline declarations and re-export the full compatibility
surface directly:

```ts
import type {
  AgentIssueBlockedResult,
  AgentIssueBlockerQuestion,
  AgentIssueMergedResult,
  AgentIssuePrCreatedResult,
  AgentIssueVisualEvidence,
} from "../../../issue-run/types.ts";

export type {
  AgentIssueBlockedResult,
  AgentIssueBlockerQuestion,
  AgentIssueDevelopmentEnvironmentHandoff,
  AgentIssueDevelopmentEnvironmentNotReadyResult,
  AgentIssueDevelopmentEnvironmentReadyResult,
  AgentIssueDevelopmentEnvironmentResult,
  AgentIssueImplementationResumeContext,
  AgentIssueMergedResult,
  AgentIssuePiResult,
  AgentIssuePlanCreatedResult,
  AgentIssuePrCreatedResult,
  AgentIssueSpecCreatedResult,
  AgentIssueVisualEvidence,
} from "../../../issue-run/types.ts";
export type { HumanDecisionQuestion } from "../../../workflow/decisions.ts";
```

Delete the corresponding structural declarations from run-once types. Keep
`AgentIssueApprovalRequiredResult` local because it is a command pipeline
result, not an Issue run/Pi exchange contract.

- [ ] **Step 4: Preserve the prompt-module compatibility path**

In `src/cli/commands/run-once/prompts.ts`, import `PromptTriageLabels` and the
other shared Issue run input types from `src/issue-run/types.ts`, import
`IssueSummary` from `src/issue/types.ts`, delete the local `PromptTriageLabels`
declaration, and add:

```ts
export type { PromptTriageLabels } from "../../../issue-run/types.ts";
```

Keep every prompt input type, default label (`agent-ready`, `needs-info`),
prompt builder, and rendering function unchanged.

- [ ] **Step 5: Migrate Issue run and Pi consumers to the canonical owner**

For each Issue run file in this task's Files list, split shared exchange types
from command-local types:

```ts
import type {
  AgentIssueBlockedResult,
  AgentIssuePiResult,
  AgentIssueVisualEvidence,
} from "../../../issue-run/types.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueRunState,
} from "./types.ts";
```

Only import the actual names used in each file. In `src/pi/types.ts`, import
`AgentIssueImplementationResumeContext`, `AgentIssuePiResult`, and
`PromptTriageLabels` from `../issue-run/types.ts`, and keep `IssueSummary` from
`../issue/types.ts`. In `src/pi/runner.ts`, keep runtime imports of
`buildImplementationPrompt`, `buildPlanCreationPrompt`, and `runPiPrompt` from
run-once modules; this task changes shared type ownership, not runtime function
ownership.

Do not change parsing guards, result object construction, prompt text, visual
evidence normalization, or pipeline branch handling.

- [ ] **Step 6: Verify decisions, Issue run unions, and compatibility**

Run:

```sh
npm run check:types
node --test \
  src/cli/commands/run-once/pi-result-parsing.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/cli/commands/run-once/prompts.test.ts \
  src/cli/commands/run-once/visual-evidence.test.ts \
  src/pi/runner.test.ts
rg -n '^export type HumanDecisionQuestion =' src
rg -n '^export type (AgentIssueImplementationResumeContext|AgentIssueBlockerQuestion|PromptTriageLabels|AgentIssueBlockedResult|AgentIssueSpecCreatedResult|AgentIssuePlanCreatedResult|AgentIssueDevelopmentEnvironmentReadyResult|AgentIssueDevelopmentEnvironmentNotReadyResult|AgentIssueDevelopmentEnvironmentResult|AgentIssueDevelopmentEnvironmentHandoff|AgentIssueVisualEvidence|AgentIssuePrCreatedResult|AgentIssueMergedResult|AgentIssuePiResult) =' src
```

Expected: type checking and tests PASS. `HumanDecisionQuestion` is structurally
defined only in `src/workflow/decisions.ts`; every listed Issue run/Pi structure
is defined only in `src/issue-run/types.ts`.

- [ ] **Step 7: Commit the decision and Issue run ownership move**

```sh
git add src/workflow/decisions.ts src/issue-run/types.ts \
  src/cli/commands/triage/types.ts \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/prompts.ts \
  src/cli/commands/run-once/development-environment-stage.ts \
  src/cli/commands/run-once/pi.ts \
  src/cli/commands/run-once/pipeline-comments.ts \
  src/cli/commands/run-once/pipeline-failures.ts \
  src/cli/commands/run-once/pipeline-implementation.ts \
  src/cli/commands/run-once/pipeline-lifecycle.ts \
  src/cli/commands/run-once/pipeline-selection.ts \
  src/cli/commands/run-once/result-summary.ts \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/visual-evidence.ts \
  src/cli/commands/run-once/visual-evidence.test.ts \
  src/pi/types.ts
git diff --cached --check
git commit -m "refactor: centralize issue run contracts"
```

---

### Task 4: Ownership Audit and Full Regression Verification

**Files:**

- Verify only: all files changed in Tasks 1-3
- Verify unchanged: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`,
  Nix files, selection/label/decision algorithms, command runner implementation
  bodies, and generated `dist/`

**Interfaces:**

- Consumes: all four canonical owners and compatibility re-exports from Tasks
  1-3.
- Produces: evidence that moved values have one canonical definition, consumers
  use that owner, old source paths remain valid, neutral modules point inward,
  and runtime behavior remains unchanged.

- [ ] **Step 1: Run a bounded symbol-aware ownership scan**

Run this direct verification rather than adding an import-string test:

```sh
python3 - <<'PY'
from pathlib import Path
import re

owners = {
    "command/types.ts": {
        "CommandResult", "CommandRunOptions", "CommandRunner",
    },
    "issue/types.ts": {
        "IssueCommentSummary", "IssueSummary", "LabelDefinition",
        "LabelChangePlan",
    },
    "workflow/decisions.ts": {"HumanDecisionQuestion"},
    "issue-run/types.ts": {
        "AgentIssueImplementationResumeContext", "AgentIssueBlockerQuestion",
        "PromptTriageLabels", "AgentIssueBlockedResult",
        "AgentIssueSpecCreatedResult", "AgentIssuePlanCreatedResult",
        "AgentIssueDevelopmentEnvironmentReadyResult",
        "AgentIssueDevelopmentEnvironmentNotReadyResult",
        "AgentIssueDevelopmentEnvironmentResult",
        "AgentIssueDevelopmentEnvironmentHandoff", "AgentIssueVisualEvidence",
        "AgentIssuePrCreatedResult", "AgentIssueMergedResult",
        "AgentIssuePiResult",
    },
}
expected = {
    symbol: owner for owner, symbols in owners.items() for symbol in symbols
}
statement = re.compile(
    r"(?:import|export)\s+(?:type\s+)?\{(.*?)\}\s+from\s+[\"']([^\"']+)[\"']",
    re.S,
)
violations = []
for root in ("src", "test-support", "bin"):
    for path in Path(root).rglob("*.ts"):
        text = path.read_text()
        for names, source in statement.findall(text):
            imported = set(re.findall(r"\b[A-Z][A-Za-z0-9_]*\b", names))
            for symbol in imported & expected.keys():
                if not source.endswith("/" + expected[symbol]):
                    violations.append(
                        f"{path}: {symbol} comes from {source}, expected {expected[symbol]}"
                    )
if violations:
    raise SystemExit("\n".join(sorted(violations)))
print("all moved type imports and re-exports use canonical owners")
PY
```

Expected: prints `all moved type imports and re-exports use canonical owners`.
This catches compatibility modules accidentally routing through another CLI
module as well as ordinary consumers retaining old ownership imports.

- [ ] **Step 2: Verify neutral direction and unique structural definitions**

Run:

```sh
if rg -n '(/cli/|/host/|/pi/)' \
  src/command/types.ts \
  src/issue/types.ts \
  src/workflow/decisions.ts \
  src/issue-run/types.ts; then
  echo "neutral owner imports an outer layer" >&2
  exit 1
fi

rg -n '^export type (CommandResult|CommandRunOptions|CommandRunner|IssueCommentSummary|IssueSummary|LabelDefinition|LabelChangePlan|HumanDecisionQuestion|AgentIssueImplementationResumeContext|AgentIssueBlockerQuestion|PromptTriageLabels|AgentIssueBlockedResult|AgentIssueSpecCreatedResult|AgentIssuePlanCreatedResult|AgentIssueDevelopmentEnvironmentReadyResult|AgentIssueDevelopmentEnvironmentNotReadyResult|AgentIssueDevelopmentEnvironmentResult|AgentIssueDevelopmentEnvironmentHandoff|AgentIssueVisualEvidence|AgentIssuePrCreatedResult|AgentIssueMergedResult|AgentIssuePiResult) =' src
```

Expected: the forbidden-import scan is silent. The definition scan reports only
`src/command/types.ts`, `src/issue/types.ts`, `src/workflow/decisions.ts`, and
`src/issue-run/types.ts`, with each moved name defined once. Type-only
compatibility exports are allowed and expected.

- [ ] **Step 3: Run all focused behavior-preservation suites**

Run:

```sh
node --test \
  src/cli/commands/triage/command.test.ts \
  src/cli/commands/triage/labels.test.ts \
  src/cli/commands/run-once/selection.test.ts \
  src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/run-once/prompts.test.ts \
  src/cli/commands/run-once/pi-result-parsing.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/host/*.test.ts \
  src/pi/hooks.test.ts \
  src/pi/runner.test.ts \
  src/policy/label-catalog.test.ts \
  src/policy/labels.test.ts \
  src/policy/triage.test.ts \
  src/workflow/approval-policy.test.ts
```

Expected: PASS. This is the acceptance-level focused coverage for command
execution, issue selection/workflow state, labels/transitions, Host providers,
Pi runner inputs/results, prompts, and Pi result parsing.

- [ ] **Step 4: Run strict types, architecture, build, lint, and the full
      suite**

Run in this order:

```sh
npm run check:types
npm run check:architecture
npm run build
npm run lint
npm test
```

Expected: all commands PASS. `check:types` protects exact optionality and union
assignability; `check:architecture` protects dependency direction; build and
lint protect the production module graph/format; the full test suite catches
behavior drift outside the focused suites.

- [ ] **Step 5: Apply the AGENTS.md dependency/Nix gate**

Run:

```sh
dependency_changes="$(git diff --name-only "$(git merge-base HEAD origin/main)" -- \
  package.json package-lock.json npm-shrinkwrap.json)"
if [ -n "$dependency_changes" ]; then
  printf 'Dependency files changed:\n%s\n' "$dependency_changes"
  nix build .#patchmill --print-build-logs
else
  echo "No npm dependency files changed; AGENTS.md Nix build gate not triggered."
fi
```

Expected: the no-dependency message. If a dependency file changed for a
justified reason, the Nix build must PASS before completion; otherwise revert
the unintended dependency change.

- [ ] **Step 6: Audit the final diff for ownership-only changes**

Run:

```sh
git diff --check "$(git merge-base HEAD origin/main)"..HEAD
git diff --stat "$(git merge-base HEAD origin/main)"..HEAD
git diff "$(git merge-base HEAD origin/main)"..HEAD -- \
  src/cli/commands/triage/command.ts \
  src/cli/commands/run-once/selection.ts \
  src/cli/commands/run-once/workflow-state.ts \
  src/cli/commands/run-once/pi.ts \
  src/policy/label-catalog.ts \
  src/policy/labels.ts \
  src/policy/triage.ts \
  src/workflow/approval-policy.ts
git status --short
```

Expected: `git diff --check` is silent; the inspected behavioral modules show
only type-import movement, with no function-body, label literal, comparison,
parser, or command-runner behavior change; status is clean after the three task
commits. No additional commit is needed for this verification-only task.

---

## Acceptance and Test Mapping

| Acceptance requirement                                      | Primary task and proof                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Shared command values have a CLI-neutral owner              | Task 1 canonical module, unique-definition scan, command/Host/Pi tests      |
| Shared issue and label values have one owner                | Task 2 canonical module, unique-definition scan, selection/label/Host tests |
| Human decisions have a workflow owner                       | Task 3 decision module and strict type check                                |
| Issue run/Pi values have a focused neutral owner            | Task 3 Issue run module, Pi parsing/prompt/runner tests                     |
| Existing public paths and shapes remain compatible          | Tasks 1-3 type-only re-exports plus `npm run check:types`                   |
| Non-compatibility consumers import canonical owners         | Task 4 symbol-aware bounded scan                                            |
| Neutral owners do not depend on outer layers                | Task 4 forbidden-import scan and `npm run check:architecture`               |
| Issue selection and workflow gates are unchanged            | Tasks 2 and 4 selection/workflow-state tests                                |
| Labels, decisions, and Host exchange behavior are unchanged | Tasks 2 and 4 policy/workflow/Host tests                                    |
| Pi result and prompt contracts are unchanged                | Tasks 3 and 4 parsing, prompt, visual-evidence, and runner tests            |
| Command-runner behavior is unchanged                        | Tasks 1 and 4 command runner tests plus final diff audit                    |
| No generic bag, hypothetical adapters, or dependency change | Focused owner file structure, final diff audit, and dependency/Nix gate     |
| Focused tests, TypeScript build, lint, and full tests pass  | Task 4 complete verification sequence                                       |

## Testing Value Gate Notes

- No new automated test is planned because a test that checks a module path,
  import string, or re-export statement would restate implementation rather than
  protect runtime behavior.
- Meaningful existing suites are rerun because they can fail on structural type
  drift that changes selection, labels, Host exchange, command execution,
  prompts, parsing, or Pi result handling.
- Strict TypeScript checking proves optionality, union discriminants, callback
  signatures, and compatibility-module assignability. Direct symbol-aware scans
  prove unique ownership and import direction without creating a brittle
  source-layout test.
- If implementation exposes a compatibility shape not exercised by production
  compilation or these behavioral suites, add the smallest compile-time contract
  that assigns the old-path type to and from the canonical type; do not assert
  source text or filenames at runtime.
