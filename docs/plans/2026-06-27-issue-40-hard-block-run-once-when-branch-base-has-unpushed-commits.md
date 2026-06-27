# Hard-Block Run-Once Unsafe Branch Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill run-once` fail before any mutation when the configured
issue branch base contains commits not present in the configured PR target base.

**Architecture:** Add one focused git safety helper in the existing run-once git
module, then call it immediately after issue selection and before dry-run
success or mutating safety gates. Keep the existing top-level error JSON shape
by throwing actionable `Error`s from the preflight helper.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node:test`), existing
`CommandRunner` abstraction, git CLI, Markdown docs.

---

## File Structure

- Modify `src/cli/commands/run-once/git.ts`
  - Export
    `assertIssueBaseContainedInPrBase(runner, repoRoot, baseRef, remote, baseBranch)`.
  - Resolve both refs with `git rev-parse --verify <ref>^{commit}`.
  - Detect leaking commits with `git log --oneline <targetRef>..<baseRef>`.
  - Reuse the local `formatCommandFailure()` style for failed git commands.
- Modify `src/cli/commands/run-once/git.test.ts`
  - Add unit coverage for command sequencing, clean containment, leaked commits,
    missing target refs, bad local base refs, and non-default target refs.
- Modify `src/cli/commands/run-once/pipeline.ts`
  - Import and invoke the helper after an issue is selected and progress has
    recorded selection, before the dry-run return, before
    `assertCleanWorktree()`, before claims/comments/run-state/worktree/Pi.
- Modify `src/cli/commands/run-once/pipeline.test.ts`
  - Add orchestration tests proving the preflight runs in clean execute and
    dry-run paths, unsafe bases throw before any mutation, no eligible issue
    skips the preflight, and configured remote/base branch are honored.
- Modify `docs/issue-agent-workflows.md`
  - Document run-once preflight ordering and why it blocks before claiming an
    issue.
- Modify `docs/configuration.md`
  - Document target base derivation, why `git.baseRef: "HEAD"` can be unsafe,
    and how operators fix failures.

---

## Task 1: Add git-helper unit tests for branch-base containment

**Files:**

- Modify: `src/cli/commands/run-once/git.test.ts`

- [ ] **Step 1: Import the new helper in the git test file**

Update the import from `./git.ts` so this symbol is included:

```ts
import {
  assertCleanWorktree,
  assertIssueBaseContainedInPrBase,
  buildIssueBranchName,
  buildIssueWorktreePath,
  createIssueWorktree,
  ensureIssueWorktree,
  pushBranch,
} from "./git.ts";
```

- [ ] **Step 2: Add the clean containment test before the existing
      `assertCleanWorktree` tests**

```ts
test("assertIssueBaseContainedInPrBase accepts a base contained in the target remote ref", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    { code: 0, stdout: "target-sha\n", stderr: "" },
    { code: 0, stdout: "\n", stderr: "" },
  ]);

  await assertIssueBaseContainedInPrBase(
    runner,
    "/repo",
    "HEAD",
    "origin",
    "main",
  );

  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["rev-parse", "--verify", "HEAD^{commit}"],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["log", "--oneline", "refs/remotes/origin/main..HEAD"],
      cwd: "/repo",
    },
  ]);
});
```

- [ ] **Step 3: Add the leaked commits failure test**

```ts
test("assertIssueBaseContainedInPrBase rejects commits that are not in the target remote ref", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    { code: 0, stdout: "target-sha\n", stderr: "" },
    {
      code: 0,
      stdout:
        "abc1234 chore: initialize Patchmill\ndef5678 docs: local setup\n",
      stderr: "",
    },
  ]);

  await assert.rejects(
    () =>
      assertIssueBaseContainedInPrBase(
        runner,
        "/repo",
        "HEAD",
        "origin",
        "main",
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /Configured git\.baseRef HEAD is not contained in refs\/remotes\/origin\/main\./,
      );
      assert.match(error.message, /abc1234 chore: initialize Patchmill/);
      assert.match(error.message, /def5678 docs: local setup/);
      assert.match(
        error.message,
        /Push or merge these commits into origin\/main/,
      );
      assert.match(
        error.message,
        /configure git\.baseRef to a ref already contained/,
      );
      return true;
    },
  );
});
```

- [ ] **Step 4: Add failure tests for bad base refs and missing remote-tracking
      refs**

```ts
test("assertIssueBaseContainedInPrBase reports an unresolvable configured base ref", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 128,
      stdout: "",
      stderr: "fatal: Needed a single revision",
    },
  ]);

  await assert.rejects(
    () =>
      assertIssueBaseContainedInPrBase(
        runner,
        "/repo",
        "not-a-ref",
        "origin",
        "main",
      ),
    /Configured git\.baseRef not-a-ref could not be resolved to a commit with exit code 128: fatal: Needed a single revision/,
  );
});

test("assertIssueBaseContainedInPrBase reports a missing target remote ref with remediation", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    {
      code: 128,
      stdout: "",
      stderr: "fatal: Needed a single revision",
    },
  ]);

  await assert.rejects(
    () =>
      assertIssueBaseContainedInPrBase(
        runner,
        "/repo",
        "HEAD",
        "origin",
        "main",
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /Configured PR target base refs\/remotes\/origin\/main could not be resolved to a commit/,
      );
      assert.match(error.message, /Run git fetch origin/);
      assert.match(error.message, /git\.remote/);
      assert.match(error.message, /git\.baseBranch/);
      return true;
    },
  );
});
```

- [ ] **Step 5: Add a configured target ref test**

```ts
test("assertIssueBaseContainedInPrBase uses configured remote and base branch", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    { code: 0, stdout: "target-sha\n", stderr: "" },
    { code: 0, stdout: "\n", stderr: "" },
  ]);

  await assertIssueBaseContainedInPrBase(
    runner,
    "/repo",
    "refs/remotes/upstream/release/1.2",
    "upstream",
    "release/1.2",
  );

  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [
      ["rev-parse", "--verify", "refs/remotes/upstream/release/1.2^{commit}"],
      ["rev-parse", "--verify", "refs/remotes/upstream/release/1.2^{commit}"],
      [
        "log",
        "--oneline",
        "refs/remotes/upstream/release/1.2..refs/remotes/upstream/release/1.2",
      ],
    ],
  );
});
```

- [ ] **Step 6: Run the focused git tests and confirm they fail because the
      helper is not implemented yet**

Run:

```sh
node --test src/cli/commands/run-once/git.test.ts
```

Expected: FAIL with a TypeScript/module error or assertion failure indicating
`assertIssueBaseContainedInPrBase` is missing.

---

## Task 2: Implement the git safety helper

**Files:**

- Modify: `src/cli/commands/run-once/git.ts`

- [ ] **Step 1: Add small helper functions near `formatCommandFailure()`**

```ts
function issueBaseTargetRef(remote: string, baseBranch: string): string {
  return `refs/remotes/${remote}/${baseBranch}`;
}

async function verifyCommitRef(
  runner: CommandRunner,
  repoRoot: string,
  ref: string,
  failure: string,
): Promise<void> {
  const result = await runner.run(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(formatCommandFailure(failure, result));
  }
}
```

- [ ] **Step 2: Add and export `assertIssueBaseContainedInPrBase()` after
      `assertCleanWorktree()`**

```ts
export async function assertIssueBaseContainedInPrBase(
  runner: CommandRunner,
  repoRoot: string,
  baseRef: string,
  remote: string,
  baseBranch: string,
): Promise<void> {
  const targetRef = issueBaseTargetRef(remote, baseBranch);

  await verifyCommitRef(
    runner,
    repoRoot,
    baseRef,
    `Configured git.baseRef ${baseRef} could not be resolved to a commit`,
  );
  await verifyCommitRef(
    runner,
    repoRoot,
    targetRef,
    `Configured PR target base ${targetRef} could not be resolved to a commit. Run git fetch ${remote}, or fix git.remote/git.baseBranch`,
  );

  const result = await runner.run(
    "git",
    ["log", "--oneline", `${targetRef}..${baseRef}`],
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(
      formatCommandFailure(
        `git log failed while checking whether git.baseRef ${baseRef} is contained in ${targetRef}`,
        result,
      ),
    );
  }

  const leakedCommits = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (leakedCommits.length === 0) return;

  throw new Error(
    [
      `Configured git.baseRef ${baseRef} is not contained in ${targetRef}.`,
      `These commits would be included in the issue PR:`,
      ...leakedCommits,
      ``,
      `Push or merge these commits into ${remote}/${baseBranch}, run git fetch if the remote ref is stale, or configure git.baseRef to a ref already contained in ${targetRef}.`,
    ].join("\n"),
  );
}
```

- [ ] **Step 3: Run the focused git tests**

Run:

```sh
node --test src/cli/commands/run-once/git.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the git helper and unit tests**

```sh
git add src/cli/commands/run-once/git.ts src/cli/commands/run-once/git.test.ts
git commit -m "feat: guard run-once issue base containment"
```

---

## Task 3: Add run-once pipeline preflight orchestration tests

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Add a reusable git preflight responder near the existing test
      helpers**

```ts
function gitBaseContainmentResult(call: Call): CommandResult | undefined {
  if (call.command !== "git") return undefined;
  if (call.args[0] === "rev-parse" && call.args[1] === "--verify") {
    return { code: 0, stdout: "commit-sha\n", stderr: "" };
  }
  if (call.args[0] === "log" && call.args[1] === "--oneline") {
    return { code: 0, stdout: "", stderr: "" };
  }
  return undefined;
}

function gitBaseContainmentFailure(call: Call): CommandResult | undefined {
  if (call.command !== "git") return undefined;
  if (call.args[0] === "rev-parse" && call.args[1] === "--verify") {
    return { code: 0, stdout: "commit-sha\n", stderr: "" };
  }
  if (call.args[0] === "log" && call.args[1] === "--oneline") {
    return {
      code: 0,
      stdout: "abc1234 chore: initialize Patchmill\n",
      stderr: "",
    };
  }
  return undefined;
}
```

- [ ] **Step 2: Update new tests to return `gitBaseContainmentResult(call)`
      before other git defaults**

When adding tests in this task, put this at the top of each mock handler after
issue-host command handling as appropriate:

```ts
const preflight = gitBaseContainmentResult(call);
if (preflight) return preflight;
```

For unsafe-base tests, use:

```ts
const preflight = gitBaseContainmentFailure(call);
if (preflight) return preflight;
```

- [ ] **Step 3: Add a dry-run safety failure test near existing dry-run tests**

```ts
test("runOneIssue dry-run blocks when the configured issue base is ahead of the target PR base", async () => {
  const config = await makeConfig();
  const selected = issue(45, ["agent-ready"], "Unsafe base");
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args.includes("issues")) {
      return { code: 0, stdout: issueListPayload([selected]), stderr: "" };
    }
    const preflight = gitBaseContainmentFailure(call);
    if (preflight) return preflight;
    return { code: 0, stdout: "", stderr: "" };
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Configured git\.baseRef HEAD is not contained in refs\/remotes\/origin\/main/,
  );

  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "status",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args.includes("labels"),
    ),
    false,
  );
});
```

- [ ] **Step 4: Add an execute-mode unsafe-base test proving no mutation
      occurs**

```ts
test("runOneIssue execute blocks unsafe issue base before claim, comments, run state, worktree, or Pi", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(45, ["agent-ready"], "Unsafe base");
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args.includes("issues")) {
      return { code: 0, stdout: issueListPayload([selected]), stderr: "" };
    }
    const preflight = gitBaseContainmentFailure(call);
    if (preflight) return preflight;
    return { code: 0, stdout: "", stderr: "" };
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /abc1234 chore: initialize Patchmill/);
      return true;
    },
  );

  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "status",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    false,
  );
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args.includes("comment"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args.includes("labels"),
    ),
    false,
  );
  await assert.rejects(
    () => readFile(runStatePath(config.runStateDir, selected.number), "utf8"),
    /ENOENT/,
  );
});
```

- [ ] **Step 5: Add a no-issue skip test**

```ts
test("runOneIssue skips base containment preflight when no eligible issue exists", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args.includes("issues")) {
      return { code: 0, stdout: issueListPayload([]), stderr: "" };
    }
    throw new Error(
      `unexpected command ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.deepEqual(result, { status: "no-issue" });
  assert.equal(
    runner.calls.some((call) => call.command === "git"),
    false,
  );
});
```

- [ ] **Step 6: Add a configured remote/base branch pipeline assertion to an
      existing custom-strategy test**

In
`runOneIssue uses the configured worktree strategy for workspace names and prompt instructions`,
ensure the mock handles the preflight and add an assertion that the target ref
is built from the custom config:

```ts
assert.ok(
  runner.calls.some(
    (call) =>
      call.command === "git" &&
      call.args.join(" ") ===
        "rev-parse --verify refs/remotes/upstream/release/1.2^{commit}",
  ),
);
assert.ok(
  runner.calls.some(
    (call) =>
      call.command === "git" &&
      call.args.join(" ") ===
        "log --oneline refs/remotes/upstream/release/1.2..refs/remotes/upstream/release/1.2",
  ),
);
```

- [ ] **Step 7: Run the focused pipeline tests and confirm they fail before
      wiring the helper**

Run:

```sh
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: FAIL because the new preflight is not called yet or existing tests
need their mock git handlers updated for the new preflight commands.

---

## Task 4: Wire the preflight into `runOneIssue()` and update affected test mocks

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Import the helper in `pipeline.ts`**

```ts
import {
  assertCleanWorktree,
  assertIssueBaseContainedInPrBase,
  cleanStatusIgnoredPaths as buildCleanStatusIgnoredPaths,
  ensureIssueWorktree,
} from "./git.ts";
```

- [ ] **Step 2: Call the helper after selected-issue progress and before the
      dry-run return**

Insert this block immediately after the existing
`await progress(... "selected" ...)` call and before `if (config.dryRun) {`:

```ts
await progress(
  options,
  "info",
  "git",
  "checking issue branch base containment",
  { issueNumber: issue.number },
);
await assertIssueBaseContainedInPrBase(
  runner,
  config.repoRoot,
  config.baseRef,
  config.remote,
  config.baseBranch,
);
```

- [ ] **Step 3: Keep the existing clean-worktree check after dry-run**

Do not remove this existing execute-mode gate:

```ts
await progress(options, "info", "git", "checking repository status", {
  issueNumber: issue.number,
});
await assertCleanWorktree(runner, config.repoRoot, ignoredPaths);
```

The new containment check must run before it; `--dry-run` must run containment
but must not run worktree cleanliness.

- [ ] **Step 4: Update existing pipeline test mock handlers for the new git
      commands**

For tests that currently return special results for `git status`,
`git worktree`, `git log`, `git show-ref`, or `git branch`, make sure the
handler checks containment commands before broader `git log` handlers. Use this
pattern:

```ts
const preflight = gitBaseContainmentResult(call);
if (preflight) return preflight;
```

Place it before branches like:

```ts
if (call.command === "git" && call.args[0] === "log") {
  return { code: 0, stdout: "existing work\n", stderr: "" };
}
```

That prevents the new `git log --oneline refs/remotes/origin/main..HEAD`
preflight from being mistaken for existing-worktree commit detection.

- [ ] **Step 5: Run the focused pipeline tests**

Run:

```sh
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run both focused suites together**

Run:

```sh
node --test src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the pipeline wiring and orchestration tests**

```sh
git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "feat: block run-once before unsafe issue bases"
```

---

## Task 5: Document the run-once branch-base safety block

**Files:**

- Modify: `docs/issue-agent-workflows.md`
- Modify: `docs/configuration.md`

- [ ] **Step 1: Update run-once safety-gate docs**

In `docs/issue-agent-workflows.md`, in `### Issue selection and safety gates`,
replace the paragraph beginning
`Before mutating, it checks the repository worktree is clean` with:

```md
After selecting an eligible issue and before any mutation, `run-once` verifies
that the configured issue branch base (`git.baseRef`) is already contained in
the configured PR target base. The target base is derived from `git.remote` and
`git.baseBranch` as `refs/remotes/<remote>/<baseBranch>`, for example
`refs/remotes/origin/main`. If `git.baseRef` has commits not present in that
remote-tracking ref, Patchmill exits non-zero before claiming the issue,
commenting, writing run state, creating a worktree, or invoking Pi. The error
lists the commits that would leak into the issue PR and tells the operator to
push or merge setup commits, fetch a stale remote-tracking ref, or configure
`git.baseRef` to an upstream ref already contained in the PR base.

Dry runs perform the same branch-base safety check because they preview whether
`run-once` is safe to start. When no eligible issue exists, `run-once` returns
`no-issue` without running this check because no issue branch would be created.

After the branch-base check passes in execute mode, `run-once` checks the
repository worktree is clean, ignoring configured local state paths such as the
run-state directory and issue todo root. It records checkpoints so retries can
skip already-completed side effects safely.
```

- [ ] **Step 2: Add a git configuration subsection after the complete example**

In `docs/configuration.md`, after the complete example JSON and before
`## Host providers`, add:

````md
## Git branch-base safety

`patchmill run-once` creates issue branches from `git.baseRef`. The default is
`"HEAD"`, which is convenient after a normal clone but can be unsafe just after
initializing Patchmill: if you commit generated config locally and do not push
or merge that commit to the PR target branch, every issue branch created from
local `HEAD` would include that setup commit.

Before claiming an issue, commenting, writing run state, creating a worktree, or
running Pi, `run-once` checks that `git.baseRef` is contained in the configured
PR target base. The target base is derived from:

```text
refs/remotes/<git.remote>/<git.baseBranch>
```

With the defaults, that is `refs/remotes/origin/main`.

If `git.baseRef` has commits that are not in the target base, `run-once` exits
non-zero and lists the commits that would leak into the issue PR. There is no
CLI or config override for this guardrail. Fix the repository state by doing one
of the following:

- push or merge the local setup commits into `<git.remote>/<git.baseBranch>`;
- run `git fetch <git.remote>` if the remote-tracking ref is stale;
- set `git.baseRef` to an upstream ref that is already contained in the target
  base, such as `refs/remotes/origin/main`.

`--dry-run` performs the same check because it previews whether a real
`run-once` can safely start.
````

- [ ] **Step 3: Run a docs grep for the new terms**

Run:

```sh
rg "branch-base|refs/remotes/<git.remote>/<git.baseBranch>|git.baseRef" docs/issue-agent-workflows.md docs/configuration.md
```

Expected: output includes the new safety-gate and configuration text.

- [ ] **Step 4: Commit the docs**

```sh
git add docs/issue-agent-workflows.md docs/configuration.md
git commit -m "docs: explain run-once branch base safety"
```

---

## Task 6: Final verification and cleanup

**Files:**

- Verify only; no source changes expected unless a previous task missed a
  requirement.

- [ ] **Step 1: Run targeted tests required by the spec**

Run:

```sh
node --test src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```sh
npm test
```

Expected: PASS.

- [ ] **Step 3: Confirm no Nix build is required**

Run:

```sh
git diff --name-only HEAD~3..HEAD | rg '(^|/)(package.json|package-lock.json|npm-shrinkwrap.json)$' || true
```

Expected: no output. Per `AGENTS.md`, no Nix build is required unless npm
dependency metadata changed.

- [ ] **Step 4: Review the final diff for scope**

Run:

```sh
git diff --stat HEAD~3..HEAD
git diff --check HEAD~3..HEAD
```

Expected: only the planned TypeScript tests/implementation and docs changed;
`git diff --check` reports no whitespace errors.

- [ ] **Step 5: Confirm final commits are present**

Run:

```sh
git log --oneline -3
```

Expected: the last three commits are:

```text
<sha> docs: explain run-once branch base safety
<sha> feat: block run-once before unsafe issue bases
<sha> feat: guard run-once issue base containment
```

---

## Validation Commands

Use these exact commands during implementation:

```sh
node --test src/cli/commands/run-once/git.test.ts
node --test src/cli/commands/run-once/pipeline.test.ts
node --test src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/pipeline.test.ts
npm test
rg "branch-base|refs/remotes/<git.remote>/<git.baseBranch>|git.baseRef" docs/issue-agent-workflows.md docs/configuration.md
git diff --check HEAD~3..HEAD
git diff --name-only HEAD~3..HEAD | rg '(^|/)(package.json|package-lock.json|npm-shrinkwrap.json)$' || true
```

No npm dependency changes are planned, so `AGENTS.md` does not require a Nix
build for this issue unless implementation later edits `package.json`,
`package-lock.json`, or `npm-shrinkwrap.json`.

---

## Self-Review Notes

- Spec coverage: The plan covers the git helper, pre-mutation pipeline
  placement, dry-run behavior, no-issue behavior, actionable errors with leaked
  commits, missing remote-ref failures, docs, and
  clean/dirty/remote-ref/configured-target tests.
- Placeholder scan: No `TBD`, `TODO`, or undefined future steps remain; each
  task has concrete files, commands, and expected outcomes.
- Type consistency: The planned helper signature uses existing `CommandRunner`,
  `repoRoot`, `baseRef`, `remote`, and `baseBranch` fields from
  `AgentIssueConfig`; no new config fields or override switches are introduced.
