# Issue 81 Init Git Default and Setup Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tracked Patchmill config/skills the default init git policy and
guide or perform a safe explicit push of the setup commit so the first
`patchmill run-once` does not surprise users with an unpushed-base safety
failure.

**Architecture:** Keep git policy selection and setup-commit creation in
`src/cli/commands/init/git-policy.ts`, but put remote/upstream inspection, push
prompting, push execution, and first-run guidance in a new focused
`src/cli/commands/init/git-setup-push.ts` module.
`src/cli/commands/init/main.ts` remains the orchestrator: apply the selected
policy, then call setup-push handling only when the add policy actually created
`chore: initialize Patchmill`.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, injected `CommandRunner`,
`gh` issue context from #81, npm scripts from `package.json`.

## Global Constraints

- Approved spec:
  `docs/specs/2026-07-15-issue-81-init-git-default-push-design.md`.
- Do not weaken the existing `run-once` `git.baseRef` containment guard.
- Do not run `git fetch` during init.
- Do not push automatically in non-interactive or `--yes` mode.
- Do not push when the unpushed set contains user commits or anything besides
  one `chore: initialize Patchmill` commit.
- Do not add new config fields for issue #81.
- Keep explicit option 2 (`ignore`) and option 3 (`exclude`) behavior unchanged.
- No npm dependency changes are required; if `package.json`,
  `package-lock.json`, or `npm-shrinkwrap.json` changes, rerun the Nix build per
  project instructions.

---

## File Structure

- Modify: `src/cli/commands/init/git-policy.ts`
  - Change selection default to `add`.
  - Update prompt copy to mark option 1 recommended and show `[1]`.
  - Export setup commit status metadata through
    `InitGitPolicyResult.setupCommit`.
- Modify: `src/cli/commands/init/git-policy.test.ts`
  - Update prompt/default tests.
  - Assert add-policy setup commit metadata.
- Create: `src/cli/commands/init/git-setup-push.ts`
  - One responsibility: inspect whether the init setup commit can be safely
    pushed, prompt when interactive, run `git push`, and return output text.
- Create: `src/cli/commands/init/git-setup-push.test.ts`
  - Unit-test safety inspection, prompt handling, push execution, and guidance
    text with an injected `CommandRunner`.
- Modify: `src/cli/commands/init/main.ts`
  - Reuse a single `CommandRunner` instance.
  - Call setup-push handling only when
    `gitPolicyResult.setupCommit?.status === "committed"`.
  - Append setup-push output beside existing git policy output.
- Modify: `src/cli/commands/init/main-git-policy.test.ts`
  - Allow multiple prompt answers in the init helper.
  - Update default/non-interactive expectations.
  - Cover accepted push, declined push, and non-interactive/`--yes` guidance.

## Validation Commands

Run targeted tests after each task that changes behavior:

```bash
node --test \
  src/cli/commands/init/git-policy.test.ts \
  src/cli/commands/init/git-setup-push.test.ts \
  src/cli/commands/init/main-git-policy.test.ts
```

Run the full repository suite before final handoff:

```bash
npm test
```

---

### Task 1: Change git policy default and expose setup commit metadata

**Files:**

- Modify: `src/cli/commands/init/git-policy.ts`
- Modify: `src/cli/commands/init/git-policy.test.ts`

**Interfaces:**

- Produces: `InitSetupCommitStatus` exported from `git-policy.ts`.
- Produces: optional `setupCommit` metadata on `InitGitPolicyResult`:

  ```ts
  setupCommit?: {
    status: InitSetupCommitStatus;
    paths: string[];
  };
  ```

- Consumed by Task 3: `runInit()` checks
  `gitPolicyResult.setupCommit?.status === "committed"` before calling
  setup-push handling.

- [ ] **Step 1: Update failing tests for default selection and prompt copy**

  Replace the current default-selection test in
  `src/cli/commands/init/git-policy.test.ts` with:

  ```ts
  test("selectInitGitPolicy defaults to add for defaulted runs", async () => {
    assert.equal(
      await selectInitGitPolicy({ isInteractive: false, assumeYes: false }),
      "add",
    );
    assert.equal(
      await selectInitGitPolicy({ isInteractive: true, assumeYes: true }),
      "add",
    );

    let question = "";
    assert.equal(
      await selectInitGitPolicy({
        isInteractive: true,
        assumeYes: false,
        prompt: async (value) => {
          question = value;
          return "";
        },
      }),
      "add",
    );
    assert.match(
      question,
      /1\) Add config and skills to git \(recommended for shared config\)/u,
    );
    assert.match(question, /Choose 1, 2, or 3 \[1\]:/u);
  });
  ```

  Update the existing
  `selectInitGitPolicy accepts add, ignore, and exclude prompt answers` test so
  the blank-answer assertion is removed or changed to an explicit option 3
  assertion:

  ```ts
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "3",
    }),
    "exclude",
  );
  ```

- [ ] **Step 2: Add setup commit metadata assertions to add-policy tests**

  In `applyInitGitPolicy add stages config, skills, and runtime ignore entries`,
  add this assertion after the existing message assertion:

  ```ts
  assert.deepEqual(result.setupCommit, {
    status: "committed",
    paths: ["patchmill.config.json", ".patchmill/skills", ".gitignore"],
  });
  ```

  In `applyInitGitPolicy add omits missing skills directory`, add:

  ```ts
  assert.deepEqual(result.setupCommit, {
    status: "committed",
    paths: ["patchmill.config.json", ".gitignore"],
  });
  ```

  In `applyInitGitPolicy add stages provided repo-local skill roots`, add:

  ```ts
  assert.deepEqual(result.setupCommit, {
    status: "committed",
    paths: ["patchmill.config.json", "custom-skills", ".gitignore"],
  });
  ```

  In `applyInitGitPolicy reports git commit failures as non-fatal warnings`,
  add:

  ```ts
  assert.deepEqual(result.setupCommit, {
    status: "commit-warning",
    paths: ["patchmill.config.json", ".gitignore"],
  });
  ```

- [ ] **Step 3: Run the policy tests and verify they fail for the expected
      reasons**

  Run:

  ```bash
  node --test src/cli/commands/init/git-policy.test.ts
  ```

  Expected before implementation: failures mention `"exclude" !== "add"`,
  missing recommended prompt copy, `[3]` instead of `[1]`, and missing
  `setupCommit` metadata.

- [ ] **Step 4: Update `git-policy.ts` types and selection logic**

  In `src/cli/commands/init/git-policy.ts`, replace the `InitGitPolicyResult`
  type block with:

  ```ts
  export type InitSetupCommitStatus =
    | "committed"
    | "nothing"
    | "missing"
    | "stage-warning"
    | "commit-warning";

  export type InitGitPolicyResult = {
    policy: InitGitPolicy;
    message: string;
    setupCommit?: {
      status: InitSetupCommitStatus;
      paths: string[];
    };
  };
  ```

  Change `GitCommitOutcome` to reuse the exported status type:

  ```ts
  type GitCommitOutcome =
    | { status: "committed"; paths: string[] }
    | { status: "nothing"; paths: string[] }
    | { status: "missing"; paths: string[] }
    | { status: "stage-warning"; warning: string; paths: string[] }
    | { status: "commit-warning"; warning: string; paths: string[] };
  ```

  Replace `selectInitGitPolicy()` with:

  ```ts
  export async function selectInitGitPolicy(options: {
    isInteractive: boolean;
    assumeYes: boolean;
    prompt?: InitGitPolicyPrompt;
  }): Promise<InitGitPolicy> {
    if (!options.isInteractive || options.assumeYes || !options.prompt) {
      return "add";
    }

    const answer = (
      await options.prompt(
        [
          "How should Patchmill files be handled by git?",
          "  1) Add config and skills to git (recommended for shared config)",
          "  2) Add Patchmill files to .gitignore",
          "  3) Add Patchmill files to .git/info/exclude (local only)",
          "Choose 1, 2, or 3 [1]: ",
        ].join("\n"),
      )
    )
      .trim()
      .toLowerCase();

    if (["2", "i", "ignore", "gitignore", "git ignore"].includes(answer)) {
      return "ignore";
    }
    if (["3", "e", "exclude", "local", "local only"].includes(answer)) {
      return "exclude";
    }
    return "add";
  }
  ```

- [ ] **Step 5: Return setup commit metadata from the add policy**

  In the `policy === "add"` return object, add `setupCommit` from the local
  `commit` result:

  ```ts
  return {
    policy: options.policy,
    message: [addSummary, ignoreMessage].join("\n"),
    setupCommit: {
      status: commit.status,
      paths: commit.paths,
    },
  };
  ```

  Do not add `setupCommit` to `ignore` or `exclude` results.

- [ ] **Step 6: Run the policy tests and commit Task 1**

  Run:

  ```bash
  node --test src/cli/commands/init/git-policy.test.ts
  ```

  Expected: all tests in `git-policy.test.ts` pass.

  Commit:

  ```bash
  git add src/cli/commands/init/git-policy.ts src/cli/commands/init/git-policy.test.ts
  git commit -m "feat(init): default git policy to tracked config"
  ```

---

### Task 2: Add setup push helper with unit tests

**Files:**

- Create: `src/cli/commands/init/git-setup-push.ts`
- Create: `src/cli/commands/init/git-setup-push.test.ts`

**Interfaces:**

- Consumes: `CommandRunner` from `src/cli/commands/triage/types.ts`.
- Consumes: `InitGitPolicyPrompt` from `src/cli/commands/init/git-policy.ts`.
- Produces:
  `maybeOfferInitSetupPush(options: InitSetupPushOptions): Promise<InitSetupPushResult>`.
- Consumed by Task 3: `runInit()` appends `InitSetupPushResult.message` to git
  policy output.

- [ ] **Step 1: Write helper tests for accepted, declined, and non-interactive
      safe push paths**

  Create `src/cli/commands/init/git-setup-push.test.ts` with this initial
  content:

  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import type { CommandRunner, CommandResult } from "../triage/types.ts";
  import { maybeOfferInitSetupPush } from "./git-setup-push.ts";

  type ScriptedResult = Partial<CommandResult>;

  function result(value: ScriptedResult = {}): CommandResult {
    return {
      code: value.code ?? 0,
      stdout: value.stdout ?? "",
      stderr: value.stderr ?? "",
    };
  }

  function runner(calls: string[][], results: ScriptedResult[]): CommandRunner {
    return {
      async run(command, args, options) {
        calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
        return result(results.shift());
      },
    };
  }

  const safeInspection: ScriptedResult[] = [
    { stdout: "main\n" },
    { stdout: "origin/main\n" },
    { stdout: "target-sha\n" },
    { code: 0 },
    { stdout: "abc123\^@chore: initialize Patchmill\n" },
  ];

  test("maybeOfferInitSetupPush pushes a safe setup commit when accepted", async () => {
    const calls: string[][] = [];
    const prompts: string[] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [...safeInspection, { code: 0 }]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: true,
      assumeYes: false,
      prompt: async (question) => {
        prompts.push(question);
        return "";
      },
    });

    assert.equal(prompts.length, 1);
    assert.match(prompts[0] ?? "", /Push it now\? \[Y\/n\]/u);
    assert.deepEqual(calls.at(-1), [
      "git",
      "push",
      "origin",
      "HEAD:main",
      "cwd=/repo",
    ]);
    assert.match(
      outcome.message ?? "",
      /Pushed Patchmill setup commit to origin\/main/u,
    );
  });

  test("maybeOfferInitSetupPush prints guidance when safe push is declined", async () => {
    const calls: string[][] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [...safeInspection]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "n",
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      false,
    );
    assert.match(
      outcome.message ?? "",
      /must be pushed or merged into origin\/main/u,
    );
    assert.match(outcome.message ?? "", /git push origin HEAD:main/u);
  });

  test("maybeOfferInitSetupPush does not push in non-interactive mode", async () => {
    const calls: string[][] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [...safeInspection]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: false,
      assumeYes: false,
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      false,
    );
    assert.match(
      outcome.message ?? "",
      /Patchmill did not push automatically/u,
    );
    assert.match(outcome.message ?? "", /non-interactive/u);
  });
  ```

- [ ] **Step 2: Add unsafe-state and push-failure tests**

  Append these tests to the same file:

  ```ts
  test("maybeOfferInitSetupPush reports an upstream mismatch", async () => {
    const calls: string[][] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [
        { stdout: "main\n" },
        { stdout: "origin/develop\n" },
      ]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "",
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      false,
    );
    assert.match(
      outcome.message ?? "",
      /current branch tracks origin\/develop, not origin\/main/u,
    );
    assert.match(outcome.message ?? "", /git push origin HEAD:main/u);
  });

  test("maybeOfferInitSetupPush reports missing remote tracking ref", async () => {
    const calls: string[][] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [
        { stdout: "main\n" },
        { stdout: "origin/main\n" },
        { code: 128, stderr: "fatal: Needed a single revision" },
      ]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "",
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      false,
    );
    assert.match(
      outcome.message ?? "",
      /refs\/remotes\/origin\/main is missing/u,
    );
  });

  test("maybeOfferInitSetupPush refuses multiple unpushed commits", async () => {
    const calls: string[][] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [
        ...safeInspection.slice(0, 4),
        {
          stdout:
            "abc123\^@chore: initialize Patchmill\n" +
            "def456\^@docs: local setup\n",
        },
      ]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "",
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      false,
    );
    assert.match(
      outcome.message ?? "",
      /HEAD has unpushed commits in addition/u,
    );
    assert.match(outcome.message ?? "", /docs: local setup/u);
  });

  test("maybeOfferInitSetupPush reports push failures with git output", async () => {
    const calls: string[][] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [
        ...safeInspection,
        { code: 1, stderr: "protected branch" },
      ]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "yes",
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      true,
    );
    assert.match(outcome.message ?? "", /Warning: git push failed/u);
    assert.match(outcome.message ?? "", /protected branch/u);
    assert.match(outcome.message ?? "", /git push origin HEAD:main/u);
  });

  test("maybeOfferInitSetupPush reports detached HEAD", async () => {
    const calls: string[][] = [];

    const outcome = await maybeOfferInitSetupPush({
      repoRoot: "/repo",
      runner: runner(calls, [{ stdout: "HEAD\n" }]),
      remote: "origin",
      baseBranch: "main",
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "",
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      false,
    );
    assert.match(outcome.message ?? "", /current checkout is detached/u);
  });
  ```

- [ ] **Step 3: Run the new tests and verify they fail because the module does
      not exist**

  Run:

  ```bash
  node --test src/cli/commands/init/git-setup-push.test.ts
  ```

  Expected before implementation: import/module-not-found failure for
  `./git-setup-push.ts`.

- [ ] **Step 4: Implement `git-setup-push.ts`**

  Create `src/cli/commands/init/git-setup-push.ts` with:

  ```ts
  import type { CommandResult, CommandRunner } from "../triage/types.ts";
  import type { InitGitPolicyPrompt } from "./git-policy.ts";

  const SETUP_COMMIT_SUBJECT = "chore: initialize Patchmill";

  export type InitSetupPushOptions = {
    repoRoot: string;
    runner: CommandRunner;
    remote: string;
    baseBranch: string;
    isInteractive: boolean;
    assumeYes: boolean;
    prompt?: InitGitPolicyPrompt;
  };

  export type InitSetupPushResult = {
    message?: string;
  };

  type SetupCommit = {
    sha: string;
    subject: string;
  };

  type PushSafety =
    | { status: "safe"; targetRef: string; commit: SetupCommit }
    | { status: "unsafe"; targetRef: string; reason: string };

  function targetRef(remote: string, baseBranch: string): string {
    return `refs/remotes/${remote}/${baseBranch}`;
  }

  function targetName(remote: string, baseBranch: string): string {
    return `${remote}/${baseBranch}`;
  }

  function manualPushCommand(remote: string, baseBranch: string): string {
    return `git push ${remote} HEAD:${baseBranch}`;
  }

  function gitOutput(result: CommandResult): string {
    return result.stderr || result.stdout || "unknown error";
  }

  function parseCommitLog(stdout: string): SetupCommit[] {
    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const [sha = "", subject = ""] = line.split("\0", 2);
        return { sha, subject };
      });
  }

  function guidance(options: {
    remote: string;
    baseBranch: string;
    reason: string;
  }): string {
    const target = targetName(options.remote, options.baseBranch);
    return [
      `Patchmill created a setup commit that must be pushed or merged into ${target} before patchmill run-once can create issue PRs.`,
      `Patchmill did not push automatically: ${options.reason}.`,
      "If appropriate, run:",
      `  ${manualPushCommand(options.remote, options.baseBranch)}`,
    ].join("\n");
  }

  async function inspectPushSafety(
    options: Pick<
      InitSetupPushOptions,
      "repoRoot" | "runner" | "remote" | "baseBranch"
    >,
  ): Promise<PushSafety> {
    const configuredTargetRef = targetRef(options.remote, options.baseBranch);
    const configuredTargetName = targetName(options.remote, options.baseBranch);

    const branch = await options.runner.run(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: options.repoRoot },
    );
    const branchName = branch.stdout.trim();
    if (branch.code !== 0 || branchName === "") {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: `current branch could not be determined: ${gitOutput(branch)}`,
      };
    }
    if (branchName === "HEAD") {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: "current checkout is detached",
      };
    }

    const upstream = await options.runner.run(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd: options.repoRoot },
    );
    const upstreamName = upstream.stdout.trim();
    if (upstream.code !== 0 || upstreamName === "") {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: `current branch does not track ${configuredTargetName}`,
      };
    }
    if (upstreamName !== configuredTargetName) {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: `current branch tracks ${upstreamName}, not ${configuredTargetName}`,
      };
    }

    const verifyTarget = await options.runner.run(
      "git",
      ["rev-parse", "--verify", `${configuredTargetRef}^{commit}`],
      { cwd: options.repoRoot },
    );
    if (verifyTarget.code !== 0) {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: `${configuredTargetRef} is missing; run git fetch or push the setup commit before run-once`,
      };
    }

    const ancestor = await options.runner.run(
      "git",
      ["merge-base", "--is-ancestor", configuredTargetRef, "HEAD"],
      { cwd: options.repoRoot },
    );
    if (ancestor.code !== 0) {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: `${configuredTargetRef} is not an ancestor of HEAD`,
      };
    }

    const log = await options.runner.run(
      "git",
      ["log", "--format=%H%x00%s", `${configuredTargetRef}..HEAD`],
      { cwd: options.repoRoot },
    );
    if (log.code !== 0) {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: `git log failed while checking unpushed setup commit: ${gitOutput(log)}`,
      };
    }

    const commits = parseCommitLog(log.stdout);
    if (commits.length !== 1) {
      const subjects = commits.map((commit) => commit.subject).join(", ");
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason:
          commits.length === 0
            ? "HEAD has no unpushed Patchmill setup commit"
            : `HEAD has unpushed commits in addition to ${SETUP_COMMIT_SUBJECT}: ${subjects}`,
      };
    }

    const [commit] = commits;
    if (!commit || commit.subject !== SETUP_COMMIT_SUBJECT) {
      return {
        status: "unsafe",
        targetRef: configuredTargetRef,
        reason: `the unpushed commit is ${commit?.subject || "unknown"}, not ${SETUP_COMMIT_SUBJECT}`,
      };
    }

    return { status: "safe", targetRef: configuredTargetRef, commit };
  }

  function accepted(answer: string): boolean {
    const normalized = answer.trim().toLowerCase();
    return normalized === "" || normalized === "y" || normalized === "yes";
  }

  export async function maybeOfferInitSetupPush(
    options: InitSetupPushOptions,
  ): Promise<InitSetupPushResult> {
    const safety = await inspectPushSafety(options);
    if (safety.status !== "safe") {
      return {
        message: guidance({
          remote: options.remote,
          baseBranch: options.baseBranch,
          reason: safety.reason,
        }),
      };
    }

    if (!options.isInteractive || options.assumeYes || !options.prompt) {
      return {
        message: guidance({
          remote: options.remote,
          baseBranch: options.baseBranch,
          reason: options.assumeYes
            ? "--yes does not perform network pushes"
            : "init is non-interactive",
        }),
      };
    }

    const answer = await options.prompt(
      [
        `Patchmill committed config and skills locally. patchmill run-once needs this setup commit on ${targetName(options.remote, options.baseBranch)} before creating issue branches.`,
        "Push it now? [Y/n] ",
      ].join("\n"),
    );
    if (!accepted(answer)) {
      return {
        message: guidance({
          remote: options.remote,
          baseBranch: options.baseBranch,
          reason: "the push was declined",
        }),
      };
    }

    const push = await options.runner.run(
      "git",
      ["push", options.remote, `HEAD:${options.baseBranch}`],
      { cwd: options.repoRoot },
    );
    if (push.code !== 0) {
      return {
        message: [
          `Warning: git push failed while publishing Patchmill setup commit; continuing. ${gitOutput(push)}`,
          guidance({
            remote: options.remote,
            baseBranch: options.baseBranch,
            reason: "git push failed",
          }),
        ].join("\n"),
      };
    }

    return {
      message: `Pushed Patchmill setup commit to ${targetName(options.remote, options.baseBranch)}. patchmill run-once can now create issue branches from the configured base.`,
    };
  }
  ```

- [ ] **Step 5: Run setup-push tests and commit Task 2**

  Run:

  ```bash
  node --test src/cli/commands/init/git-setup-push.test.ts
  ```

  Expected: all tests in `git-setup-push.test.ts` pass.

  Commit:

  ```bash
  git add src/cli/commands/init/git-setup-push.ts src/cli/commands/init/git-setup-push.test.ts
  git commit -m "feat(init): offer safe setup commit push"
  ```

---

### Task 3: Wire setup push handling into `patchmill init`

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main-git-policy.test.ts`

**Interfaces:**

- Consumes from Task 1: `gitPolicyResult.setupCommit?.status`.
- Consumes from Task 2: `maybeOfferInitSetupPush()`.
- Produces: final init output with git policy text plus setup-push
  success/guidance text.

- [ ] **Step 1: Update integration test helper to support multiple prompts**

  In `src/cli/commands/init/main-git-policy.test.ts`, change the
  `runInitForGitPolicy()` options type to include `promptAnswers?: string[]`:

  ```ts
  async function runInitForGitPolicy(
    repoRoot: string,
    options: {
      args?: string[];
      isInteractive: boolean;
      promptAnswer?: string;
      promptAnswers?: string[];
      calls?: string[][];
      commandRunner?: CommandRunner;
    },
  ) {
    const stdout: string[] = [];
    const promptAnswers = [
      ...(options.promptAnswers ?? [options.promptAnswer ?? ""]),
    ];
    const exitCode = await runInit(
      options.args ?? [],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        resolvePiInitSetup: incompletePiSetup,
        isInteractive: options.isInteractive,
        prompt: async () => promptAnswers.shift() ?? "",
        commandRunner: options.commandRunner ?? runner(options.calls ?? []),
        setupLabels: async () => ({
          status: "skipped",
          message: "Label setup skipped.",
        }),
      },
    );
    return { exitCode, output: stdout.join("\n") };
  }
  ```

  If the formatter removes the extra space before the closing parenthesis,
  accept the formatter output.

- [ ] **Step 2: Update add-policy integration tests for setup-push inspection
      guidance**

  In add-policy tests that use the simple `runner(calls)` helper, append the
  first setup-push inspection command to the expected call list because the fake
  runner returns empty stdout and the helper stops after it cannot determine the
  branch:

  ```ts
  ["git", "rev-parse", "--abbrev-ref", "HEAD", `cwd=${repoRoot}`],
  ```

  Add this assertion to those tests:

  ```ts
  assert.match(output, /must be pushed or merged into origin\/main/u);
  assert.match(output, /git push origin HEAD:main/u);
  ```

  Apply this to:
  - `interactive init add-to-git commits config, skills, and gitignore`
  - `interactive init add-to-git with no skills commits config and gitignore only`
  - `interactive init add-to-git with path skills commits the provided skill root`

- [ ] **Step 3: Replace the non-interactive/yes exclude test with default-add
      guidance coverage**

  Replace `non-interactive and --yes init choose git-exclude without prompting`
  with:

  ```ts
  test("non-interactive and --yes init choose add without pushing", async () => {
    const nonInteractiveRoot = await tempRepo();
    const yesRoot = await tempRepo();
    const nonInteractiveCalls: string[][] = [];
    const yesCalls: string[][] = [];
    let prompted = false;

    const nonInteractive = await runInitForGitPolicy(nonInteractiveRoot, {
      isInteractive: false,
      promptAnswer: "3",
      calls: nonInteractiveCalls,
    });
    const yes = await runInit(
      ["--yes"],
      yesRoot,
      {
        stdout: (line) => {
          if (!line.includes("Created patchmill.config.json")) return;
        },
        stderr: () => undefined,
      },
      {
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        resolvePiInitSetup: incompletePiSetup,
        isInteractive: true,
        prompt: async () => {
          prompted = true;
          return "3";
        },
        commandRunner: runner(yesCalls),
        setupLabels: async () => ({
          status: "skipped",
          message: "Label setup skipped.",
        }),
      },
    );

    assert.equal(prompted, false);
    assert.equal(yes, 0);
    assert.match(
      await readFile(join(nonInteractiveRoot, ".gitignore"), "utf8"),
      /\.patchmill\/runs/u,
    );
    assert.match(nonInteractive.output, /git push origin HEAD:main/u);
    assert.equal(
      nonInteractiveCalls.some((call) => call[1] === "push"),
      false,
    );
    assert.equal(
      yesCalls.some((call) => call[1] === "push"),
      false,
    );
  });
  ```

  If capturing `yes` stdout is needed for a guidance assertion, use a
  `yesStdout: string[] = []` array and `stdout: (line) => yesStdout.push(line)`.

- [ ] **Step 4: Add accepted and declined push integration tests**

  Add this helper near `runner()`:

  ```ts
  function scriptedRunner(
    calls: string[][],
    results: Array<{ code?: number; stdout?: string; stderr?: string }>,
  ): CommandRunner {
    return {
      async run(command, args, options) {
        calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
        const result = results.shift() ?? { code: 0, stdout: "", stderr: "" };
        return {
          code: result.code ?? 0,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        };
      },
    };
  }

  const safePushInspection = [
    { stdout: "main\n" },
    { stdout: "origin/main\n" },
    { stdout: "target-sha\n" },
    { code: 0 },
    { stdout: "abc123\^@chore: initialize Patchmill\n" },
  ];
  ```

  Add an accepted-push test:

  ```ts
  test("interactive init offers and pushes a safe Patchmill setup commit", async () => {
    const repoRoot = await tempRepo();
    const calls: string[][] = [];

    const { output } = await runInitForGitPolicy(repoRoot, {
      isInteractive: true,
      promptAnswers: ["", ""],
      commandRunner: scriptedRunner(calls, [
        ...safePushInspection,
        { code: 0 },
      ]),
    });

    assert.deepEqual(calls.at(-1), [
      "git",
      "push",
      "origin",
      "HEAD:main",
      `cwd=${repoRoot}`,
    ]);
    assert.match(output, /Pushed Patchmill setup commit to origin\/main/u);
    assert.doesNotMatch(output, /git.baseRef HEAD is not contained/u);
  });
  ```

  Add a declined-push test:

  ```ts
  test("interactive init prints guidance when setup push is declined", async () => {
    const repoRoot = await tempRepo();
    const calls: string[][] = [];

    const { output } = await runInitForGitPolicy(repoRoot, {
      isInteractive: true,
      promptAnswers: ["", "n"],
      commandRunner: scriptedRunner(calls, [...safePushInspection]),
    });

    assert.equal(
      calls.some((call) => call[1] === "push"),
      false,
    );
    assert.match(output, /must be pushed or merged into origin\/main/u);
    assert.match(output, /git push origin HEAD:main/u);
  });
  ```

- [ ] **Step 5: Run main git policy tests and verify they fail before wiring**

  Run:

  ```bash
  node --test src/cli/commands/init/main-git-policy.test.ts
  ```

  Expected before implementation: assertions fail because `runInit()` does not
  call setup-push handling and default non-interactive behavior still uses
  exclude until Task 1 is wired into `main` behavior.

- [ ] **Step 6: Wire setup push handling in `main.ts`**

  In `src/cli/commands/init/main.ts`, add imports:

  ```ts
  import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
  import { maybeOfferInitSetupPush } from "./git-setup-push.ts";
  ```

  Before `selectInitGitPolicy()`, assign a single command runner:

  ```ts
  const commandRunner = options.commandRunner ?? createCommandRunner();
  ```

  Use it for `applyInitGitPolicy()`:

  ```ts
  const gitPolicyResult = await applyInitGitPolicy({
    repoRoot: config.repoRoot,
    policy: gitPolicy,
    runner: commandRunner,
    skillRoots: stageableSkillRoots(result.config.skills),
  });
  ```

  Immediately after `applyInitGitPolicy()`, add:

  ```ts
  const setupPushResult =
    gitPolicyResult.setupCommit?.status === "committed"
      ? await maybeOfferInitSetupPush({
          repoRoot: config.repoRoot,
          runner: commandRunner,
          remote: DEFAULT_PATCHMILL_CONFIG.git.remote,
          baseBranch: DEFAULT_PATCHMILL_CONFIG.git.baseBranch,
          isInteractive,
          assumeYes: config.yes,
          prompt: options.prompt ?? defaultPrompt,
        })
      : undefined;
  const gitPolicyMessage = [gitPolicyResult.message, setupPushResult?.message]
    .filter((message): message is string => Boolean(message))
    .join("\n\n");
  ```

  In the final output template, replace `${gitPolicyResult.message}` with
  `${gitPolicyMessage}`.

- [ ] **Step 7: Run targeted tests and commit Task 3**

  Run:

  ```bash
  node --test \
    src/cli/commands/init/git-policy.test.ts \
    src/cli/commands/init/git-setup-push.test.ts \
    src/cli/commands/init/main-git-policy.test.ts
  ```

  Expected: all targeted tests pass.

  Commit:

  ```bash
  git add \
    src/cli/commands/init/main.ts \
    src/cli/commands/init/main-git-policy.test.ts
  git commit -m "feat(init): guide first setup commit push"
  ```

---

### Task 4: Final verification and handoff

**Files:**

- No expected source changes unless verification reveals issues.

**Interfaces:**

- Consumes all previous tasks.
- Produces final implementation evidence for issue #81 handoff.

- [ ] **Step 1: Run the issue #81 targeted test suite**

  Run:

  ```bash
  node --test \
    src/cli/commands/init/git-policy.test.ts \
    src/cli/commands/init/git-setup-push.test.ts \
    src/cli/commands/init/main-git-policy.test.ts
  ```

  Expected: pass.

- [ ] **Step 2: Run the full suite**

  Run:

  ```bash
  npm test
  ```

  Expected: pass.

- [ ] **Step 3: Run format/lint checks**

  Run:

  ```bash
  npm run lint
  ```

  Expected: pass. If lint fails because generated markdown or TypeScript
  formatting differs, run `npm run format`, inspect the diff, and rerun
  `npm run lint`.

- [ ] **Step 4: Inspect the diff for scope control**

  Run:

  ```bash
  git diff --stat HEAD~3..HEAD
  git diff HEAD~3..HEAD -- src/cli/commands/init
  ```

  Expected: changes are limited to init git policy, setup-push helper/tests, and
  init orchestration tests. No dependency files should change.

- [ ] **Step 5: Final commit if verification required formatting fixes**

  If Step 3 required formatting changes, commit them separately:

  ```bash
  git add src/cli/commands/init
  git commit -m "style(init): format setup push changes"
  ```

  If no formatting changes were needed, do not create an empty commit.

- [ ] **Step 6: Handoff summary**

  Report:

  ```text
  Implemented issue #81 on branch <branch>.
  Targeted tests: <pass/fail command and result>.
  Full suite: <pass, or pre-existing npm-shrinkwrap failure details>.
  Push behavior: interactive safe prompt only; --yes/non-interactive guidance only.
  ```
