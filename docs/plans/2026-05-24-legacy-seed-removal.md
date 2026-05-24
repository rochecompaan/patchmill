# Legacy Seed Compatibility Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all Croprun compatibility fallbacks, settings, prompts, docs,
and tests so Patchmill behaves as a generic product with only `PATCHMILL_*`
configuration.

**Architecture:** Delete the compatibility layer instead of adding another
abstraction. CLI config should always use normalized Patchmill defaults, prompts
should render only from `PatchmillProjectPolicy`, and the audit script should
treat old-project tokens as failures.

**Tech Stack:** TypeScript on Node 24, Node built-in test runner, shell audit
script, JSON config loader.

---

## File map

- `scripts/agent-issue/args.ts`: remove old env reads, old policy fallback, old
  cleanup fallback, old path/worktree fallback.
- `scripts/agent-issue-triage/args.ts`: remove old env reads, old policy
  fallback, old log path fallback.
- `scripts/agent-issue-once.ts`: remove old env help text and always pass loaded
  Patchmill config into `parseArgs` for non-help invocations.
- `scripts/agent-issue-triage.ts`: remove old env help text and always pass
  loaded Patchmill config into `parseArgs` for non-help invocations.
- `src/host/forgejo-visual-evidence.ts`: make Forgejo visual evidence read only
  `PATCHMILL_FORGEJO_*` variables.
- `src/policy/defaults.ts`: delete `CROPRUN_COMPAT_POLICY` and its private
  policy text constants.
- `scripts/agent-issue/prompts.ts`: delete `isCroprunCompatPolicy()` and
  genericize all prompt branches.
- `scripts/agent-issue/pipeline.ts`: replace blocker recommendation with
  `PATCHMILL_AGENT_TEAM`.
- `src/cleanup/hooks.ts`: remove old-project cleanup preset exports and
  Tilt-specific messages.
- `scripts/agent-issue/tilt-cleanup.ts`: delete the compatibility wrapper if no
  production imports remain.
- `src/git/worktree-strategy.ts`: remove
  `LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG`.
- `src/config/defaults.ts`: remove `.pi/agent-issue/runs/` from clean-status
  ignore defaults.
- Tests under `scripts/**` and `src/**`: convert compatibility tests into
  generic-only tests or remove them.
- `README.md`, `docs/providers.md`, `docs/task-contracts.md`: remove
  migration/compatibility language.
- `docs/migration-from-croprun-scripts.md`: delete.
- `docs/specs/2026-05-22-patchmill-generalization-design.md` and
  `docs/plans/2026-05-22-patchmill-generalization.md`: sanitize old-project
  narrative or remove if no longer useful.
- `scripts/audit-generalization.sh`: replace allowlisted compatibility audit
  with a forbidden-token audit.

## Task 1: Add failing generic-only tests for argument/config behavior

**Files:**

- Modify: `scripts/agent-issue/args.test.ts`
- Modify: `scripts/agent-issue-triage/args.test.ts`
- Modify: `scripts/agent-issue-once.ts`
- Modify: `scripts/agent-issue-triage.ts`

- [ ] **Step 1: Replace run-once compatibility expectations with generic
      defaults**

In `scripts/agent-issue/args.test.ts`, remove imports of
`LEGACY_CROPRUN_CLEANUP_HOOKS` and `CROPRUN_COMPAT_POLICY`. Update the default
parse test so it asserts:

```ts
assert.equal(config.teaLogin, "triage-agent");
assert.equal(config.agentTeamName, undefined);
assert.equal(config.runStateDir, join(repoRoot, ".patchmill", "runs"));
assert.equal(config.worktreePrefix, "patchmill-issue-");
assert.deepEqual(config.cleanupHooks, []);
assert.deepEqual(config.projectPolicy, DEFAULT_PATCHMILL_POLICY);
assert.deepEqual(config.cleanStatusIgnorePrefixes, [
  ".patchmill/runs/",
  ".patchmill/triage-runs/",
]);
```

- [ ] **Step 2: Add run-once old env ignored tests**

In `scripts/agent-issue/args.test.ts`, replace the tests that read old env
variables with these assertions:

```ts
test("parseArgs ignores removed legacy host login variables", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
    CROPRUN_TRIAGE_TEA_LOGIN: "triage-agent-legacy",
  });
  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs ignores removed legacy agent team variable", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "legacy-team",
  });
  assert.equal(config.agentTeamName, undefined);
});
```

- [ ] **Step 3: Update run-once config loader tests**

In `scripts/agent-issue/args.test.ts`, replace tests named like “preserves
Croprun compatibility defaults when no patchmill config file exists” with a
generic test:

```ts
test("loadCliConfig uses normalized Patchmill defaults when no config file exists", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-args-"));
  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "legacy-login",
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "legacy-team",
  });
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.agentTeamName, undefined);
  assert.equal(config.runStateDir, join(repoRoot, ".patchmill", "runs"));
  assert.equal(config.worktreePrefix, "patchmill-issue-");
  assert.deepEqual(config.cleanupHooks, []);
  assert.deepEqual(config.projectPolicy, DEFAULT_PATCHMILL_POLICY);
});
```

- [ ] **Step 4: Update triage argument tests**

In `scripts/agent-issue-triage/args.test.ts`, replace old env fallback tests
with:

```ts
test("parseArgs ignores removed legacy triage login variable", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    CROPRUN_TRIAGE_TEA_LOGIN: "legacy-bot",
  });
  assert.equal(config.teaLogin, "triage-agent");
});

test("loadCliConfig uses normalized Patchmill triage defaults without config file", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-args-"));
  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_TRIAGE_TEA_LOGIN: "legacy-bot",
  });
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.logDir, join(repoRoot, ".patchmill", "triage-runs"));
  assert.deepEqual(config.projectPolicy, DEFAULT_PATCHMILL_POLICY);
});
```

- [ ] **Step 5: Run focused tests and confirm they fail before runtime edits**

Run:

```sh
npm run test:run-once -- --test-name-pattern="parseArgs|loadCliConfig"
npm run test:triage -- --test-name-pattern="parseArgs|loadCliConfig"
```

Expected: failures showing old environment variables, old paths, old policy, or
old cleanup hooks still affect config.

## Task 2: Remove runtime config fallbacks

**Files:**

- Modify: `scripts/agent-issue/args.ts`
- Modify: `scripts/agent-issue-triage/args.ts`
- Modify: `scripts/agent-issue-once.ts`
- Modify: `scripts/agent-issue-triage.ts`
- Modify: `scripts/agent-issue/pipeline.ts`
- Modify: `src/git/worktree-strategy.ts`

- [ ] **Step 1: Simplify run-once defaults**

In `scripts/agent-issue/args.ts`:

- Remove imports of `LEGACY_CROPRUN_CLEANUP_HOOKS`, `CleanupHookConfig`,
  `LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG`, and `CROPRUN_COMPAT_POLICY`.
- Delete `cloneCleanupHooks()` if no longer used.
- Change `defaultTeaLogin()` to:

```ts
function defaultTeaLogin(env: Env, normalizedConfig?: PatchmillConfig): string {
  return (
    env.PATCHMILL_HOST_LOGIN ??
    normalizedConfig?.host.login ??
    DEFAULT_TEA_LOGIN
  );
}
```

- Change `defaultAgentTeam()` to:

```ts
function defaultAgentTeam(
  env: Env,
  normalizedConfig?: PatchmillConfig,
): string | undefined {
  return normalizedConfig?.pi.team ?? env.PATCHMILL_AGENT_TEAM;
}
```

- In `parseArgs`, remove `fallbackStrategy` and `projectPolicy` local variables.
  Initialize config values from `normalizedConfig ?? DEFAULT_PATCHMILL_CONFIG`:

```ts
const patchmillConfig = normalizedConfig ?? DEFAULT_PATCHMILL_CONFIG;
const projectPolicy = patchmillConfig.projectPolicy;
```

Use `patchmillConfig.paths.runStateDir`, `patchmillConfig.paths.worktreeDir`,
`patchmillConfig.paths.cleanStatusIgnorePrefixes`,
`patchmillConfig.cleanupHooks`, and `patchmillConfig.git.*` for defaults.

- [ ] **Step 2: Simplify triage defaults**

In `scripts/agent-issue-triage/args.ts`:

- Remove import of `CROPRUN_COMPAT_POLICY`.
- Change `defaultTeaLogin()` to:

```ts
function defaultTeaLogin(env: Env, normalizedConfig?: PatchmillConfig): string {
  return (
    env.PATCHMILL_HOST_LOGIN ??
    normalizedConfig?.host.login ??
    DEFAULT_TEA_LOGIN
  );
}
```

- In `parseArgs`, create
  `const patchmillConfig = normalizedConfig ?? DEFAULT_PATCHMILL_CONFIG;` and
  use `patchmillConfig.paths.triageLogDir`, `patchmillConfig.projectPolicy`, and
  `patchmillConfig.labels`.

- [ ] **Step 3: Always pass normalized config for non-help CLI invocations**

In both `scripts/agent-issue-once.ts` and `scripts/agent-issue-triage.ts`,
change:

```ts
const { config: patchmillConfig, hasConfigFile } =
  await loadPatchmillConfigState(repoRoot, env, args);
return parseArgs(
  args,
  repoRoot,
  env,
  hasConfigFile ? patchmillConfig : undefined,
);
```

to:

```ts
const { config: patchmillConfig } = await loadPatchmillConfigState(
  repoRoot,
  env,
  args,
);
return parseArgs(args, repoRoot, env, patchmillConfig);
```

Keep the help-only branch so help output does not need to read the filesystem.

- [ ] **Step 4: Remove old variables from help text**

In `scripts/agent-issue-once.ts`, delete the six `CROPRUN_*` environment lines.
In `scripts/agent-issue-triage.ts`, delete the `CROPRUN_TRIAGE_TEA_LOGIN` line.

- [ ] **Step 5: Update agent-team blocker wording**

In `scripts/agent-issue/pipeline.ts`, replace the recommendation string with:

```ts
"Run with --agent-team <name> or set PATCHMILL_AGENT_TEAM=<name> so worker/reviewer model and thinking are explicit.";
```

- [ ] **Step 6: Remove legacy worktree strategy export**

In `src/git/worktree-strategy.ts`, delete
`LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG`. Update tests that imported it to
use `DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG` or inline custom config.

- [ ] **Step 7: Run focused config tests**

Run:

```sh
npm run test:run-once -- --test-name-pattern="parseArgs|loadCliConfig|agent-team"
npm run test:triage -- --test-name-pattern="parseArgs|loadCliConfig"
```

Expected: focused tests pass or only fail in tests that still import removed
symbols and will be handled in later tasks.

## Task 3: Remove compatibility policy and prompt special cases

**Files:**

- Modify: `src/policy/defaults.ts`
- Modify: `src/policy/defaults.test.ts`
- Modify: `scripts/agent-issue/prompts.ts`
- Modify: `scripts/agent-issue/prompts.test.ts`
- Modify: `scripts/agent-issue-triage/agent.test.ts`
- Modify: `scripts/agent-issue/pipeline.test.ts`
- Modify: `src/pi/runner.test.ts`

- [ ] **Step 1: Delete old compatibility policy constants**

In `src/policy/defaults.ts`, delete:

- `CROPRUN_COMPAT_DIRECT_LAND_POLICY`
- `CROPRUN_COMPAT_VISUAL_EVIDENCE_POLICY`
- `CROPRUN_COMPAT_POLICY`

Keep `DEFAULT_PATCHMILL_POLICY` as the sole exported default policy.

- [ ] **Step 2: Update policy tests**

In `src/policy/defaults.test.ts`:

- Remove import of `CROPRUN_COMPAT_POLICY`.
- Delete the test that asserts old project policy preservation.
- Keep or add a test that asserts `DEFAULT_PATCHMILL_POLICY` contains neutral
  text:

```ts
test("DEFAULT_PATCHMILL_POLICY contains only generic policy text", () => {
  const text = JSON.stringify(DEFAULT_PATCHMILL_POLICY);
  assert.doesNotMatch(
    text,
    /Croprun|CROPRUN_|devenv shell|just tilt|docs\/reference-screenshots/i,
  );
});
```

- [ ] **Step 3: Remove prompt special-casing**

In `scripts/agent-issue/prompts.ts`:

- Delete `isCroprunCompatPolicy()`.
- Change `formatIssueTarget()` to:

```ts
function formatIssueTarget(policy: PatchmillProjectPolicy): string {
  if (policy.projectName) return `${policy.projectName} issue`;
  return "repository issue";
}
```

- Change `renderPrCreationInstruction()` to always return:

```ts
return `Push the branch to \`${remote}\` and open a pull request using the repository's configured host tooling.`;
```

- Change `renderPrCreatedContract()` to always use `"<pull request URL>"`.

- [ ] **Step 4: Update prompt tests**

In `scripts/agent-issue/prompts.test.ts`, remove old compatibility prompt tests
and replace fixture project names with neutral names such as `ExampleApp`. Keep
generic prompt tests asserting no old-project text leaks:

```ts
assert.doesNotMatch(
  prompt,
  /Croprun|CROPRUN_|devenv shell|just tilt|docs\/reference-screenshots/i,
);
```

- [ ] **Step 5: Update triage prompt and pipeline tests**

In `scripts/agent-issue-triage/agent.test.ts` and
`scripts/agent-issue/pipeline.test.ts`, replace imports and uses of
`CROPRUN_COMPAT_POLICY` with `DEFAULT_PATCHMILL_POLICY` or a test-local
`PatchmillProjectPolicy` object named `examplePolicy`. Replace expected prompt
titles like `Implement Croprun Forgejo issue #15` with generic expectations such
as `Implement repository issue #15`.

- [ ] **Step 6: Run prompt/policy tests**

Run:

```sh
node --test src/policy/defaults.test.ts scripts/agent-issue/prompts.test.ts scripts/agent-issue-triage/agent.test.ts src/pi/runner.test.ts
```

Expected: tests pass with no imports of removed policy symbols.

## Task 4: Remove legacy cleanup preset and path defaults

**Files:**

- Modify: `src/cleanup/hooks.ts`
- Modify: `src/cleanup/hooks.test.ts`
- Delete: `scripts/agent-issue/tilt-cleanup.ts`
- Delete: `scripts/agent-issue/tilt-cleanup.test.ts`
- Modify: `scripts/agent-issue/pipeline.test.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/defaults.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Remove bundled cleanup preset**

In `src/cleanup/hooks.ts`, delete `TILT_JUST_CLEANUP_HOOK` and
`LEGACY_CROPRUN_CLEANUP_HOOKS`. Replace Tilt-specific message branches with
generic messages:

```ts
function skippedMissingPath(hook: CleanupHookConfig): CleanupHookResult {
  return {
    status: "skipped",
    name: hook.name,
    message: `${hookLabel(hook)}: ${hook.whenPathExists} not found`,
  };
}

function cleanedMessage(hook: CleanupHookConfig, worktreePath: string): string {
  return `${hookLabel(hook)}: completed for ${worktreePath}`;
}
```

For process and command failures, always use `process cleanup failed` and
`command failed` messages without Tilt wording.

- [ ] **Step 2: Remove compatibility wrapper files**

Delete `scripts/agent-issue/tilt-cleanup.ts` and
`scripts/agent-issue/tilt-cleanup.test.ts`. Remove them from any imports in
`scripts/agent-issue/pipeline.test.ts`.

- [ ] **Step 3: Convert cleanup tests to generic hooks**

In `src/cleanup/hooks.test.ts` and affected
`scripts/agent-issue/pipeline.test.ts` cleanup tests, replace `tilt-just`
fixtures with a generic hook:

```ts
const cleanupHook = {
  name: "example-cleanup",
  whenPathExists: ".env",
  terminateProcessPatterns: ["example dev server"],
  command: "npm",
  args: ["run", "cleanup:example"],
};
```

Assert generic messages such as
`cleanup hook example-cleanup: completed for .worktrees/patchmill-issue-45-cleanup-example`.

- [ ] **Step 4: Remove legacy run-state ignore path**

In `src/config/defaults.ts`, change `cleanStatusIgnorePrefixes` to:

```ts
cleanStatusIgnorePrefixes: [".patchmill/runs/", ".patchmill/triage-runs/"],
```

Update `src/config/defaults.test.ts` and any `scripts/agent-issue/*.test.ts`
expectations accordingly.

- [ ] **Step 5: Remove old local-state ignore entries**

In `.gitignore`, remove `.pi/agent-issue` entries if present. Keep generic
`.patchmill` ignore entries.

- [ ] **Step 6: Run cleanup/config tests**

Run:

```sh
node --test src/cleanup/hooks.test.ts src/config/defaults.test.ts scripts/agent-issue/pipeline.test.ts
```

Expected: tests pass with generic cleanup fixtures and no old path defaults.

## Task 5: Remove Forgejo visual-evidence env fallbacks

**Files:**

- Modify: `src/host/forgejo-visual-evidence.ts`
- Modify: `src/host/forgejo-visual-evidence.test.ts`
- Modify: `scripts/agent-issue/visual-evidence.test.ts`

- [ ] **Step 1: Narrow visual evidence env type**

In `src/host/forgejo-visual-evidence.ts`, change `ForgejoVisualEvidenceEnv` to
include only:

```ts
| "PATCHMILL_FORGEJO_URL"
| "PATCHMILL_FORGEJO_TOKEN"
| "PATCHMILL_FORGEJO_REPO"
```

Delete the fallback parameter from `envValue()` and make it return only the
primary value:

```ts
function envValue(
  env: ForgejoVisualEvidenceEnv,
  primary:
    | "PATCHMILL_FORGEJO_URL"
    | "PATCHMILL_FORGEJO_TOKEN"
    | "PATCHMILL_FORGEJO_REPO",
): string | undefined {
  return trimmedEnvValue(env[primary]);
}
```

- [ ] **Step 2: Update all `envValue` calls**

Change calls to:

```ts
envValue(env, "PATCHMILL_FORGEJO_URL");
envValue(env, "PATCHMILL_FORGEJO_TOKEN");
envValue(env, "PATCHMILL_FORGEJO_REPO");
```

- [ ] **Step 3: Replace fallback tests with ignored-env tests**

In `src/host/forgejo-visual-evidence.test.ts`, replace old fallback tests with:

```ts
test("ForgejoVisualEvidenceUploader ignores removed legacy env variables", async () => {
  assert.equal(
    hasForgejoVisualEvidenceConfig({
      CROPRUN_AGENT_ISSUE_FORGEJO_URL: "https://forgejo.example/",
      CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN: "legacy-token",
    } as NodeJS.ProcessEnv),
    false,
  );
});
```

In `scripts/agent-issue/visual-evidence.test.ts`, assert
`defaultVisualEvidenceUploader()` returns the no-op uploader when only old
variables are set.

- [ ] **Step 4: Run visual evidence tests**

Run:

```sh
node --test src/host/forgejo-visual-evidence.test.ts scripts/agent-issue/visual-evidence.test.ts
```

Expected: tests pass and old variables are ignored.

## Task 6: Remove or sanitize docs and update the audit script

**Files:**

- Modify: `README.md`
- Delete: `docs/migration-from-croprun-scripts.md`
- Modify: `docs/providers.md`
- Modify: `docs/task-contracts.md`
- Modify: `docs/specs/2026-05-22-patchmill-generalization-design.md`
- Modify: `docs/plans/2026-05-22-patchmill-generalization.md`
- Modify: `scripts/audit-generalization.sh`

- [ ] **Step 1: Remove migration guide**

Delete `docs/migration-from-croprun-scripts.md`. Remove links to it from
`README.md`, `docs/providers.md`, and `docs/task-contracts.md`.

- [ ] **Step 2: Rewrite user-facing docs as generic Patchmill docs**

Update `README.md`, `docs/providers.md`, and `docs/task-contracts.md` so they
describe only:

- `patchmill triage`
- `patchmill run-once`
- `PATCHMILL_*` environment variables
- `.patchmill/*` state paths
- `patchmill.config.json`

Do not mention old commands, old variables, old migration status, or
compatibility fallbacks.

- [ ] **Step 3: Sanitize historical generalization docs**

In `docs/specs/2026-05-22-patchmill-generalization-design.md` and
`docs/plans/2026-05-22-patchmill-generalization.md`, replace old-project
provenance language with neutral phrases such as “the seed automation scripts”
or “the initial Forgejo + Pi workflow.” Remove code snippets showing `CROPRUN_*`
variables or compatibility policy names. If a section exists only to document
removed compatibility behavior, delete the section.

- [ ] **Step 4: Replace audit allowlists with forbidden-token checks**

Rewrite `scripts/audit-generalization.sh` so it scans tracked product files and
fails on these patterns:

```sh
Croprun
CROPRUN_
CROPRUN_COMPAT_POLICY
LEGACY_CROPRUN_CLEANUP_HOOKS
isCroprunCompatPolicy
.pi/agent-issue
```

Keep exclusions for dependencies and generated outputs. During this branch,
explicitly exclude only `docs/specs/2026-05-24-legacy-seed-removal-design.md`
and `docs/plans/2026-05-24-legacy-seed-removal.md`, because they are the
requested audit artifacts.

- [ ] **Step 5: Run audit and fix remaining hits**

Run:

```sh
npm run audit:generalization
rg -n -i --hidden --glob '!node_modules' --glob '!dist' --glob '!coverage' --glob '!*.lock' 'croprun|CROPRUN|\.pi/agent-issue' README.md docs src scripts bin package.json .gitignore
```

Expected: the audit script passes. The manual `rg` reports only the two
2026-05-24 removal documents, or no output if those files are excluded from the
command.

## Task 7: Full test and final cleanup

**Files:**

- Modify as needed based on compiler/test failures.

- [ ] **Step 1: Run the full test suite**

Run:

```sh
npm test
```

Expected: all Node tests pass.

- [ ] **Step 2: Run the audit script**

Run:

```sh
npm run audit:generalization
```

Expected: audit passes and reports no allowed compatibility references.

- [ ] **Step 3: Run a final symbol scan**

Run:

```sh
rg -n 'CROPRUN_|CROPRUN_COMPAT_POLICY|LEGACY_CROPRUN_CLEANUP_HOOKS|isCroprunCompatPolicy|LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG' src scripts bin README.md docs package.json .gitignore
```

Expected: no matches except this implementation plan and the matching removal
design document if they are included in the scan.

- [ ] **Step 4: Review git diff**

Run:

```sh
git diff --stat
git diff -- README.md docs src scripts bin package.json .gitignore
```

Expected: diff removes compatibility code/docs/tests without changing generic
host provider, Pi runner, issue selection, run-state checkpointing, or
cleanup-hook framework semantics beyond the old preset removal.

- [ ] **Step 5: Commit after review approval**

After the user approves implementation results, run:

```sh
git add README.md docs src scripts bin package.json .gitignore
git commit -m "refactor: remove legacy seed compatibility fallbacks"
```

Expected: one commit containing the removal.

## Self-review

- Spec coverage: Tasks cover runtime env fallbacks, config loading, old policy
  removal, prompt special-casing, cleanup presets, visual-evidence env
  fallbacks, docs, tests, audit tooling, and verification.
- Placeholder scan: No implementation step relies on unspecified future
  decisions; every task lists exact files, commands, and expected results.
- Type consistency: Removed symbols are listed consistently across runtime and
  tests: `CROPRUN_COMPAT_POLICY`, `LEGACY_CROPRUN_CLEANUP_HOOKS`,
  `isCroprunCompatPolicy`, and `LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG`.
