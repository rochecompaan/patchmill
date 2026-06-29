# PR Handoff Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a successful `pr-created` handoff, Patchmill prompts PR bodies
to close the issue and removes only the local issue worktree and local branch
while preserving remote PR branches and `.patchmill/runs` audit state.

**Architecture:** Add the closing-keyword instruction at the existing PR
fallback prompt boundary, add a structured Git cleanup helper in the run-once
Git helper module, then call that helper after the existing successful PR
handoff has been recorded, commented, labeled done, progress-reported, and
cleanup hooks have run. Cleanup reports structured progress but never throws
into the successful PR result path.

**Tech Stack:** TypeScript on Node.js 22, built-in `node:test`, existing
`CommandRunner`, run-once pipeline/run-state/progress helpers, Git CLI commands.

---

## File Structure

- Modify `src/cli/commands/run-once/prompts.ts`
  - Change `renderPrCreationInstruction()` to accept the issue number and append
    `Include \`Closes #NUMBER\` in the pull request description/body.`
  - Pass `issueNumber` through every PR fallback instruction path in
    `renderLandingResultContracts()`.
- Modify `src/cli/commands/run-once/prompts.test.ts`
  - Update existing PR fallback assertions and add explicit assertions that
    generated implementation prompts include `Closes #42`.
- Modify `src/cli/commands/run-once/git.ts`
  - Export structured cleanup result types and `cleanupIssueWorkspace()`.
  - Run only `git worktree remove WORKTREE_PATH` and, after success,
    `git branch -D BRANCH` from the repository root.
- Modify `src/cli/commands/run-once/git.test.ts`
  - Add unit tests for successful cleanup, skipped branch deletion after
    worktree removal failure, branch deletion failure reporting, and no remote
    deletion command invocation.
- Modify `src/cli/commands/run-once/pipeline.ts`
  - Import and call `cleanupIssueWorkspace()` only for
    `implemented.status === "pr-created"` after final state and existing PR
    progress reporting.
  - Keep configured cleanup hook behavior before built-in worktree removal.
  - Emit cleanup success as info and cleanup failure as error without changing
    the returned `pr-created` result.
- Modify `src/cli/commands/run-once/pipeline.test.ts`
  - Add/adjust integration tests for PR cleanup sequencing, failure tolerance,
    no built-in cleanup for `merged`, and final run state retaining
    `branch`/`worktreePath`.

---

### Task 1: Prompt PR Bodies to Close the Issue

**Files:**

- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/prompts.test.ts`

- [ ] **Step 1: Update prompt tests first**

Add focused assertions to the existing implementation prompt tests that
currently match the PR fallback sentence. For the disabled-direct-land test,
update the assertion to:

```ts
assert.match(
  prompt,
  /Push the branch to `origin` and open a pull request using the repository's configured host tooling\. Include `Closes #42` in the pull request description\/body\./,
);
```

Also add the same assertion to the
`buildImplementationPrompt includes plan-first execution, review loop, validation rules, and result contracts`
test so both direct-land-fallback and direct-land-disabled prompt paths are
covered.

- [ ] **Step 2: Run prompt tests and verify the new assertions fail**

Run:

```sh
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: FAIL because the prompt currently ends PR fallback guidance after
`configured host tooling.` and does not include `Closes #42`.

- [ ] **Step 3: Update the PR creation instruction renderer**

In `src/cli/commands/run-once/prompts.ts`, replace the existing helper with:

```ts
function renderPrCreationInstruction(
  remote: string,
  issueNumber: number,
): string {
  return `Push the branch to \`${remote}\` and open a pull request using the repository's configured host tooling. Include \`Closes #${issueNumber}\` in the pull request description/body.`;
}
```

Then update `renderLandingResultContracts()` so it calls:

```ts
const prInstruction = renderPrCreationInstruction(remote, issueNumber);
```

Do not add `Closes #NUMBER` to the JSON final response contract; it belongs in
the host PR body.

- [ ] **Step 4: Run prompt tests and verify they pass**

Run:

```sh
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```sh
git add src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts
git commit -m "feat: prompt pr bodies to close issues"
```

---

### Task 2: Add Structured Local Issue Workspace Cleanup Helper

**Files:**

- Modify: `src/cli/commands/run-once/git.ts`
- Modify: `src/cli/commands/run-once/git.test.ts`

- [ ] **Step 1: Add failing Git cleanup helper tests**

In `src/cli/commands/run-once/git.test.ts`, add `cleanupIssueWorkspace` to the
import list from `./git.ts`, then append tests like these:

```ts
test("cleanupIssueWorkspace removes the local worktree then local branch", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  const results = await cleanupIssueWorkspace(runner, "/repo", {
    branch: "agent/issue-42-add-user-tags",
    worktreePath: ".worktrees/patchmill-issue-42-add-user-tags",
  });

  assert.deepEqual(
    results.map((result) => result.status),
    ["cleaned", "cleaned"],
  );
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "worktree",
        "remove",
        ".worktrees/patchmill-issue-42-add-user-tags",
      ],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["branch", "-D", "agent/issue-42-add-user-tags"],
      cwd: "/repo",
    },
  ]);
});

test("cleanupIssueWorkspace skips local branch deletion when worktree removal fails", async () => {
  const runner = createStaticCommandRunner([
    { code: 128, stdout: "", stderr: "fatal: worktree is dirty" },
  ]);

  const results = await cleanupIssueWorkspace(runner, "/repo", {
    branch: "agent/issue-42-add-user-tags",
    worktreePath: ".worktrees/patchmill-issue-42-add-user-tags",
  });

  assert.deepEqual(
    results.map((result) => result.status),
    ["failed"],
  );
  assert.match(results[0]?.message ?? "", /git worktree remove failed/);
  assert.equal(results[0]?.stdout, "");
  assert.equal(results[0]?.stderr, "fatal: worktree is dirty");
  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [["worktree", "remove", ".worktrees/patchmill-issue-42-add-user-tags"]],
  );
});

test("cleanupIssueWorkspace reports branch deletion failures without throwing", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 1, stdout: "", stderr: "error: branch not found" },
  ]);

  const results = await cleanupIssueWorkspace(runner, "/repo", {
    branch: "agent/issue-42-add-user-tags",
    worktreePath: ".worktrees/patchmill-issue-42-add-user-tags",
  });

  assert.deepEqual(
    results.map((result) => result.status),
    ["cleaned", "failed"],
  );
  assert.equal(results[1]?.step, "branch");
  assert.match(results[1]?.message ?? "", /git branch -D failed/);
});
```

Add a no-remote-deletion assertion either in the success test or as a separate
test:

```ts
assert.equal(
  runner.calls.some((call) => call.args.includes("push")),
  false,
);
assert.equal(
  runner.calls.some((call) => call.args.includes("--delete")),
  false,
);
```

- [ ] **Step 2: Run Git tests and verify the helper is missing**

Run:

```sh
node --test src/cli/commands/run-once/git.test.ts
```

Expected: FAIL with an import/export or `cleanupIssueWorkspace` missing error.

- [ ] **Step 3: Implement result types and helper**

In `src/cli/commands/run-once/git.ts`, add the exported types near the other
worktree types:

```ts
export type CleanupIssueWorkspaceStep = "worktree" | "branch";

export type CleanupIssueWorkspaceResult = {
  step: CleanupIssueWorkspaceStep;
  status: "cleaned" | "failed";
  message: string;
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  code: number;
};
```

Then add this helper before `pushBranch()`:

```ts
function cleanupResult(config: {
  step: CleanupIssueWorkspaceStep;
  successMessage: string;
  failureMessage: string;
  command: string;
  args: string[];
  cwd: string;
  result: CommandResult;
}): CleanupIssueWorkspaceResult {
  const status = config.result.code === 0 ? "cleaned" : "failed";
  return {
    step: config.step,
    status,
    message:
      status === "cleaned"
        ? config.successMessage
        : `${config.failureMessage} with exit code ${config.result.code}`,
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    stdout: config.result.stdout,
    stderr: config.result.stderr,
    code: config.result.code,
  };
}

export async function cleanupIssueWorkspace(
  runner: CommandRunner,
  repoRoot: string,
  workspace: { branch: string; worktreePath: string },
): Promise<CleanupIssueWorkspaceResult[]> {
  const worktreeArgs = ["worktree", "remove", workspace.worktreePath];
  const worktreeResult = await runner.run("git", worktreeArgs, {
    cwd: repoRoot,
  });
  const results: CleanupIssueWorkspaceResult[] = [
    cleanupResult({
      step: "worktree",
      successMessage: `removed local worktree ${workspace.worktreePath}`,
      failureMessage: `git worktree remove failed for ${workspace.worktreePath}`,
      command: "git",
      args: worktreeArgs,
      cwd: repoRoot,
      result: worktreeResult,
    }),
  ];

  if (worktreeResult.code !== 0) return results;

  const branchArgs = ["branch", "-D", workspace.branch];
  const branchResult = await runner.run("git", branchArgs, { cwd: repoRoot });
  results.push(
    cleanupResult({
      step: "branch",
      successMessage: `deleted local branch ${workspace.branch}`,
      failureMessage: `git branch -D failed for ${workspace.branch}`,
      command: "git",
      args: branchArgs,
      cwd: repoRoot,
      result: branchResult,
    }),
  );

  return results;
}
```

Keep the helper free of `git push`, `git push --delete`, host APIs, direct
filesystem deletion, and any `.patchmill/runs` writes.

- [ ] **Step 4: Run Git tests and verify they pass**

Run:

```sh
node --test src/cli/commands/run-once/git.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```sh
git add src/cli/commands/run-once/git.ts src/cli/commands/run-once/git.test.ts
git commit -m "feat: add pr handoff workspace cleanup helper"
```

---

### Task 3: Integrate Built-in Cleanup After Successful PR Handoff

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Add or update pipeline tests for successful PR cleanup
      sequencing**

Use the existing saved-implementation and cleanup-hook test patterns around
`runOneIssue runs configured cleanup hook script`. Add a test that returns/saves
`pr-created`, then asserts the Git calls include the built-in cleanup after the
existing handoff/reporting path:

```ts
const cleanupGitCalls = runner.calls.filter(
  (call) =>
    call.command === "git" &&
    (call.args[0] === "worktree" || call.args[0] === "branch") &&
    (call.args.includes("remove") || call.args.includes("-D")),
);
assert.deepEqual(
  cleanupGitCalls.map((call) => call.args),
  [
    ["worktree", "remove", worktreePath],
    ["branch", "-D", "agent/issue-45-cleanup-example"],
  ],
);
```

When `cleanupHook` is configured, assert the hook command index is less than the
`git worktree remove` index so hook compatibility is preserved:

```ts
const hookIndex = runner.calls.findIndex(
  (call) => call.command === "bash" && call.args[0] === cleanupHook,
);
const worktreeRemoveIndex = runner.calls.findIndex(
  (call) =>
    call.command === "git" &&
    call.args.join(" ") === `worktree remove ${worktreePath}`,
);
assert.ok(hookIndex >= 0);
assert.ok(worktreeRemoveIndex > hookIndex);
```

Also assert cleanup progress events include info-level success messages for both
steps.

- [ ] **Step 2: Add pipeline tests for failure tolerance and merged exclusion**

Add one `pr-created` test where `git worktree remove` returns non-zero. Assert:

```ts
assert.equal(result.status, "pr-created");
assert.ok(
  events.some(
    (event) =>
      event.stage === "cleanup" &&
      event.level === "error" &&
      /git worktree remove failed/.test(event.message),
  ),
);
assert.equal(
  runner.calls.some(
    (call) =>
      call.command === "git" &&
      call.args[0] === "branch" &&
      call.args[1] === "-D",
  ),
  false,
);
```

Add one `merged` test or extend an existing merged-path test to assert no
built-in cleanup calls are made:

```ts
assert.equal(
  runner.calls.some(
    (call) =>
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "remove",
  ),
  false,
);
assert.equal(
  runner.calls.some(
    (call) =>
      call.command === "git" &&
      call.args[0] === "branch" &&
      call.args[1] === "-D",
  ),
  false,
);
```

Add a run-state assertion that the final state still has the original audit
fields:

```ts
const state = JSON.parse(
  await readFile(runStatePath(config.runStateDir, 45), "utf8"),
);
assert.equal(state.branch, "agent/issue-45-cleanup-example");
assert.equal(state.worktreePath, worktreePath);
```

- [ ] **Step 3: Run pipeline tests and verify the cleanup expectations fail**

Run:

```sh
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: FAIL because `pipeline.ts` does not yet call the built-in cleanup
helper.

- [ ] **Step 4: Import the helper and report cleanup results**

In `src/cli/commands/run-once/pipeline.ts`, add `cleanupIssueWorkspace` to the
import from `./git.ts`:

```ts
import {
  assertCleanWorktree,
  assertIssueBaseContainedInPrBase,
  cleanStatusIgnoredPaths as buildCleanStatusIgnoredPaths,
  cleanupIssueWorkspace,
  ensureIssueWorktree,
} from "./git.ts";
```

After the existing configured cleanup hook loop, add:

```ts
if (implemented.status === "pr-created") {
  const workspaceCleanupResults = await cleanupIssueWorkspace(
    runner,
    config.repoRoot,
    { branch, worktreePath },
  );
  for (const cleanup of workspaceCleanupResults) {
    await progress(
      options,
      cleanup.status === "failed" ? "error" : "info",
      "cleanup",
      cleanup.message,
      {
        issueNumber: issue.number,
        data: {
          step: cleanup.step,
          status: cleanup.status,
          command: cleanup.command,
          args: cleanup.args,
          cwd: cleanup.cwd,
          code: cleanup.code,
          stdout: cleanup.stdout,
          stderr: cleanup.stderr,
        },
      },
    );
  }
}
```

Place this block after `runCleanupHookScript()` so configured hooks still
execute from the issue worktree, and before `runStep(\`final result
${implemented.status}\`, ...)`. Do not wrap it in throwing error handling; the
helper returns structured failures.

- [ ] **Step 5: Run pipeline tests and verify they pass**

Run:

```sh
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit this task**

```sh
git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "feat: clean local workspace after pr handoff"
```

---

### Task 4: Run Targeted Integration Verification

**Files:**

- Verify: `src/cli/commands/run-once/git.test.ts`
- Verify: `src/cli/commands/run-once/prompts.test.ts`
- Verify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Run the spec-selected targeted tests**

Run:

```sh
node --test src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Inspect command coverage for destructive remote actions**

Run:

```sh
rg -n "push --delete|--delete|git push|\.patchmill/runs|rm -rf|unlink|rm\(" src/cli/commands/run-once/git.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: No new cleanup helper or pipeline integration code invokes remote
branch deletion, host PR APIs, force-push, direct `.patchmill/runs` deletion, or
ad-hoc filesystem deletion. Existing unrelated references, if any, should be
reviewed and noted in the task todo validation notes.

- [ ] **Step 3: Commit any test-only fixes from targeted verification**

If the previous steps required fixes, commit them:

```sh
git add src/cli/commands/run-once/git.ts src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "test: verify pr handoff cleanup"
```

If no fixes were required, do not create an empty commit; record
`node --test ...` and `rg ...` results in the task todo.

---

### Task 5: Run Final Validation and Prepare PR Handoff

**Files:**

- Verify: repository test suite and working tree

- [ ] **Step 1: Run the full test suite required by the spec and AGENTS.md**

Run:

```sh
npm test
```

Expected: PASS.

No npm dependency or lockfile changes are planned for this issue, so AGENTS.md
does not require a Nix build. If implementation unexpectedly changes
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json`, also run the
repository Nix build before handoff and document it in validation.

- [ ] **Step 2: Check formatting/lint-sensitive diffs**

Run:

```sh
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 3: Confirm only intended files changed**

Run:

```sh
git status --short
```

Expected: only intentional source/test changes are present before the final
implementation commit or PR handoff; `.pi/todos` must not be staged or
committed.

- [ ] **Step 4: Commit final validation fixes if needed**

If final validation required fixes, commit them with a Conventional Commit
message such as:

```sh
git add src/cli/commands/run-once/git.ts src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "fix: stabilize pr handoff cleanup"
```

If no fixes were required, do not create an empty commit.

- [ ] **Step 5: Manual disposable-repository verification before merge**

When credentials and a disposable repository are available, process an issue
through PR handoff and then run:

```sh
git worktree list --porcelain
git show-ref --verify refs/heads/<issue-branch>
git ls-remote --heads origin <issue-branch>
ls .patchmill/runs
```

Expected: the local worktree is absent,
`git show-ref --verify refs/heads/<issue-branch>` exits non-zero because the
local branch is absent, the remote branch still exists, and run logs/run state
remain available.

---

## Validation Commands

Use these exact commands for implementation validation:

```sh
node --test src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts
npm test
git diff --check
```

AGENTS.md only adds a Nix-build requirement when npm dependencies change. This
plan does not include dependency or lockfile changes, so no Nix build is
required unless implementation changes `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json`.
