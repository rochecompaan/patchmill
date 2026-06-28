# Run-Once No-Issue Selection Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic `patchmill run-once --dry-run` no-issue outcomes
explain why each considered open issue was skipped, without changing selection
behavior or result shape.

**Architecture:** Add a focused selection diagnostic API that reuses the
existing run-once option resolution, workflow-state resolution, excluded-label
filtering, and priority comparison. The pipeline will call the diagnostic API
for automatic selection, emit debug JSONL rejection records only when no issue
is selected, and keep explicit `--issue` behavior unchanged.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node --test`),
Patchmill run-once pipeline/progress JSONL events.

---

## File Structure

- Modify `src/cli/commands/run-once/types.ts`: define exported rejection reason
  and diagnostic record/result types if shared between `selection.ts`, tests,
  and `pipeline.ts`.
- Modify `src/cli/commands/run-once/selection.ts`: add
  `selectIssueWithDiagnostics()` (or equivalent) and keep `selectIssue()` as a
  compatibility wrapper.
- Modify `src/cli/commands/run-once/pipeline.ts`: use the diagnostic API for
  automatic selection and emit debug skip events on automatic no-issue results.
- Modify `src/cli/commands/run-once/selection.test.ts`: cover rejection records
  and selection-order preservation.
- Modify `src/cli/commands/run-once/pipeline.test.ts`: cover dry-run no-issue
  JSONL/progress diagnostics and successful-selection non-regression.

## Implementation Tasks

### Task 1: Add selection diagnostic test coverage

**Files:**

- Modify: `src/cli/commands/run-once/selection.test.ts`

- [ ] **Step 1: Import the diagnostic API before it exists**

Change the selection import to include the new API. This is expected to fail
until Task 2 implements it.

```ts
import { selectIssue, selectIssueWithDiagnostics } from "./selection.ts";
```

- [ ] **Step 2: Add tests for stable rejection records**

Append these tests near the existing automatic-selection tests:

```ts
test("selectIssueWithDiagnostics explains automatic rejection reasons", () => {
  const result = selectIssueWithDiagnostics(
    [
      issue(1, [ready, needsInfo]),
      issue(2, ["bug"]),
      issue(3, ["spec-review"]),
      issue(4, [ready], "closed"),
    ],
    { readyLabel: ready, approvalPolicy: specApprovalPolicy() },
  );

  assert.equal(result.issue, undefined);
  assert.deepEqual(
    result.rejections.map((entry) => ({
      issueNumber: entry.issueNumber,
      reason: entry.reason,
      workflowState: entry.workflowState,
      blockingLabels: entry.blockingLabels,
      state: entry.state,
    })),
    [
      {
        issueNumber: 1,
        reason: "blocking-labels",
        workflowState: "agent-ready",
        blockingLabels: [needsInfo],
        state: "open",
      },
      {
        issueNumber: 2,
        reason: "not-actionable",
        workflowState: "not-actionable",
        blockingLabels: undefined,
        state: "open",
      },
      {
        issueNumber: 3,
        reason: "waiting-spec-approval",
        workflowState: "waiting-spec-review",
        blockingLabels: undefined,
        state: "open",
      },
      {
        issueNumber: 4,
        reason: "non-open-state",
        workflowState: "agent-ready",
        blockingLabels: undefined,
        state: "closed",
      },
    ],
  );
});

test("selectIssueWithDiagnostics preserves selected candidate priority and reports no skip diagnostics when selected", () => {
  const result = selectIssueWithDiagnostics(
    [
      issue(8, [ready, medium]),
      issue(3, [ready, critical]),
      issue(2, [ready, high]),
      issue(1, [ready]),
    ],
    { readyLabel: ready },
  );

  assert.equal(result.issue?.number, 3);
  assert.deepEqual(result.rejections, []);
});
```

- [ ] **Step 3: Run the selection tests and confirm the intended failure**

Run:

```sh
node --test src/cli/commands/run-once/selection.test.ts
```

Expected: FAIL because `selectIssueWithDiagnostics` is not exported yet.

### Task 2: Implement selection diagnostics

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/selection.ts`
- Test: `src/cli/commands/run-once/selection.test.ts`

- [ ] **Step 1: Add shared diagnostic types**

In `src/cli/commands/run-once/types.ts`, add these exports after
`IssueSelectionOptions`:

```ts
export type IssueSelectionRejectionReason =
  | "non-open-state"
  | "blocking-labels"
  | "not-actionable"
  | "waiting-spec-approval"
  | "waiting-plan-approval";

export type IssueSelectionRejection = {
  issueNumber: number;
  title: string;
  state: string;
  labels: string[];
  workflowState: string;
  reason: IssueSelectionRejectionReason;
  blockingLabels?: string[];
  missingLabel?: string;
};

export type IssueSelectionDiagnostics = {
  issue?: IssueSummary;
  rejections: IssueSelectionRejection[];
  consideredCount: number;
};
```

- [ ] **Step 2: Update imports in `selection.ts`**

Change the type import at the top of `src/cli/commands/run-once/selection.ts` to
include the new diagnostic types:

```ts
import type {
  IssueSelectionDiagnostics,
  IssueSelectionOptions,
  IssueSelectionRejection,
  IssueSelectionRejectionReason,
  IssueSummary,
} from "./types.ts";
```

- [ ] **Step 3: Add a rejection helper that uses the same workflow and blocker
      rules**

Add this helper below `isEligible()`:

```ts
function rejectionForIssue(
  issue: IssueSummary,
  options: ResolvedIssueSelectionOptions,
): IssueSelectionRejection | undefined {
  const state = resolveWorkflowState(issue.labels, {
    readyLabel: options.readyLabel,
    policy: approvalPolicy(options),
  });
  const blockedBy = blockingLabels(issue.labels, options.excludedLabels);
  let reason: IssueSelectionRejectionReason | undefined;
  let missingLabel: string | undefined;

  if (issue.state !== "open") {
    reason = "non-open-state";
  } else if (blockedBy.length > 0) {
    reason = "blocking-labels";
  } else if (state.kind === "waiting-spec-review") {
    reason = "waiting-spec-approval";
    missingLabel = state.missingLabel;
  } else if (state.kind === "waiting-plan-review") {
    reason = "waiting-plan-approval";
    missingLabel = state.missingLabel;
  } else if (!isActionableWorkflowState(state)) {
    reason = "not-actionable";
  }

  if (!reason) return undefined;

  return {
    issueNumber: issue.number,
    title: issue.title,
    state: issue.state,
    labels: [...issue.labels],
    workflowState: state.kind,
    reason,
    ...(blockedBy.length > 0 ? { blockingLabels: blockedBy } : {}),
    ...(missingLabel ? { missingLabel } : {}),
  };
}
```

- [ ] **Step 4: Add the diagnostic selector and wrap `selectIssue()`**

Replace only the automatic-selection body in `selectIssue()` with this new
exported function plus a thin wrapper. Preserve the existing explicit-issue
branch exactly.

```ts
export function selectIssueWithDiagnostics(
  issues: IssueSummary[],
  options: IssueSelectionOptions,
): IssueSelectionDiagnostics {
  const resolved = resolveSelectionOptions(options);

  if (resolved.issueNumber !== undefined) {
    return {
      issue: selectIssue(issues, options),
      rejections: [],
      consideredCount: issues.length,
    };
  }

  let selected: IssueSummary | undefined;
  for (const issue of issues) {
    if (!isEligible(issue, resolved)) continue;
    if (!selected || compareIssues(issue, selected, resolved) < 0) {
      selected = issue;
    }
  }

  if (selected) {
    return { issue: selected, rejections: [], consideredCount: issues.length };
  }

  return {
    rejections: issues.flatMap((issue) => {
      const rejection = rejectionForIssue(issue, resolved);
      return rejection ? [rejection] : [];
    }),
    consideredCount: issues.length,
  };
}

export function selectIssue(
  issues: IssueSummary[],
  options: IssueSelectionOptions,
): IssueSummary | undefined {
  const resolved = resolveSelectionOptions(options);

  if (resolved.issueNumber !== undefined) {
    const issue = issues.find(
      (candidate) =>
        candidate.number === resolved.issueNumber && candidate.state === "open",
    );
    if (!issue) return undefined;
    const blockedBy = blockingLabels(issue.labels, resolved.excludedLabels);
    if (blockedBy.length > 0) {
      throw new Error(
        `Issue #${issue.number} is open but not eligible because it has ${blockedBy.join(", ")}`,
      );
    }

    assertExplicitWorkflowState(issue.labels, {
      readyLabel: resolved.readyLabel,
      policy: approvalPolicy(resolved),
      issue,
    });

    return issue;
  }

  return selectIssueWithDiagnostics(issues, options).issue;
}
```

- [ ] **Step 5: Run selection tests**

Run:

```sh
node --test src/cli/commands/run-once/selection.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the task**

```sh
git add src/cli/commands/run-once/types.ts src/cli/commands/run-once/selection.ts src/cli/commands/run-once/selection.test.ts
git commit -m "test: cover run-once selection diagnostics"
```

### Task 3: Add pipeline diagnostic tests

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Add a dry-run no-issue diagnostics test**

Append this test near
`runOneIssue returns no-issue when no eligible issue exists and performs no mutations`:

```ts
test("runOneIssue dry-run logs skip diagnostics when automatic selection finds no eligible issue", async () => {
  const config = await makeConfig();
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
                issue(2, ["needs-info"], "Needs more detail"),
                issue(4, ["agent-ready", "in-progress"], "Already claimed"),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.deepEqual(result, { status: "no-issue" });
  const skipEvents = events.filter((event) => event.level === "debug");
  assert.deepEqual(
    skipEvents.map((event) => ({
      message: event.message,
      issueNumber: event.issueNumber,
      data: event.data,
    })),
    [
      {
        message: "skipped #2: blocking labels",
        issueNumber: 2,
        data: {
          issueNumber: 2,
          title: "Needs more detail",
          state: "open",
          labels: ["needs-info"],
          workflowState: "not-actionable",
          reason: "blocking-labels",
          blockingLabels: ["needs-info"],
        },
      },
      {
        message: "skipped #4: blocking labels",
        issueNumber: 4,
        data: {
          issueNumber: 4,
          title: "Already claimed",
          state: "open",
          labels: ["agent-ready", "in-progress"],
          workflowState: "agent-ready",
          reason: "blocking-labels",
          blockingLabels: ["in-progress"],
        },
      },
    ],
  );
  assert.equal(
    events.at(-1)?.message,
    "no eligible issue found after considering 2 open issues; see run log for skip details",
  );
  assert.equal(runner.calls.length, 2);
});
```

- [ ] **Step 2: Add a successful-selection non-regression test**

Append this test near the first dry-run selection test:

```ts
test("runOneIssue dry-run does not log skip diagnostics when automatic selection succeeds", async () => {
  const config = await makeConfig();
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
                issue(10, ["needs-info"], "Skipped but not logged"),
                issue(3, ["agent-ready", "priority:high"], "Selected issue"),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 3);
  assert.deepEqual(
    events.map((event) => event.message),
    ["listing open issues", "selected #3 Selected issue"],
  );
  assert.equal(
    events.some((event) => event.level === "debug"),
    false,
  );
});
```

- [ ] **Step 3: Run pipeline tests and confirm the intended failure**

Run:

```sh
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: FAIL because `pipeline.ts` still emits only `no eligible issue found`
and no debug skip diagnostics.

### Task 4: Emit diagnostics from the automatic-selection pipeline

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Test: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Import the diagnostic selector and rejection type**

In `src/cli/commands/run-once/pipeline.ts`, change the selection import and add
the type import:

```ts
import { selectIssue, selectIssueWithDiagnostics } from "./selection.ts";
```

Add `IssueSelectionRejection` to the existing type import from `./types.ts`.

- [ ] **Step 2: Add skip message formatting helpers**

Add these helpers near `errorMessage()`:

```ts
function rejectionMessage(reason: IssueSelectionRejection["reason"]): string {
  if (reason === "blocking-labels") return "blocking labels";
  if (reason === "non-open-state") return "non-open state";
  if (reason === "waiting-spec-approval") return "waiting for spec approval";
  if (reason === "waiting-plan-approval") return "waiting for plan approval";
  return "no actionable workflow state";
}

async function emitSelectionDiagnostics(
  rejections: IssueSelectionRejection[],
  options: RunOneIssueOptions,
): Promise<void> {
  for (const rejection of rejections) {
    await progress(
      options,
      "debug",
      "select",
      `skipped #${rejection.issueNumber}: ${rejectionMessage(rejection.reason)}`,
      { issueNumber: rejection.issueNumber, data: rejection },
    );
  }
}
```

- [ ] **Step 3: Make automatic selection use diagnostics without affecting
      explicit selection**

In `selectResumableIssue()`, replace the final automatic-selection block with:

```ts
const diagnostics = selectIssueWithDiagnostics(issues, {
  issueNumber: config.issueNumber,
  readyLabel: ready,
  triagePolicy: config.triagePolicy,
  approvalPolicy: config.approvalPolicy,
});
return diagnostics.issue
  ? { issue: diagnostics.issue, resumed: false }
  : undefined;
```

This preserves behavior but does not yet expose rejection records to
`runOneIssue()`.

- [ ] **Step 4: Emit diagnostics in `runOneIssue()` only for automatic
      no-issue**

In the `if (!issue)` block in `runOneIssue()`, replace the current final
progress event with:

```ts
if (!issue) {
  if (config.issueNumber === undefined) {
    const diagnostics = selectIssueWithDiagnostics(issues, {
      readyLabel: lifecycleLabels(config).ready,
      triagePolicy: config.triagePolicy,
      approvalPolicy: config.approvalPolicy,
    });
    await emitSelectionDiagnostics(diagnostics.rejections, options);
    await progress(
      options,
      "info",
      "select",
      `no eligible issue found after considering ${diagnostics.consideredCount} open issues; see run log for skip details`,
    );
  } else {
    await progress(options, "info", "select", "no eligible issue found");
  }
  return withLogPath({ status: "no-issue" }, options);
}
```

Do not add host calls, label edits, comments, run-state writes, worktree
creation, or Pi calls to this path.

- [ ] **Step 5: Run pipeline tests**

Run:

```sh
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the task**

```sh
git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "fix: log run-once selection skip diagnostics"
```

### Task 5: Run final validation

**Files:**

- Validate: `src/cli/commands/run-once/selection.test.ts`
- Validate: `src/cli/commands/run-once/pipeline.test.ts`
- Validate: full repository test suite

- [ ] **Step 1: Run targeted tests from the approved spec**

Run:

```sh
node --test src/cli/commands/run-once/selection.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```sh
npm test
```

Expected: PASS.

- [ ] **Step 3: Confirm AGENTS.md Nix-build rule does not apply**

Run:

```sh
git diff --name-only HEAD~2..HEAD
```

Expected: output includes only `src/cli/commands/run-once/selection.ts`,
`src/cli/commands/run-once/types.ts`,
`src/cli/commands/run-once/selection.test.ts`,
`src/cli/commands/run-once/pipeline.ts`, and
`src/cli/commands/run-once/pipeline.test.ts`; no `package.json`,
`package-lock.json`, or `npm-shrinkwrap.json` changes, so no Nix build is
required by `AGENTS.md`.

- [ ] **Step 4: Commit any validation-only fixes if needed**

If validation required fixes, commit only the fixed source/test files:

```sh
git add src/cli/commands/run-once/selection.ts src/cli/commands/run-once/types.ts src/cli/commands/run-once/selection.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "fix: stabilize run-once selection diagnostics"
```

If no fixes were needed, do not create an empty commit.

## Validation Commands

Selected according to `AGENTS.md` and the approved spec:

```sh
node --test src/cli/commands/run-once/selection.test.ts src/cli/commands/run-once/pipeline.test.ts
npm test
```

No npm dependency or lockfile changes are planned, so a Nix build is not
required unless implementation later changes `package.json`,
`package-lock.json`, or `npm-shrinkwrap.json`.

## Self-Review

- Spec coverage: The plan adds per-issue rejection details, stable reason
  identifiers, structured JSONL data, concise final info logging with issue
  count, dry-run coverage, selected-run non-regression coverage, and preserves
  explicit `--issue` behavior.
- Placeholder scan: No `TBD`, `TODO`, or unspecified test/code instructions
  remain.
- Type consistency: `IssueSelectionRejection`, `IssueSelectionDiagnostics`,
  `selectIssueWithDiagnostics()`, `workflowState`, `blockingLabels`, and
  `missingLabel` names are consistent across planned code, tests, and pipeline
  logging.
