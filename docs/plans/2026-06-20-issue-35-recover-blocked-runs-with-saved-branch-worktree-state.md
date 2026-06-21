# Recover Blocked Runs with Saved Branch/Worktree State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `patchmill run-once --issue <n>` safely recover blocked
implementation runs that preserved useful branch/worktree state, and replace the
stale-state dead end with actionable recovery reports.

**Architecture:** Keep ordinary resumability in `run-state.ts` unchanged, and
add a focused blocked-run recovery module under `src/cli/commands/run-once/`.
The pipeline inspects blocked saved workspaces before the existing stale
branch/worktree guard; only a clean, unmerged, non-diverged saved workspace
enters the existing resume path.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, mocked `CommandRunner` Git
commands, existing Patchmill run-once pipeline and run-state JSON files.

---

## Context and Constraints

- Approved spec:
  `docs/specs/2026-06-20-issue-35-recover-blocked-runs-with-saved-branch-worktree-state-design.md`.
- No `AGENTS.md` was present at the repository root when this plan was written;
  validation commands are selected from `package.json` scripts.
- Do not implement a new `patchmill recover` command in this issue. The primary
  supported recovery path is `patchmill run-once --issue <n>`.
- Do not broaden `isResumableRunState()` to return true for all blocked states.
  Blocked state is resumable only after Git inspection returns
  `recoverable-clean`.
- Never delete, reset, overwrite, or auto-clean saved branches/worktrees.

## File Structure

- Create: `src/cli/commands/run-once/recovery.ts`
  - Owns blocked-run recovery types, Git inspection helpers, classification, and
    human-readable report formatting.
- Create: `src/cli/commands/run-once/recovery.test.ts`
  - Focused unit tests for classification and report formatting using a mocked
    `CommandRunner`.
- Modify: `src/cli/commands/run-once/pipeline.ts`
  - Calls recovery inspection before the non-resumable stale branch/worktree
    guard.
  - Allows only `recoverable-clean` blocked state to reuse saved
    checkpoints/workspace.
  - Throws `AgentIssueSafetyError` with formatted recovery reports for
    non-recoverable blocked states.
- Modify: `src/cli/commands/run-once/pipeline.test.ts`
  - Adds end-to-end run-once tests for clean blocked retry and non-recoverable
    blocked reports.
  - Keeps existing finished-state stale branch/worktree tests intact.
- Modify only if needed: `src/cli/commands/run-once/git.ts`
  - Export reusable Git helper behavior only if keeping those helpers in
    `recovery.ts` would duplicate existing code excessively.
- Modify only if needed: `src/cli/commands/run-once/run-state.test.ts`
  - Keep the existing assertion that
    `isResumableRunState({ status: "blocked" })` is false.

## Implementation Tasks

### Task 1: Add blocked recovery inspection types and Git command tests

**Files:**

- Create: `src/cli/commands/run-once/recovery.ts`
- Create: `src/cli/commands/run-once/recovery.test.ts`

- [ ] **Step 1: Write failing tests for clean, dirty, missing, merged, and
      diverged classifications**

  Add `recovery.test.ts` with mocked command responses for these scenarios:

  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { inspectBlockedRunRecovery } from "./recovery.ts";
  import type { CommandResult, CommandRunner } from "./types.ts";

  type Call = { command: string; args: string[]; cwd?: string };

  function runnerFor(
    handler: (call: Call) => CommandResult,
  ): CommandRunner & { calls: Call[] } {
    const calls: Call[] = [];
    return {
      calls,
      async run(command, args, options = {}) {
        const call = { command, args: [...args], cwd: options.cwd };
        calls.push(call);
        return handler(call);
      },
    };
  }

  const baseState = {
    issueNumber: 45,
    title: "Recover blocked run",
    status: "blocked" as const,
    branch: "agent/issue-45-recover-blocked-run",
    worktreePath: ".worktrees/patchmill-issue-45-recover-blocked-run",
    commits: ["abc123", "def456"],
    lastError: "Required verification environment is unavailable.",
    createdAt: "2026-06-20T08:00:00.000Z",
    updatedAt: "2026-06-20T08:10:00.000Z",
  };

  test("inspectBlockedRunRecovery classifies clean unmerged saved workspace as recoverable", async () => {
    const runner = runnerFor((call) => {
      if (call.args[0] === "show-ref")
        return { code: 0, stdout: "", stderr: "" };
      if (call.args.join(" ") === "worktree list --porcelain") {
        return {
          code: 0,
          stdout:
            "worktree /repo/.worktrees/patchmill-issue-45-recover-blocked-run\nbranch refs/heads/agent/issue-45-recover-blocked-run\n",
          stderr: "",
        };
      }
      if (call.args[0] === "-C" && call.args[2] === "status")
        return { code: 0, stdout: "", stderr: "" };
      if (call.args[0] === "merge-base")
        return { code: 1, stdout: "", stderr: "" };
      if (call.args[0] === "rev-list")
        return { code: 0, stdout: "0\t2\n", stderr: "" };
      if (call.args[0] === "log")
        return {
          code: 0,
          stdout: "def456 add verification\nabc123 implement feature\n",
          stderr: "",
        };
      throw new Error(`unexpected command: git ${call.args.join(" ")}`);
    });

    const report = await inspectBlockedRunRecovery({
      runner,
      repoRoot: "/repo",
      runStatePath: ".patchmill/runs/issue-45.json",
      state: baseState,
      baseRef: "main",
    });

    assert.equal(report.kind, "recoverable-clean");
    assert.equal(report.branch.exists, true);
    assert.equal(report.worktree.exists, true);
    assert.equal(report.worktree.clean, true);
    assert.deepEqual(report.divergence, { ahead: 2, behind: 0 });
  });
  ```

  Also add tests named:
  - `inspectBlockedRunRecovery classifies dirty saved worktree`
  - `inspectBlockedRunRecovery classifies already merged branch`
  - `inspectBlockedRunRecovery classifies diverged branch`
  - `inspectBlockedRunRecovery classifies missing worktree with existing branch`
  - `inspectBlockedRunRecovery classifies missing branch and worktree`

- [ ] **Step 2: Run the new test file and confirm it fails because the module
      does not exist**

  Run:

  ```bash
  node --test src/cli/commands/run-once/recovery.test.ts
  ```

  Expected: FAIL with an import/module-not-found error for `./recovery.ts`.

- [ ] **Step 3: Implement `recovery.ts` types and inspection helper**

  Implement these exported types and function signatures:

  ```ts
  import { resolve } from "node:path";
  import type { AgentIssueRunState, CommandRunner } from "./types.ts";

  export type BlockedRunRecoveryKind =
    | "recoverable-clean"
    | "dirty-worktree"
    | "already-merged"
    | "diverged"
    | "missing-worktree-existing-branch"
    | "missing-branch-or-worktree"
    | "not-blocked-recovery";

  export type BlockedRunRecoveryReport = {
    kind: BlockedRunRecoveryKind;
    runStatePath: string;
    issueNumber: number;
    title: string;
    status: AgentIssueRunState["status"];
    blockerReason?: string;
    branch: { name?: string; exists: boolean; merged: boolean };
    worktree: {
      path?: string;
      exists: boolean;
      registered: boolean;
      clean?: boolean;
      dirtyStatus?: string;
    };
    divergence?: { ahead: number; behind: number };
    commits: string[];
    recommendedActions: string[];
  };

  export async function inspectBlockedRunRecovery(input: {
    runner: CommandRunner;
    repoRoot: string;
    runStatePath: string;
    state: AgentIssueRunState;
    baseRef: string;
  }): Promise<BlockedRunRecoveryReport>;
  ```

  Classification rules:
  - Return `not-blocked-recovery` when `state.status !== "blocked"` or neither
    `state.branch` nor `state.worktreePath` is saved.
  - Run `git show-ref --verify --quiet refs/heads/<branch>` when a branch is
    saved.
  - Run `git worktree list --porcelain` and match resolved worktree paths
    against `resolve(repoRoot, state.worktreePath)`.
  - Run `git -C <worktreePath> status --porcelain=v1 --untracked-files=all` only
    when the saved worktree is registered.
  - Run `git merge-base --is-ancestor <branch> <baseRef>` to detect
    already-merged branches; exit code `0` means merged, `1` means unmerged.
  - Run `git rev-list --left-right --count <baseRef>...<branch>` and parse
    `<behind>\t<ahead>`.
  - Run `git log --oneline <baseRef>..<branch>` and prefer its lines over
    `state.commits` when available.

- [ ] **Step 4: Run focused recovery tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/recovery.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit Task 1**

  ```bash
  git add src/cli/commands/run-once/recovery.ts src/cli/commands/run-once/recovery.test.ts
  git commit -m "feat: inspect blocked run recovery state"
  ```

### Task 2: Format operator-facing recovery reports

**Files:**

- Modify: `src/cli/commands/run-once/recovery.ts`
- Modify: `src/cli/commands/run-once/recovery.test.ts`

- [ ] **Step 1: Add failing formatting tests**

  Add assertions for an exported `formatBlockedRunRecoveryReport(report)`
  helper. The clean report must include:

  ```ts
  assert.match(
    message,
    /Issue #45 has a blocked run with preserved workspace state\./,
  );
  assert.match(message, /Run state: \.patchmill\/runs\/issue-45\.json/);
  assert.match(
    message,
    /Blocked reason: Required verification environment is unavailable\./,
  );
  assert.match(
    message,
    /Saved branch: agent\/issue-45-recover-blocked-run \(exists, unmerged, ahead 2, behind 0\)/,
  );
  assert.match(
    message,
    /Saved worktree: \.worktrees\/patchmill-issue-45-recover-blocked-run \(registered, clean\)/,
  );
  assert.match(message, /def456 add verification/);
  assert.match(message, /patchmill run-once --issue 45/);
  ```

  Add separate assertions for dirty, merged, diverged, missing-worktree, and
  missing-branch reports. Each message must avoid `delete` as the first
  recommended action for unmerged work.

- [ ] **Step 2: Run formatting tests and confirm they fail**

  Run:

  ```bash
  node --test src/cli/commands/run-once/recovery.test.ts
  ```

  Expected: FAIL because `formatBlockedRunRecoveryReport` is not exported.

- [ ] **Step 3: Implement report formatting and recommendations**

  Export:

  ```ts
  export function formatBlockedRunRecoveryReport(
    report: BlockedRunRecoveryReport,
  ): string;
  ```

  Required recommendations:
  - `recoverable-clean`: retry with `patchmill run-once --issue <n>` after
    fixing the external prerequisite.
  - `dirty-worktree`: commit, stash, or clean local modifications in the saved
    worktree before retrying.
  - `already-merged`: clean/finalize stale run state after confirming the work
    is landed.
  - `diverged`: rebase or cherry-pick saved work onto the current base, then
    retry.
  - `missing-worktree-existing-branch`: reattach with
    `git worktree add <savedPath> <branch>` when the saved path is absent.
  - `missing-branch-or-worktree`: archive or remove stale run state only after
    confirming no branch/worktree needs preservation.

- [ ] **Step 4: Run focused recovery tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/recovery.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit Task 2**

  ```bash
  git add src/cli/commands/run-once/recovery.ts src/cli/commands/run-once/recovery.test.ts
  git commit -m "feat: format blocked run recovery reports"
  ```

### Task 3: Let the pipeline resume recoverable clean blocked runs

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Add a failing pipeline test for external prerequisite recovery**

  Add a test near existing stale-state tests named
  `runOneIssue resumes clean blocked implementation workspace after external prerequisite is fixed`.

  Test setup:
  - Write blocked run state for issue 45 with saved `planPath`, `branch`,
    `worktreePath`, `commits`, `validation`, `lastError`, `failureCommentKeys`,
    and checkpoints through `worktreeReady`.
  - Mock Git recovery commands to return branch exists, worktree registered,
    clean status, unmerged branch, `0\t2` divergence, and two
    `git log --oneline` lines.
  - Mock Pi implementation to return a successful direct-land or PR result
    already used by nearby pipeline tests.
  - Assert no stale branch/worktree error is thrown.
  - Assert the Pi implementation prompt receives resume context with
    `resumed: true`, `worktreeCreated: false`, and existing commit lines.
  - Assert final run state preserves saved branch/worktree and clears/advances
    blocked status.

- [ ] **Step 2: Run the targeted pipeline test and confirm it fails with the
      current stale-state error**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "resumes clean blocked implementation workspace"
  ```

  Expected: FAIL with
  `Non-resumable run state for issue #45 has stale branch/worktree`.

- [ ] **Step 3: Integrate recovery inspection before the stale guard**

  In `pipeline.ts`:
  - Import `inspectBlockedRunRecovery` and `formatBlockedRunRecoveryReport`.
  - Compute a `blockedRecoveryReport` after `existingState`, `resumed`, and
    `resumableState` are known, but before `resetStaleCheckpoints` is used to
    throw.
  - Use `runStatePath(config.runStateDir, issue.number)` for the report path.
  - Treat `blockedRecoveryReport.kind === "recoverable-clean"` as resumable for
    this run.
  - Keep `isResumableRunState(existingState)` unchanged for
    claimed/planning/implementing.

  The intended control-flow shape is:

  ```ts
  const ordinaryResumableState =
    resumed && !!existingState && isResumableRunState(existingState);
  const blockedRecoveryReport =
    resumed &&
    existingState?.status === "blocked" &&
    (existingState.branch || existingState.worktreePath)
      ? await inspectBlockedRunRecovery({
          runner,
          repoRoot: config.repoRoot,
          runStatePath: runStatePath(config.runStateDir, issue.number),
          state: existingState,
          baseRef: config.baseRef,
        })
      : undefined;
  const blockedRecoveryResumable =
    blockedRecoveryReport?.kind === "recoverable-clean";
  const resumableState = ordinaryResumableState || blockedRecoveryResumable;
  const resetStaleCheckpoints = !!existingState && !resumableState;
  ```

  If `blockedRecoveryReport` exists and is not `recoverable-clean`, throw:

  ```ts
  throw new AgentIssueSafetyError(
    formatBlockedRunRecoveryReport(blockedRecoveryReport),
  );
  ```

  before the generic stale branch/worktree guard.

- [ ] **Step 4: Ensure existing workspace reuse sees blocked recovery as
      resumed**

  When building `implemented`, validating saved branch/worktree, assigning
  `branch` and `worktreePath`, and constructing
  `AgentIssueImplementationResumeContext`, use the new `resumableState` boolean.
  Do not reset checkpoints for clean blocked recovery.

- [ ] **Step 5: Run the targeted pipeline test**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "resumes clean blocked implementation workspace"
  ```

  Expected: PASS.

- [ ] **Step 6: Commit Task 3**

  ```bash
  git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
  git commit -m "feat: resume clean blocked run workspaces"
  ```

### Task 4: Stop with recovery reports for unsafe blocked states

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify if needed: `src/cli/commands/run-once/pipeline.ts`

- [ ] **Step 1: Add failing pipeline tests for non-recoverable blocked states**

  Add tests for:
  - dirty saved worktree
  - already merged branch
  - diverged branch
  - missing worktree with existing branch
  - missing branch and missing worktree

  Each test should:
  - Write blocked run state with saved branch/worktree metadata.
  - Mock only selection, repository clean check, and recovery Git commands.
  - Assert `runOneIssue` rejects with a message containing
    `Issue #45 has a blocked run with preserved workspace state.` plus the
    scenario-specific recommendation.
  - Assert no Pi command runs.
  - Assert no labels or comments are changed before the operator resolves
    recovery.
  - Assert the run state JSON remains `status: "blocked"` and retains
    `branch`/`worktreePath` when they were saved.

- [ ] **Step 2: Run the non-recoverable blocked tests and confirm failures**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "blocked.*recovery|recovery.*blocked"
  ```

  Expected before final fixes: FAIL for any missing pipeline behavior or message
  text.

- [ ] **Step 3: Fix pipeline ordering and messages**

  Ensure recovery inspection runs before any label, comment, checkpoint reset,
  worktree creation, or Pi execution for blocked saved workspace states.
  Finished or otherwise non-blocked stale states must still use the existing
  generic stale-state guard.

- [ ] **Step 4: Run targeted non-recoverable blocked tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "blocked.*recovery|recovery.*blocked"
  ```

  Expected: PASS.

- [ ] **Step 5: Commit Task 4**

  ```bash
  git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
  git commit -m "feat: report blocked run recovery guidance"
  ```

### Task 5: Preserve blocked-run metadata during successful recovery

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify if needed: `src/cli/commands/run-once/pipeline.ts`
- Modify if needed: `src/cli/commands/run-once/run-state.ts`

- [ ] **Step 1: Add regression assertions for metadata preservation**

  Extend the clean recovery test or add a focused test to assert:
  - `specPath`, `specCommit`, `planPath`, and `planCommit` are preserved.
  - `branch` and `worktreePath` are preserved exactly from the saved blocked
    state.
  - Existing `failureCommentKeys` remain present and no duplicate blocker
    comment is posted during retry.
  - Existing `commits`/`validation` remain available until replaced by the new
    implementation result.
  - `resetCheckpoints` is not applied for clean blocked recovery.

- [ ] **Step 2: Run the regression test and confirm any failure**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "metadata.*blocked|blocked.*metadata|resumes clean blocked"
  ```

  Expected: FAIL only if metadata is accidentally dropped.

- [ ] **Step 3: Fix metadata handling minimally**

  If needed, adjust the `resumableState`, `resetStaleCheckpoints`, and
  `effectiveCheckpoints()` inputs so clean blocked recovery follows the same
  state-preservation path as ordinary resumed `implementing` runs.

- [ ] **Step 4: Run metadata tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "metadata.*blocked|blocked.*metadata|resumes clean blocked"
  ```

  Expected: PASS.

- [ ] **Step 5: Commit Task 5**

  ```bash
  git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts src/cli/commands/run-once/run-state.ts
  git commit -m "fix: preserve blocked recovery run metadata"
  ```

### Task 6: Protect existing stale-state behavior and run-state semantics

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify if needed: `src/cli/commands/run-once/run-state.test.ts`

- [ ] **Step 1: Run existing stale finished-state tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "stale finished"
  ```

  Expected: PASS. These tests should still reject stale finished branch/worktree
  state before resetting or mutating anything.

- [ ] **Step 2: Run run-state resumability tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/run-state.test.ts --test-name-pattern "isResumableRunState"
  ```

  Expected: PASS, including `blocked` remaining false.

- [ ] **Step 3: Fix regressions without broadening blocked resumability**

  If either command fails, fix only the pipeline recovery integration. Do not
  change `isResumableRunState()` to accept blocked globally.

- [ ] **Step 4: Commit Task 6 if fixes were needed**

  If files changed:

  ```bash
  git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/run-state.test.ts
  git commit -m "test: preserve stale run-state safeguards"
  ```

  If no files changed, record the passing command output in the task handoff
  instead of creating an empty commit.

### Task 7: Run the full run-once validation set

**Files:**

- No source edits expected unless validation reveals defects.

- [ ] **Step 1: Run focused run-once tests**

  Run:

  ```bash
  npm run test:run-once
  ```

  Expected: PASS.

- [ ] **Step 2: Run TypeScript and formatting/lint checks**

  Run:

  ```bash
  npm run lint
  ```

  Expected: PASS.

- [ ] **Step 3: Run the full test suite**

  Run:

  ```bash
  npm test
  ```

  Expected: PASS.

- [ ] **Step 4: Fix any validation failures and commit**

  If validation required source/test edits:

  ```bash
  git add src/cli/commands/run-once/recovery.ts src/cli/commands/run-once/recovery.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts src/cli/commands/run-once/run-state.test.ts
  git commit -m "fix: stabilize blocked run recovery validation"
  ```

  If no edits were needed, do not create an empty commit.

### Task 8: Final acceptance review

**Files:**

- No source edits expected unless acceptance review reveals a missed
  requirement.

- [ ] **Step 1: Verify acceptance criteria manually against the implementation**

  Check that:
  - Clean blocked branch/worktree state can be retried through
    `patchmill run-once --issue <n>`.
  - Generic stale branch/worktree output is not used for blocked saved workspace
    states.
  - Recovery output includes blocker reason, run-state path, saved branch, saved
    worktree, and commits.
  - Dirty, merged, diverged, missing-worktree/existing-branch, and
    missing-branch/worktree cases are tested.
  - Finished stale states still refuse to reset or overwrite unmerged saved
    work.

- [ ] **Step 2: Review destructive-action language**

  Search recovery output tests and implementation:

  ```bash
  rg -n "delete|remove|reset|clean up|archive|worktree add|cherry-pick|rebase" src/cli/commands/run-once/recovery.ts src/cli/commands/run-once/recovery.test.ts src/cli/commands/run-once/pipeline.test.ts
  ```

  Expected: Any destructive wording is guarded by preserve/archive language and
  is not the first recommendation for unmerged saved work.

- [ ] **Step 3: Commit any final acceptance fixes**

  If files changed:

  ```bash
  git add src/cli/commands/run-once/recovery.ts src/cli/commands/run-once/recovery.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
  git commit -m "fix: complete blocked run recovery acceptance cases"
  ```

  If no files changed, record acceptance review notes in the handoff.

## Validation Commands

Use these commands before final handoff:

```bash
node --test src/cli/commands/run-once/recovery.test.ts
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "blocked.*recovery|recovery.*blocked|resumes clean blocked|stale finished"
node --test src/cli/commands/run-once/run-state.test.ts --test-name-pattern "isResumableRunState"
npm run test:run-once
npm run lint
npm test
```

## Self-Review Notes

- Spec coverage: The tasks cover recovery inspection, classifications, safe
  clean retry through `run-once`, formatted reports, metadata preservation, and
  tests for every required workspace state.
- Placeholder scan: No task uses TBD-style placeholders; implementation
  signatures, command names, and expected test behavior are explicit.
- Type consistency: The plan uses `BlockedRunRecoveryKind`,
  `BlockedRunRecoveryReport`, `inspectBlockedRunRecovery`, and
  `formatBlockedRunRecoveryReport` consistently across tests, implementation,
  and pipeline integration.
