# Improve Patchmill Init Git Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill init` consistently protects `.worktrees/` and
`.pi/todos/` and creates best-effort commits for interactive tracked git hygiene
choices.

**Architecture:** Keep init orchestration in `src/cli/commands/init/main.ts`
unchanged and concentrate git ignore/exclude mutation, staging, commit behavior,
and warning text in `src/cli/commands/init/git-policy.ts`. Add focused tests
around `applyInitGitPolicy` first, then update `runInit` integration tests for
the new committed-output flow.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, injected `CommandRunner`,
npm scripts from `package.json`.

---

## Context and Constraints

- No repository-root `AGENTS.md` was present when this plan was written
  (`find /home/roche/projects/patchmill -maxdepth 4 -name AGENTS.md -print` only
  found one under `.worktrees/patchmill-auth/`, which is outside this worktree).
  Use the validation commands below from `package.json`.
- Approved spec:
  `docs/specs/2026-06-23-issue-39-improve-patchmill-init-git-hygiene-design.md`.
- Keep issue scope limited to `patchmill init` git hygiene; do not change prompt
  choices, Pi setup, label setup, or non-interactive default policy.
- Do not commit `.pi/todos` or any `.worktrees` contents; those are local
  operator state.

## File Structure

- Modify: `src/cli/commands/init/git-policy.ts`
  - Extend existing entry constants.
  - Add a small best-effort commit helper near `applyInitGitPolicy`.
  - Route `add` and `ignore` policies through the helper while keeping `exclude`
    local-only.
  - Keep `normalEntry`, `hasEntry`, `appendEntries`, `safeRelativePath`, and
    `existingPaths` as the shared idempotent/safety layer.
- Modify: `src/cli/commands/init/git-policy.test.ts`
  - Update direct policy unit tests for new entries, commit call sequences,
    duplicate variants, no-op behavior, and non-fatal warnings.
- Modify: `src/cli/commands/init/main-git-policy.test.ts`
  - Update init-level command call expectations and output assertions from
    staged-only wording to committed/no-op wording.
- Expected no logic changes: `src/cli/commands/init/main.ts`
  - It should continue to call `selectInitGitPolicy` and `applyInitGitPolicy`
    and print the returned message.

## Validation Commands

Run targeted tests after each task that changes behavior:

```bash
node --test src/cli/commands/init/git-policy.test.ts src/cli/commands/init/main-git-policy.test.ts
```

Run the full repository suite before the final implementation commit:

```bash
npm test
```

Optional style checks before opening a PR:

```bash
npm run lint
```

---

### Task 1: Extend policy tests for new ignore entries and committed add flow

**Files:**

- Modify: `src/cli/commands/init/git-policy.test.ts`

- [ ] **Step 1: Update the recording runner if a test needs per-command
      failures**

  Add a helper alongside the existing `recordingRunner` only if later assertions
  need command-specific exit codes:

  ```ts
  function scriptedRunner(
    calls: string[][] = [],
    results: Array<{ code: number; stdout?: string; stderr?: string }> = [],
  ): CommandRunner {
    return {
      async run(command, args, options) {
        calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
        const result = results.shift() ?? { code: 0, stdout: "", stderr: "" };
        return {
          code: result.code,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        };
      },
    };
  }
  ```

- [ ] **Step 2: Change the `add` policy test to expect local artifact entries
      and a commit**

  Update
  `applyInitGitPolicy add stages config, skills, and runtime ignore entries` so
  `.gitignore` is exactly:

  ```text
  .patchmill/pi-agent
  .patchmill/runs
  .patchmill/triage-runs
  .worktrees/
  .pi/todos/
  ```

  Assert calls in this order:

  ```ts
  assert.deepEqual(calls, [
    [
      "git",
      "add",
      "-f",
      "patchmill.config.json",
      ".patchmill/skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
    [
      "git",
      "commit",
      "-m",
      "chore: initialize Patchmill",
      "--",
      "patchmill.config.json",
      ".patchmill/skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(
    result.message,
    /Patchmill config, skills, and local artifact ignore rules were committed/u,
  );
  ```

- [ ] **Step 3: Update missing-skill and custom-skill `add` tests to include
      commit calls**

  For `applyInitGitPolicy add omits missing skills directory`, assert the call
  sequence stages and commits only `patchmill.config.json` and `.gitignore`:

  ```ts
  assert.deepEqual(calls, [
    [
      "git",
      "add",
      "-f",
      "patchmill.config.json",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
    [
      "git",
      "commit",
      "-m",
      "chore: initialize Patchmill",
      "--",
      "patchmill.config.json",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  ```

  For `applyInitGitPolicy add stages provided repo-local skill roots`, assert
  the commit path list is `patchmill.config.json`, `custom-skills`,
  `.gitignore`.

- [ ] **Step 4: Add a focused assertion that force-staging still applies when
      `.patchmill/` is ignored**

  Keep `applyInitGitPolicy add force-stages skills when .patchmill is ignored`,
  but extend it so `calls[0]` begins with `git add -f` and `calls[1]` begins
  with `git commit -m chore: initialize Patchmill --`. The commit call does not
  use `-f`; only `git add` does.

- [ ] **Step 5: Run targeted tests and verify they fail for the expected
      reason**

  ```bash
  node --test src/cli/commands/init/git-policy.test.ts
  ```

  Expected before implementation: failures showing missing `.worktrees/` /
  `.pi/todos/`, missing `git commit` calls, and staged-only output.

---

### Task 2: Add direct tests for ignore, exclude, duplicate variants, no-op, and warnings

**Files:**

- Modify: `src/cli/commands/init/git-policy.test.ts`

- [ ] **Step 1: Update `ignore` policy test to expect all four entries and a
      `.gitignore`-only commit**

  Change
  `applyInitGitPolicy ignore writes patchmill.config.json and .patchmill to .gitignore`
  to expect:

  ```text
  patchmill.config.json
  .patchmill/
  .worktrees/
  .pi/todos/
  ```

  Capture `calls` and assert:

  ```ts
  assert.deepEqual(calls, [
    ["git", "add", ".gitignore", `cwd=${repoRoot}`],
    [
      "git",
      "commit",
      "-m",
      "chore: initialize Patchmill git hygiene",
      "--",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(result.message, /.gitignore git hygiene rules were committed/u);
  ```

- [ ] **Step 2: Update `exclude` policy test to expect all four entries and no
      git commands**

  Capture `calls` and assert the exclude file contains the same four entries as
  the `ignore` policy, then assert:

  ```ts
  assert.deepEqual(calls, []);
  assert.match(result.message, /Added Patchmill files to .git\/info\/exclude/u);
  ```

- [ ] **Step 3: Add an `ignore` no-op test**

  Add a new test that prewrites `.gitignore` with all required entries and
  verifies no command runner calls happen:

  ```ts
  test("applyInitGitPolicy ignore skips commit when entries already exist", async () => {
    const repoRoot = await tempRepo();
    const calls: string[][] = [];
    await writeFile(
      join(repoRoot, ".gitignore"),
      "patchmill.config.json\n.patchmill/\n.worktrees/\n.pi/todos/\n",
    );

    const result = await applyInitGitPolicy({
      repoRoot,
      policy: "ignore",
      runner: recordingRunner(calls),
    });

    assert.deepEqual(calls, []);
    assert.match(result.message, /No git hygiene commit was needed/u);
  });
  ```

- [ ] **Step 4: Extend duplicate tests for slash and root-anchored variants**

  Update or add tests so these existing lines are treated as duplicates:

  ```text
  /.worktrees/
  .worktrees
  /.pi/todos/
  .pi/todos
  ```

  Verify that `appendEntries` does not append `.worktrees/` or `.pi/todos/`
  again for `add`, `ignore`, or `exclude` policy paths.

- [ ] **Step 5: Add staging and commit failure tests**

  Add a test where `scriptedRunner` returns
  `{ code: 1, stderr: "index locked" }` for `git add`. Assert that the result
  message contains `Warning`, `git add failed`, `index locked`, and that there
  is no `git commit` call.

  Add a second test where `git add` succeeds and `git commit` returns
  `{ code: 1, stderr: "author identity unknown" }`. Assert that the result
  message contains `Warning`, `git commit failed`, and
  `author identity unknown`.

- [ ] **Step 6: Run targeted tests and verify new failures identify missing
      implementation**

  ```bash
  node --test src/cli/commands/init/git-policy.test.ts
  ```

  Expected before implementation: failures for new entries, commit behavior,
  no-op message, duplicate handling, and warning text.

---

### Task 3: Implement entry constants and the best-effort commit helper

**Files:**

- Modify: `src/cli/commands/init/git-policy.ts`

- [ ] **Step 1: Extend existing constants**

  Change constants to:

  ```ts
  export const PATCHMILL_GIT_IGNORE_ENTRIES = [
    "patchmill.config.json",
    ".patchmill/",
    ".worktrees/",
    ".pi/todos/",
  ] as const;

  export const PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES = [
    ".patchmill/pi-agent",
    ".patchmill/runs",
    ".patchmill/triage-runs",
    ".worktrees/",
    ".pi/todos/",
  ] as const;
  ```

- [ ] **Step 2: Add commit result types near helper functions**

  Add near `existingPaths`:

  ```ts
  type GitCommitOutcome =
    | { status: "committed"; paths: string[] }
    | { status: "nothing"; paths: string[] }
    | { status: "missing"; paths: string[] }
    | { status: "stage-warning"; warning: string; paths: string[] }
    | { status: "commit-warning"; warning: string; paths: string[] };
  ```

- [ ] **Step 3: Add helper functions for git output and no-op detection**

  Add these focused helpers:

  ```ts
  function gitOutput(result: { stdout: string; stderr: string }): string {
    return result.stderr || result.stdout || "unknown error";
  }

  function isNothingToCommit(output: string): boolean {
    return /nothing to commit|no changes added to commit|nothing added to commit|no changes/u.test(
      output.toLowerCase(),
    );
  }
  ```

- [ ] **Step 4: Add the path-limited commit helper**

  Add this helper near `applyInitGitPolicy`:

  ```ts
  async function commitInitGitHygiene(options: {
    repoRoot: string;
    runner: CommandRunner;
    paths: readonly string[];
    message: string;
    forceAdd?: boolean;
  }): Promise<GitCommitOutcome> {
    const paths = await existingPaths(options.repoRoot, options.paths);
    if (paths.length === 0) return { status: "missing", paths };

    const addArgs = options.forceAdd
      ? ["add", "-f", ...paths]
      : ["add", ...paths];
    const addResult = await options.runner.run("git", addArgs, {
      cwd: options.repoRoot,
    });
    if (addResult.code !== 0) {
      return {
        status: "stage-warning",
        warning: `Warning: git add failed while preparing init git hygiene commit; continuing without committing. ${gitOutput(addResult)}`,
        paths,
      };
    }

    const commitResult = await options.runner.run(
      "git",
      ["commit", "-m", options.message, "--", ...paths],
      { cwd: options.repoRoot },
    );
    if (commitResult.code === 0) return { status: "committed", paths };

    const output = gitOutput(commitResult);
    if (isNothingToCommit(output)) return { status: "nothing", paths };
    return {
      status: "commit-warning",
      warning: `Warning: git commit failed while finalizing init git hygiene; continuing. ${output}`,
      paths,
    };
  }
  ```

- [ ] **Step 5: Run policy tests and confirm only routing/message failures
      remain**

  ```bash
  node --test src/cli/commands/init/git-policy.test.ts
  ```

---

### Task 4: Route `add` and `ignore` policies through the commit helper

**Files:**

- Modify: `src/cli/commands/init/git-policy.ts`

- [ ] **Step 1: Replace the `add` branch staging-only logic**

  In the `options.policy === "add"` branch, after appending runtime entries and
  computing `skillRoots`, replace direct `git add` logic with:

  ```ts
  const commit = await commitInitGitHygiene({
    repoRoot: options.repoRoot,
    runner: options.runner,
    paths: ["patchmill.config.json", ...skillRoots, ".gitignore"],
    message: "chore: initialize Patchmill",
    forceAdd: true,
  });
  ```

- [ ] **Step 2: Format the `add` result message**

  Use the commit outcome to produce these public messages:

  ```ts
  const stagedSkills = commit.paths.some((path) => skillRoots.includes(path));
  const addSummary =
    commit.status === "committed"
      ? stagedSkills
        ? "Patchmill config, skills, and local artifact ignore rules were committed."
        : "Patchmill config and local artifact ignore rules were committed."
      : commit.status === "nothing"
        ? "No Patchmill git hygiene commit was needed."
        : commit.status === "missing"
          ? "No Patchmill files were available to commit."
          : commit.warning;
  ```

  Keep the existing ignore-entry message, updated by constants, so users can see
  whether entries were added or already present.

- [ ] **Step 3: Replace the `ignore` branch no-stage logic**

  In the `options.policy === "ignore"` branch, call the helper only when
  `added.length > 0`:

  ```ts
  if (added.length === 0) {
    return {
      policy: options.policy,
      message:
        "No git hygiene commit was needed; Patchmill files were already listed in .gitignore.",
    };
  }

  const commit = await commitInitGitHygiene({
    repoRoot: options.repoRoot,
    runner: options.runner,
    paths: [".gitignore"],
    message: "chore: initialize Patchmill git hygiene",
  });
  ```

- [ ] **Step 4: Format the `ignore` result message**

  Return one of these messages:

  ```ts
  const commitMessage =
    commit.status === "committed"
      ? ".gitignore git hygiene rules were committed."
      : commit.status === "nothing"
        ? "No git hygiene commit was needed."
        : commit.status === "missing"
          ? "Warning: .gitignore was not available to commit after init updated git hygiene rules."
          : commit.warning;
  return {
    policy: options.policy,
    message: [
      commitMessage,
      `Added Patchmill files to .gitignore:\n${formatEntries(added)}`,
    ].join("\n"),
  };
  ```

- [ ] **Step 5: Verify `exclude` remains local-only**

  Do not call `commitInitGitHygiene` from the `exclude` branch. Confirm
  `manualExcludeWarning` now includes `.worktrees/` and `.pi/todos/`
  automatically through `PATCHMILL_GIT_IGNORE_ENTRIES`.

- [ ] **Step 6: Run direct policy tests**

  ```bash
  node --test src/cli/commands/init/git-policy.test.ts
  ```

  Expected: all tests in `git-policy.test.ts` pass.

---

### Task 5: Update init-level git policy tests and verify non-fatal flow

**Files:**

- Modify: `src/cli/commands/init/main-git-policy.test.ts`
- Read-only check: `src/cli/commands/init/main.ts`

- [ ] **Step 1: Update add-to-git init tests to expect commit calls**

  For `interactive init add-to-git stages config, skills, and gitignore`, rename
  the test to mention commits and assert both `git add -f` and `git commit`
  calls. Update `.gitignore` to include:

  ```text
  .patchmill/pi-agent
  .patchmill/runs
  .patchmill/triage-runs
  .worktrees/
  .pi/todos/
  ```

  Assert output matches:

  ```ts
  assert.match(
    output,
    /Patchmill config, skills, and local artifact ignore rules were committed/u,
  );
  ```

- [ ] **Step 2: Update no-skills and path-skills init tests**

  In the no-skills test, expect commit paths `patchmill.config.json` and
  `.gitignore`, and output
  `Patchmill config and local artifact ignore rules were committed`.

  In the path-skills test, expect commit paths `patchmill.config.json`,
  `custom-skills`, and `.gitignore`, and output
  `Patchmill config, skills, and local artifact ignore rules were committed`.

- [ ] **Step 3: Update git-ignore init test**

  Rename it to mention committing `.gitignore`. Capture `calls`, assert
  `git add .gitignore` and
  `git commit -m chore: initialize Patchmill git hygiene -- .gitignore`, and
  update `.gitignore` content to:

  ```text
  patchmill.config.json
  .patchmill/
  .worktrees/
  .pi/todos/
  ```

  Assert output matches `.gitignore git hygiene rules were committed`.

- [ ] **Step 4: Update git-exclude and non-interactive tests**

  Update expected exclude file content in both tests to include `.worktrees/`
  and `.pi/todos/`. Assert no command runner calls are made for the `exclude`
  policy if the test already captures calls; otherwise add a calls array for one
  exclude case.

- [ ] **Step 5: Add an init-level non-fatal commit failure test**

  Add a runner that returns success for `git add` and failure for `git commit`:

  ```ts
  const failingCommitRunner: CommandRunner = {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      if (args[0] === "commit") {
        return { code: 1, stdout: "", stderr: "author identity unknown" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  ```

  Run `runInit` with prompt answer `1`. Assert exit code is still the Pi setup
  result from the test fixture, output includes `Warning: git commit failed`,
  output includes `author identity unknown`, and output still includes
  `Label setup skipped.` plus the Pi setup message.

- [ ] **Step 6: Run init git policy tests**

  ```bash
  node --test src/cli/commands/init/main-git-policy.test.ts
  ```

  Expected: all tests in `main-git-policy.test.ts` pass without changing
  `main.ts` orchestration.

---

### Task 6: Final validation and implementation commit

**Files:**

- Modify: `src/cli/commands/init/git-policy.ts`
- Modify: `src/cli/commands/init/git-policy.test.ts`
- Modify: `src/cli/commands/init/main-git-policy.test.ts`

- [ ] **Step 1: Run targeted tests**

  ```bash
  node --test src/cli/commands/init/git-policy.test.ts src/cli/commands/init/main-git-policy.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 2: Run the full test suite**

  ```bash
  npm test
  ```

  Expected: all repository tests pass.

- [ ] **Step 3: Run lint if time permits before handoff**

  ```bash
  npm run lint
  ```

  Expected: format, TypeScript lint, and markdown lint pass. If markdown lint
  flags this plan or another unrelated file, fix only files in this issue scope
  unless the unrelated failure blocks CI.

- [ ] **Step 4: Review the final diff for scope**

  ```bash
  git diff -- src/cli/commands/init/git-policy.ts src/cli/commands/init/git-policy.test.ts src/cli/commands/init/main-git-policy.test.ts
  git status --short
  ```

  Expected: only the three implementation/test files are modified for the
  implementation. `.pi/todos` and `.worktrees` must not be staged.

- [ ] **Step 5: Commit the implementation**

  ```bash
  git add src/cli/commands/init/git-policy.ts src/cli/commands/init/git-policy.test.ts src/cli/commands/init/main-git-policy.test.ts
  git commit -m "fix: improve init git hygiene"
  ```

  Expected: a Conventional Commit containing only this issue's implementation
  and tests.

---

## Self-Review Notes

- Spec coverage: tasks cover new `.worktrees/` and `.pi/todos/` constants,
  duplicate normalization via existing helpers, `add` commit, `ignore`
  commit/no-op, `exclude` local-only behavior, non-fatal staging/commit
  warnings, injected `CommandRunner`, and init-level output changes.
- Placeholder scan: the plan contains no `TBD`, no deferred requirements, and
  every code-oriented step includes exact snippets or commands.
- Type consistency: helper snippets use the existing `CommandRunner`,
  `CommandResult` shape (`code`, `stdout`, `stderr`), repo-relative path
  filtering through `existingPaths`, and current `InitGitPolicyResult` message
  contract.
