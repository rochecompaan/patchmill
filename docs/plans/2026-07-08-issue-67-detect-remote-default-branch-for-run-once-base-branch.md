# Base Branch Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill run-once` automatically use a repository's detected
remote default branch when `git.baseBranch` is not configured.

**Architecture:** Keep explicit config authoritative by adding config-source
metadata before defaults are merged. Add a focused git helper that detects the
branch from `refs/remotes/<remote>/HEAD` or the current branch upstream, then
use it during run-once config assembly before the existing safety guard
validates the target ref.

**Tech Stack:** TypeScript ESM, Node.js built-in test runner, injected
`CommandRunner`, existing Patchmill config loader and run-once pipeline.

## Global Constraints

- Save specs in `docs/specs/` and plans in `docs/plans/`.
- Work in the existing isolated worktree:
  `/home/roche/projects/patchmill/.worktrees/base-branch-detection`.
- Do not run `git fetch` implicitly.
- Explicit `git.baseBranch` in `patchmill.config.json` remains authoritative.
- When `git.baseBranch` is absent, detect from local git metadata only: remote
  HEAD first, current branch upstream second, existing default `main` last.
- Keep the existing branch-base safety guard: `git.baseRef` must resolve and be
  contained in `refs/remotes/<git.remote>/<effective baseBranch>`.
- Follow TDD: write each failing test first, run it, implement the minimum code,
  then rerun tests.
- When npm dependency files change, rerun the Nix build. This plan should not
  change npm dependencies.

---

## File Structure

- Modify `src/config/load.ts`
  - Responsibility: load and normalize Patchmill config.
  - Add metadata to `loadPatchmillConfigState()` that records whether
    `git.baseBranch` was explicitly present in the config file.
- Modify `src/config/load.test.ts`
  - Responsibility: config loader behavior tests.
  - Add tests for the new explicit-field metadata.
- Modify `src/cli/commands/run-once/git.ts`
  - Responsibility: run-once git helpers.
  - Add `detectDefaultBaseBranch()` and branch parsing helpers.
  - Improve unresolved PR target-base errors with detected branch hints when
    available.
- Modify `src/cli/commands/run-once/git.test.ts`
  - Responsibility: run-once git helper tests.
  - Add detection helper tests and target-base hint tests.
- Modify `src/cli/commands/run-once/main.ts`
  - Responsibility: run-once CLI config loading and command dispatch.
  - Resolve the effective base branch when user config omitted `git.baseBranch`.
- Modify `src/cli/commands/run-once/args.test.ts`
  - Responsibility: run-once config assembly tests.
  - Add tests that `loadCliConfig()` detects base branch when unset and skips
    detection when explicit.
- Modify `docs/configuration.md`
  - Responsibility: user-facing config behavior.
  - Update the git branch-base safety section to explain detection and explicit
    overrides.

---

### Task 1: Track whether `git.baseBranch` was explicit

**Files:**

- Modify: `src/config/load.ts`
- Modify: `src/config/load.test.ts`

**Interfaces:**

- Consumes: existing `loadPatchmillConfigState(repoRoot, env, args)`.
- Produces: `loadPatchmillConfigState()` returns:

```ts
Promise<{
  config: PatchmillConfig;
  hasConfigFile: boolean;
  explicitConfig: { gitBaseBranch: boolean };
}>;
```

Later tasks rely on `state.explicitConfig.gitBaseBranch` to decide whether
detection is allowed.

- [ ] **Step 1: Write failing metadata tests**

Add this test near the existing
`loadPatchmillConfigState accepts github-gh host provider` test in
`src/config/load.test.ts`:

```ts
test("loadPatchmillConfigState reports whether git.baseBranch was explicit", async () => {
  const defaultRepo = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const implicitRepo = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const explicitRepo = await mkdtemp(join(tmpdir(), "patchmill-config-"));

  await writeFile(
    join(implicitRepo, "patchmill.config.json"),
    JSON.stringify({ git: { baseRef: "HEAD" } }),
  );
  await writeFile(
    join(explicitRepo, "patchmill.config.json"),
    JSON.stringify({ git: { baseBranch: "master" } }),
  );

  const defaultState = await loadPatchmillConfigState(defaultRepo, {}, []);
  const implicitState = await loadPatchmillConfigState(implicitRepo, {}, []);
  const explicitState = await loadPatchmillConfigState(explicitRepo, {}, []);

  assert.equal(defaultState.explicitConfig.gitBaseBranch, false);
  assert.equal(implicitState.explicitConfig.gitBaseBranch, false);
  assert.equal(explicitState.explicitConfig.gitBaseBranch, true);
  assert.equal(explicitState.config.git.baseBranch, "master");
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/config/load.test.ts
```

Expected: FAIL with a TypeScript/runtime assertion error because
`explicitConfig` is undefined on the returned state.

- [ ] **Step 3: Implement the minimal config-state metadata**

In `src/config/load.ts`, add this exported type near `type LoadedConfigFile`:

```ts
export type PatchmillConfigExplicitConfig = {
  gitBaseBranch: boolean;
};
```

Update `loadPatchmillConfigState()` to compute metadata from the parsed file
config before defaults are merged:

```ts
export async function loadPatchmillConfigState(
  repoRoot: string,
  env: Env = process.env,
  args: string[] = [],
): Promise<{
  config: PatchmillConfig;
  hasConfigFile: boolean;
  explicitConfig: PatchmillConfigExplicitConfig;
}> {
  const { config: fromFile, hasConfigFile } = await readConfigFile(repoRoot);
  const explicitConfig: PatchmillConfigExplicitConfig = {
    gitBaseBranch: fromFile.git?.baseBranch !== undefined,
  };
  const merged = mergeConfig(
    mergeConfig(
      mergeConfig(DEFAULT_PATCHMILL_CONFIG, fromFile),
      envConfig(env),
    ),
    cliConfig(args),
  );
  return {
    config: absolutizePaths(repoRoot, merged),
    hasConfigFile,
    explicitConfig,
  };
}
```

Keep `loadPatchmillConfig()` unchanged except that it continues to return only
`.config`:

```ts
export async function loadPatchmillConfig(
  repoRoot: string,
  env: Env = process.env,
  args: string[] = [],
): Promise<PatchmillConfig> {
  return (await loadPatchmillConfigState(repoRoot, env, args)).config;
}
```

- [ ] **Step 4: Verify task tests pass**

Run:

```bash
npm test -- src/config/load.test.ts
```

Expected: PASS for all config loader tests.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/config/load.ts src/config/load.test.ts
git commit -m "feat(config): track explicit git base branch"
```

---

### Task 2: Add remote default branch detection helper

**Files:**

- Modify: `src/cli/commands/run-once/git.ts`
- Modify: `src/cli/commands/run-once/git.test.ts`

**Interfaces:**

- Consumes: `CommandRunner`, `repoRoot`, configured `remote`, and fallback
  branch.
- Produces:

```ts
export type BaseBranchDetectionResult =
  | { status: "detected"; branch: string; source: "remote-head" | "upstream" }
  | { status: "fallback"; branch: string; reason: string };

export async function detectDefaultBaseBranch(
  runner: CommandRunner,
  repoRoot: string,
  remote: string,
  fallbackBranch?: string,
): Promise<BaseBranchDetectionResult>;
```

Later tasks use `result.branch` as the effective base branch when user config
omitted `git.baseBranch`.

- [ ] **Step 1: Write failing remote-head detection test**

Update the import in `src/cli/commands/run-once/git.test.ts` to include
`detectDefaultBaseBranch`:

```ts
import {
  assertCleanWorktree,
  cleanupIssueWorkspace,
  assertIssueBaseContainedInPrBase,
  buildIssueBranchName,
  buildIssueWorktreePath,
  createIssueWorktree,
  detectDefaultBaseBranch,
  ensureIssueWorktree,
  pushBranch,
} from "./git.ts";
```

Add this test after the slug tests and before
`assertIssueBaseContainedInPrBase accepts a base contained in the target remote ref`:

```ts
test("detectDefaultBaseBranch uses the configured remote HEAD", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "origin/master\n", stderr: "" },
  ]);

  const result = await detectDefaultBaseBranch(
    runner,
    "/repo",
    "origin",
    "main",
  );

  assert.deepEqual(result, {
    status: "detected",
    branch: "master",
    source: "remote-head",
  });
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      cwd: "/repo",
    },
  ]);
});
```

- [ ] **Step 2: Write failing upstream fallback and final fallback tests**

Add these tests in the same area:

```ts
test("detectDefaultBaseBranch falls back to the current upstream on the same remote", async () => {
  const runner = createStaticCommandRunner([
    { code: 1, stdout: "", stderr: "fatal: ref not found" },
    { code: 0, stdout: "upstream/release/1.2\n", stderr: "" },
  ]);

  const result = await detectDefaultBaseBranch(
    runner,
    "/repo",
    "upstream",
    "main",
  );

  assert.deepEqual(result, {
    status: "detected",
    branch: "release/1.2",
    source: "upstream",
  });
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/upstream/HEAD",
      ],
      cwd: "/repo",
    },
    {
      command: "git",
      args: [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ],
      cwd: "/repo",
    },
  ]);
});

test("detectDefaultBaseBranch ignores upstreams from other remotes before fallback", async () => {
  const runner = createStaticCommandRunner([
    { code: 1, stdout: "", stderr: "fatal: ref not found" },
    { code: 0, stdout: "fork/main\n", stderr: "" },
  ]);

  const result = await detectDefaultBaseBranch(
    runner,
    "/repo",
    "origin",
    "main",
  );

  assert.deepEqual(result, {
    status: "fallback",
    branch: "main",
    reason: "remote-head-and-upstream-unavailable",
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
npm test -- src/cli/commands/run-once/git.test.ts
```

Expected: FAIL because `detectDefaultBaseBranch` is not exported.

- [ ] **Step 4: Implement branch parsing and detection**

In `src/cli/commands/run-once/git.ts`, add the exported type near the top after
the existing `export { buildIssueBranchSlug };` line:

```ts
export type BaseBranchDetectionResult =
  | { status: "detected"; branch: string; source: "remote-head" | "upstream" }
  | { status: "fallback"; branch: string; reason: string };
```

Add these helpers before `issueBaseTargetRef()`:

```ts
function branchFromRemoteRef(
  remote: string,
  value: string,
): string | undefined {
  const ref = value.trim();
  const shortPrefix = `${remote}/`;
  const fullPrefix = `refs/remotes/${remote}/`;
  const branch = ref.startsWith(shortPrefix)
    ? ref.slice(shortPrefix.length)
    : ref.startsWith(fullPrefix)
      ? ref.slice(fullPrefix.length)
      : undefined;
  return branch && branch.trim().length > 0 ? branch : undefined;
}

async function detectRemoteHeadBranch(
  runner: CommandRunner,
  repoRoot: string,
  remote: string,
): Promise<string | undefined> {
  const result = await runner.run(
    "git",
    ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`],
    { cwd: repoRoot },
  );
  if (result.code !== 0) return undefined;
  return branchFromRemoteRef(remote, result.stdout);
}

async function detectUpstreamBranch(
  runner: CommandRunner,
  repoRoot: string,
  remote: string,
): Promise<string | undefined> {
  const result = await runner.run(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd: repoRoot },
  );
  if (result.code !== 0) return undefined;
  return branchFromRemoteRef(remote, result.stdout);
}
```

Add the exported detection function after those helpers:

```ts
export async function detectDefaultBaseBranch(
  runner: CommandRunner,
  repoRoot: string,
  remote: string,
  fallbackBranch = DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.baseBranch,
): Promise<BaseBranchDetectionResult> {
  const remoteHeadBranch = await detectRemoteHeadBranch(
    runner,
    repoRoot,
    remote,
  );
  if (remoteHeadBranch) {
    return {
      status: "detected",
      branch: remoteHeadBranch,
      source: "remote-head",
    };
  }

  const upstreamBranch = await detectUpstreamBranch(runner, repoRoot, remote);
  if (upstreamBranch) {
    return { status: "detected", branch: upstreamBranch, source: "upstream" };
  }

  return {
    status: "fallback",
    branch: fallbackBranch,
    reason: "remote-head-and-upstream-unavailable",
  };
}
```

- [ ] **Step 5: Verify task tests pass**

Run:

```bash
npm test -- src/cli/commands/run-once/git.test.ts
```

Expected: PASS for all run-once git helper tests.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/cli/commands/run-once/git.ts src/cli/commands/run-once/git.test.ts
git commit -m "feat(run-once): detect remote default branch"
```

---

### Task 3: Wire detection into run-once config assembly

**Files:**

- Modify: `src/cli/commands/run-once/main.ts`
- Modify: `src/cli/commands/run-once/args.test.ts`

**Interfaces:**

- Consumes: `loadPatchmillConfigState().explicitConfig.gitBaseBranch` from
  Task 1.
- Consumes: `detectDefaultBaseBranch()` from Task 2.
- Produces: `loadCliConfig()` signature becomes:

```ts
export async function loadCliConfig(
  args: string[],
  repoRoot?: string,
  env?: Env,
  runner?: CommandRunner,
): Promise<AgentIssueConfig>;
```

The `runner` parameter is optional; production calls use
`createCommandRunner()`, tests inject `createStaticCommandRunner()`.

- [ ] **Step 1: Write failing run-once config detection test**

In `src/cli/commands/run-once/args.test.ts`, add this import near the other
test-support imports:

```ts
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
```

Add this test near the other `loadCliConfig` tests:

```ts
test("loadCliConfig detects git.baseBranch when it is not configured", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "origin/master\n", stderr: "" },
  ]);

  const config = await loadCliConfig(["--dry-run"], repoRoot, {}, runner);

  assert.equal(config.baseBranch, "master");
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      cwd: repoRoot,
    },
  ]);
});
```

- [ ] **Step 2: Write failing explicit-config authority test**

Add this test immediately after the previous one:

```ts
test("loadCliConfig does not detect git.baseBranch when it is explicit", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({ git: { baseBranch: "main" } }),
  );
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "origin/master\n", stderr: "" },
  ]);

  const config = await loadCliConfig(["--dry-run"], repoRoot, {}, runner);

  assert.equal(config.baseBranch, "main");
  assert.deepEqual(runner.calls, []);
});
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
npm test -- src/cli/commands/run-once/args.test.ts
```

Expected: FAIL because `loadCliConfig()` does not accept an injected runner and
does not detect the base branch.

- [ ] **Step 4: Implement config assembly detection**

In `src/cli/commands/run-once/main.ts`, update imports:

```ts
import { detectDefaultBaseBranch } from "./git.ts";
import type { CommandRunner } from "./types.ts";
```

Add this helper above `loadCliConfig()`:

```ts
async function resolveRunOnceConfigBaseBranch(
  patchmillConfig: Awaited<
    ReturnType<typeof loadPatchmillConfigState>
  >["config"],
  explicitGitBaseBranch: boolean,
  runner: CommandRunner,
  repoRoot: string,
): Promise<typeof patchmillConfig> {
  if (explicitGitBaseBranch) return patchmillConfig;

  const detection = await detectDefaultBaseBranch(
    runner,
    repoRoot,
    patchmillConfig.git.remote,
    patchmillConfig.git.baseBranch,
  );
  return {
    ...patchmillConfig,
    git: { ...patchmillConfig.git, baseBranch: detection.branch },
  };
}
```

Update `loadCliConfig()` to accept the runner and use the explicit metadata:

```ts
export async function loadCliConfig(
  args: string[],
  repoRoot = cwd(),
  env: Env = process.env,
  runner: CommandRunner = createCommandRunner(),
) {
  if (isHelpOnlyInvocation(args)) {
    return parseArgs(args, repoRoot, env);
  }

  const { config: patchmillConfig, explicitConfig } =
    await loadPatchmillConfigState(repoRoot, env, args);
  const runOnceConfig = await resolveRunOnceConfigBaseBranch(
    patchmillConfig,
    explicitConfig.gitBaseBranch,
    runner,
    repoRoot,
  );
  return parseArgs(args, repoRoot, env, runOnceConfig);
}
```

Production `main()` does not need to change because it calls
`loadCliConfig(args)` and receives the default runner.

- [ ] **Step 5: Verify task tests pass**

Run:

```bash
npm test -- src/cli/commands/run-once/args.test.ts
```

Expected: PASS for all run-once args/config tests.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/cli/commands/run-once/main.ts src/cli/commands/run-once/args.test.ts
git commit -m "feat(run-once): apply detected base branch"
```

---

### Task 4: Improve target-base error hints and update docs

**Files:**

- Modify: `src/cli/commands/run-once/git.ts`
- Modify: `src/cli/commands/run-once/git.test.ts`
- Modify: `docs/configuration.md`

**Interfaces:**

- Consumes: `detectDefaultBaseBranch()` from Task 2.
- Produces: target-ref resolution failures include a detected-branch hint when
  local metadata points at a different branch.

- [ ] **Step 1: Write failing error hint test**

In `src/cli/commands/run-once/git.test.ts`, add this test near
`assertIssueBaseContainedInPrBase reports a missing target remote ref with remediation`:

```ts
test("assertIssueBaseContainedInPrBase suggests detected remote default branch when target ref is missing", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    {
      code: 128,
      stdout: "",
      stderr: "fatal: Needed a single revision",
    },
    { code: 0, stdout: "origin/master\n", stderr: "" },
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
      assert.match(error.message, /Detected origin's default branch as master/);
      assert.match(error.message, /set git\.baseBranch to "master"/);
      return true;
    },
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/cli/commands/run-once/git.test.ts
```

Expected: FAIL because the error does not mention the detected `master` branch.

- [ ] **Step 3: Implement target-base error hinting**

In `src/cli/commands/run-once/git.ts`, add this helper near
`formatCommandFailure()`:

```ts
function prTargetBaseFailureMessage(
  targetRef: string,
  remote: string,
  baseBranch: string,
  detection?: BaseBranchDetectionResult,
): string {
  const lines = [
    `Configured PR target base ${targetRef} could not be resolved to a commit. Run git fetch ${remote}, or fix git.remote/git.baseBranch`,
  ];

  if (detection?.status === "detected" && detection.branch !== baseBranch) {
    lines.push(
      `Detected ${remote}'s default branch as ${detection.branch}; if that is the intended PR target, set git.baseBranch to "${detection.branch}" or remove the incorrect explicit git.baseBranch setting.`,
    );
  } else if (detection?.status === "fallback") {
    lines.push(
      `Patchmill could not detect ${remote}'s default branch from local git metadata and used fallback git.baseBranch "${baseBranch}". Configure git.baseBranch if the repository uses a different PR target branch.`,
    );
  }

  return lines.join(" ");
}
```

Then replace the target `verifyCommitRef()` call in
`assertIssueBaseContainedInPrBase()` with an inline verification so detection
can run only on failure:

```ts
const targetResult = await runner.run(
  "git",
  ["rev-parse", "--verify", `${targetRef}^{commit}`],
  { cwd: repoRoot },
);
if (targetResult.code !== 0) {
  const detection = await detectDefaultBaseBranch(
    runner,
    repoRoot,
    remote,
    baseBranch,
  );
  throw new Error(
    formatCommandFailure(
      prTargetBaseFailureMessage(targetRef, remote, baseBranch, detection),
      targetResult,
    ),
  );
}
```

Leave the `baseRef` verification and containment log logic unchanged.

- [ ] **Step 4: Update docs**

In `docs/configuration.md`, replace the paragraph that currently says:

```md
With the defaults, that is `refs/remotes/origin/main`.
```

with:

```md
When `git.baseBranch` is omitted, `run-once` first tries to detect the target
branch from local git metadata: `refs/remotes/<git.remote>/HEAD`, then the
current branch upstream if it tracks `<git.remote>`. If neither source is
available, Patchmill falls back to `main`, so the default target base remains
`refs/remotes/origin/main`.

Set `git.baseBranch` when the repository's PR target branch should be explicit
or when local git metadata cannot identify the remote default branch. Explicit
`git.baseBranch` values are authoritative and are not overwritten by detection.
```

Also replace this bullet:

```md
- set `git.baseRef` to an upstream ref that is already contained in the target
  base, such as `refs/remotes/origin/main`.
```

with:

```md
- set `git.baseBranch` to the repository's PR target branch if detection chose
  the wrong branch;
- set `git.baseRef` to an upstream ref that is already contained in the target
  base, such as `refs/remotes/origin/main` or `refs/remotes/origin/master`.
```

- [ ] **Step 5: Verify task tests and docs pass**

Run:

```bash
npm test -- src/cli/commands/run-once/git.test.ts
npx markdownlint-cli2 docs/configuration.md docs/specs/2026-07-04-base-branch-detection-design.md docs/plans/2026-07-04-base-branch-detection.md
npx prettier --check docs/configuration.md docs/specs/2026-07-04-base-branch-detection-design.md docs/plans/2026-07-04-base-branch-detection.md
```

Expected: all commands pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/cli/commands/run-once/git.ts src/cli/commands/run-once/git.test.ts docs/configuration.md
git commit -m "fix(run-once): explain missing target base refs"
```

---

### Task 5: Final verification and integration review

**Files:**

- No production file changes expected in this task unless verification exposes a
  bug.

**Interfaces:**

- Consumes all changes from Tasks 1-4.
- Produces a verified branch ready for code review.

- [ ] **Step 1: Run focused run-once and config tests**

Run:

```bash
npm test -- src/config/load.test.ts src/cli/commands/run-once/args.test.ts src/cli/commands/run-once/git.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS for all targeted tests.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS with `fail 0`.

- [ ] **Step 3: Run lint and formatting checks**

Run:

```bash
npm run lint
```

Expected: PASS for TypeScript lint, markdown lint, and Prettier checks.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS and `dist/` regenerated without TypeScript errors.

- [ ] **Step 5: Confirm npm dependencies did not change**

Run:

```bash
git diff --name-only main...HEAD | grep -E '(^package\.json$|^package-lock\.json$|^npm-shrinkwrap\.json$)' || true
```

Expected: no output. If there is output, run the project Nix build before final
handoff because project instructions require it for npm dependency changes.

- [ ] **Step 6: Review final diff**

Run:

```bash
git diff --stat main...HEAD
git diff main...HEAD -- src/config/load.ts src/cli/commands/run-once/git.ts src/cli/commands/run-once/main.ts docs/configuration.md | sed -n '1,260p'
```

Expected: changes are limited to config metadata, base-branch detection,
run-once config wiring, target-ref hints, docs, spec, and plan.

- [ ] **Step 7: Commit any verification fixes**

If verification required fixes, commit them with a focused Conventional Commits
subject. If no fixes were needed, do not create an empty commit.

```bash
git status --short
```

Expected: clean working tree.
