# Explicit Cleanup Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Patchmill's implicit cleanup-hook objects and process
termination with one explicit repository-relative shell script path.

**Architecture:** Cleanup becomes a small Pi workflow helper in
`src/pi/hooks.ts`. Configuration exposes one optional `cleanupHook?: string`,
and the issue pipeline runs `bash <cleanupHook>` from the finished worktree root
when configured.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing
`CommandRunner` abstraction, JSON config loading.

---

## File structure

- Delete: `src/cleanup/hooks.ts`
- Delete: `src/cleanup/hooks.test.ts`
- Delete: `src/cleanup/types.ts`
- Create: `src/pi/hooks.ts`
  - Owns small Pi workflow hook helpers.
  - Exports `PiHookResult` and `runCleanupHookScript(...)`.
- Create: `src/pi/hooks.test.ts`
  - Tests the explicit script behavior only.
- Modify: `src/config/types.ts`
  - Remove cleanup type import.
  - Replace `cleanupHooks` with optional `cleanupHook?: string`.
- Modify: `src/config/defaults.ts`
  - Remove `cleanupHooks: []` default.
- Modify: `src/config/load.ts`
  - Remove `CleanupHookConfig`, `cloneCleanupHooks`, and `readCleanupHooks`.
  - Add string-only `cleanupHook` parsing.
  - Reject legacy `cleanupHooks` config with a clear error.
- Modify: `src/config/load.test.ts`
  - Update clone/default/full-config tests for singular `cleanupHook`.
  - Add non-string `cleanupHook` rejection.
  - Add legacy `cleanupHooks` rejection.
- Modify: `src/config/defaults.test.ts`
  - Remove `cleanupHooks: []` expectation.
- Modify: `scripts/agent-issue/types.ts`
  - Remove cleanup type import.
  - Replace `cleanupHooks` with optional `cleanupHook?: string`.
- Modify: `scripts/agent-issue/args.ts`
  - Copy `patchmillConfig.cleanupHook` into runtime config.
- Modify: `scripts/agent-issue/args.test.ts`
  - Update default/config assertions from `cleanupHooks` to `cleanupHook`.
- Modify: `scripts/agent-issue/pipeline.ts`
  - Import `runCleanupHookScript` from `src/pi/hooks.ts`.
  - Pass `config.cleanupHook` instead of `config.cleanupHooks`.
- Modify: `scripts/agent-issue/pipeline.test.ts`
  - Replace the generic cleanup hook integration test with a script-path test.
  - Remove all process-termination call assertions.
- Modify: `docs/configuration.md`
  - Replace the `cleanupHooks` object-array example with `cleanupHook`.

## Task 1: Add explicit Pi cleanup hook runner

**Files:**

- Create: `src/pi/hooks.test.ts`
- Create: `src/pi/hooks.ts`
- Delete in Step 5: `src/cleanup/hooks.ts`
- Delete in Step 5: `src/cleanup/hooks.test.ts`
- Delete in Step 5: `src/cleanup/types.ts`

- [ ] **Step 1: Write the failing Pi hook tests**

Create `src/pi/hooks.test.ts` with this complete file:

```ts
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { runCleanupHookScript } from "./hooks.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function recordingRunner(results: CommandResult[] = []): {
  runner: {
    run(
      command: string,
      args: string[],
      options?: { cwd?: string },
    ): Promise<CommandResult>;
  };
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let resultIndex = 0;

  return {
    calls,
    runner: {
      async run(command, args, options = {}) {
        calls.push({ command, args, cwd: options.cwd });
        const result = results[resultIndex] ?? {
          code: 0,
          stdout: "",
          stderr: "",
        };
        resultIndex += 1;
        return result;
      },
    },
  };
}

test("runCleanupHookScript is a no-op when no cleanup hook is configured", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const { runner, calls } = recordingRunner();

  const result = await runCleanupHookScript(
    runner,
    repoRoot,
    ".worktrees/issue-45",
    undefined,
  );

  assert.deepEqual(result, []);
  assert.deepEqual(calls, []);
});

test("runCleanupHookScript runs the configured shell script from the worktree root", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  const worktreeRoot = join(repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  const { runner, calls } = recordingRunner();

  const [result] = await runCleanupHookScript(
    runner,
    repoRoot,
    worktreePath,
    "./scripts/cleanup.sh",
  );

  assert.equal(result?.name, "./scripts/cleanup.sh");
  assert.equal(result?.status, "cleaned");
  assert.equal(
    result?.message,
    "cleanup hook ./scripts/cleanup.sh: completed for .worktrees/patchmill-issue-45-cleanup-example",
  );
  assert.deepEqual(calls, [
    { command: "bash", args: ["./scripts/cleanup.sh"], cwd: worktreeRoot },
  ]);
});

test("runCleanupHookScript reports script failures with hook context", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  await mkdir(join(repoRoot, worktreePath), { recursive: true });
  const { runner, calls } = recordingRunner([
    {
      code: 1,
      stdout: "",
      stderr: "cleanup refused: missing .env",
    },
  ]);

  const [result] = await runCleanupHookScript(
    runner,
    repoRoot,
    worktreePath,
    "./scripts/cleanup.sh",
  );

  assert.equal(result?.name, "./scripts/cleanup.sh");
  assert.equal(result?.status, "failed");
  assert.equal(
    result?.message,
    "cleanup hook ./scripts/cleanup.sh: command failed: cleanup refused: missing .env",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "bash");
});

test("runCleanupHookScript reports a configured hook without a worktree path as failed", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const { runner, calls } = recordingRunner();

  const [result] = await runCleanupHookScript(
    runner,
    repoRoot,
    undefined,
    "./scripts/cleanup.sh",
  );

  assert.equal(result?.name, "./scripts/cleanup.sh");
  assert.equal(result?.status, "failed");
  assert.equal(
    result?.message,
    "cleanup hook ./scripts/cleanup.sh: no worktree path",
  );
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run the new tests and verify they fail because the module is
      missing**

Run:

```bash
node --test src/pi/hooks.test.ts
```

Expected: FAIL with an import/module error for `src/pi/hooks.ts` or
`runCleanupHookScript`.

- [ ] **Step 3: Implement the explicit hook runner**

Create `src/pi/hooks.ts` with this complete file:

```ts
import { join } from "node:path";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";

export type PiHookResult = {
  name: string;
  status: "cleaned" | "failed";
  message: string;
};

function failureMessage(step: string, stderr: string, stdout: string): string {
  const details = (stderr || stdout).trim();
  return details ? `${step}: ${details}` : step;
}

function hookLabel(cleanupHook: string): string {
  return `cleanup hook ${cleanupHook}`;
}

export async function runCleanupHookScript(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string | undefined,
  cleanupHook: string | undefined,
): Promise<PiHookResult[]> {
  if (!cleanupHook) return [];

  if (!worktreePath) {
    return [
      {
        status: "failed",
        name: cleanupHook,
        message: `${hookLabel(cleanupHook)}: no worktree path`,
      },
    ];
  }

  const result = await runner.run("bash", [cleanupHook], {
    cwd: join(repoRoot, worktreePath),
  });

  if (result.code !== 0) {
    return [
      {
        status: "failed",
        name: cleanupHook,
        message: failureMessage(
          `${hookLabel(cleanupHook)}: command failed`,
          result.stderr,
          result.stdout,
        ),
      },
    ];
  }

  return [
    {
      status: "cleaned",
      name: cleanupHook,
      message: `${hookLabel(cleanupHook)}: completed for ${worktreePath}`,
    },
  ];
}
```

- [ ] **Step 4: Run the Pi hook tests and verify they pass**

Run:

```bash
node --test src/pi/hooks.test.ts
```

Expected: PASS for all tests in `src/pi/hooks.test.ts`.

- [ ] **Step 5: Delete the old cleanup directory**

Run:

```bash
rm -rf src/cleanup
```

Expected: `src/cleanup/hooks.ts`, `src/cleanup/hooks.test.ts`, and
`src/cleanup/types.ts` are removed.

- [ ] **Step 6: Commit the Pi hook runner**

Run:

```bash
git add src/pi/hooks.ts src/pi/hooks.test.ts src/cleanup
git commit -m "refactor(pi): add explicit cleanup hook runner"
```

Expected: commit succeeds.

## Task 2: Replace cleanup config shape

**Files:**

- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/load.ts`
- Modify: `src/config/load.test.ts`
- Modify: `src/config/defaults.test.ts`

- [ ] **Step 1: Update config type and default tests first**

In `src/config/types.ts`, remove this import:

```ts
import type { CleanupHookConfig } from "../cleanup/types.ts";
```

Then replace this field in `PatchmillConfig`:

```ts
  cleanupHooks: CleanupHookConfig[];
```

with:

```ts
  cleanupHook?: string;
```

In `src/config/defaults.ts`, delete this property from
`DEFAULT_PATCHMILL_CONFIG`:

```ts
  cleanupHooks: [],
```

In `src/config/defaults.test.ts`, remove the expected property:

```ts
    cleanupHooks: [],
```

- [ ] **Step 2: Run config/default type-adjacent tests and verify failures
      identify old loader references**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts
```

Expected: FAIL with TypeScript/runtime errors mentioning old `cleanupHooks`,
`CleanupHookConfig`, or deleted `src/cleanup/types.ts` imports.

- [ ] **Step 3: Update `src/config/load.ts` types and clone/merge behavior**

In `src/config/load.ts`, remove this import:

```ts
import type { CleanupHookConfig } from "../cleanup/types.ts";
```

In the `PartialConfig` type, replace:

```ts
  cleanupHooks: CleanupHookConfig[];
```

with:

```ts
cleanupHook: string;
```

Delete the entire `cloneCleanupHooks` function:

```ts
function cloneCleanupHooks(hooks: CleanupHookConfig[]): CleanupHookConfig[] {
  return hooks.map((hook) => ({
    name: hook.name,
    ...(hook.whenPathExists !== undefined
      ? { whenPathExists: hook.whenPathExists }
      : {}),
    ...(hook.terminateProcessPatterns !== undefined
      ? {
          terminateProcessPatterns: cloneStringArray(
            hook.terminateProcessPatterns,
          ),
        }
      : {}),
    ...(hook.command !== undefined ? { command: hook.command } : {}),
    ...(hook.args !== undefined ? { args: cloneStringArray(hook.args) } : {}),
  }));
}
```

In `mergeConfig`, replace:

```ts
    cleanupHooks: cloneCleanupHooks(update.cleanupHooks ?? base.cleanupHooks),
```

with:

```ts
    ...(update.cleanupHook !== undefined || base.cleanupHook !== undefined
      ? { cleanupHook: update.cleanupHook ?? base.cleanupHook }
      : {}),
```

In `absolutizePaths`, replace:

```ts
    cleanupHooks: cloneCleanupHooks(config.cleanupHooks),
```

with no cleanup field. The returned object should keep any existing
`cleanupHook` through `...config`, and the value must remain
repository-relative.

- [ ] **Step 4: Replace cleanup parsing in `src/config/load.ts`**

Delete the entire `readCleanupHooks` function that starts with:

```ts
function readCleanupHooks(
  source: Record<string, unknown>,
): CleanupHookConfig[] | undefined {
```

and ends after mapping hook entries.

Add this function near the other small config readers:

```ts
function readCleanupHook(source: Record<string, unknown>): string | undefined {
  if (source.cleanupHooks !== undefined) {
    throw configError(
      "cleanupHooks",
      "removed; use cleanupHook as a repository-relative shell script path",
      source.cleanupHooks,
    );
  }

  return readOptionalString(source, "cleanupHook", "cleanupHook");
}
```

In `readConfigFile`, replace:

```ts
const cleanupHooks = readCleanupHooks(data);
if (cleanupHooks !== undefined) {
  config.cleanupHooks = cleanupHooks;
}
```

with:

```ts
const cleanupHook = readCleanupHook(data);
if (cleanupHook !== undefined) {
  config.cleanupHook = cleanupHook;
}
```

- [ ] **Step 5: Update config load tests for the new field**

In `src/config/load.test.ts`, replace the default cleanup assertion:

```ts
assert.deepEqual(config.cleanupHooks, []);
```

with:

```ts
assert.equal(config.cleanupHook, undefined);
```

In the clone-isolation test, remove these two assertions:

```ts
assert.notStrictEqual(
  first.cleanupHooks,
  DEFAULT_PATCHMILL_CONFIG.cleanupHooks,
);
assert.notStrictEqual(first.cleanupHooks, second.cleanupHooks);
```

Remove this mutation:

```ts
first.cleanupHooks.push({ name: "custom-cleanup" });
```

Replace this final assertion:

```ts
assert.deepEqual(second.cleanupHooks, DEFAULT_PATCHMILL_CONFIG.cleanupHooks);
```

with:

```ts
assert.equal(second.cleanupHook, DEFAULT_PATCHMILL_CONFIG.cleanupHook);
```

In the full config fixture, replace:

```ts
      cleanupHooks: [
        {
          name: "custom-cleanup",
          whenPathExists: ".env",
          command: "just",
          args: ["cleanup"],
        },
      ],
```

with:

```ts
      cleanupHook: "./scripts/cleanup.sh",
```

Replace the corresponding assertion:

```ts
assert.deepEqual(config.cleanupHooks, [
  {
    name: "custom-cleanup",
    whenPathExists: ".env",
    command: "just",
    args: ["cleanup"],
  },
]);
```

with:

```ts
assert.equal(config.cleanupHook, "./scripts/cleanup.sh");
```

Add these two tests near the other config validation tests:

```ts
test("loadPatchmillConfig rejects non-string cleanupHook", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({ cleanupHook: ["./scripts/cleanup.sh"] }),
  );

  await assert.rejects(
    () => loadPatchmillConfig(dir, {}, []),
    /cleanupHook must be a string/,
  );
});

test("loadPatchmillConfig rejects removed cleanupHooks config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({ cleanupHooks: [{ name: "legacy-cleanup" }] }),
  );

  await assert.rejects(
    () => loadPatchmillConfig(dir, {}, []),
    /cleanupHooks must be removed; use cleanupHook as a repository-relative shell script path/,
  );
});
```

- [ ] **Step 6: Run config tests and verify they pass**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit config shape replacement**

Run:

```bash
git add src/config/types.ts src/config/defaults.ts src/config/load.ts src/config/load.test.ts src/config/defaults.test.ts
git commit -m "refactor(config): use singular cleanup hook path"
```

Expected: commit succeeds.

## Task 3: Wire cleanupHook through args and pipeline

**Files:**

- Modify: `scripts/agent-issue/types.ts`
- Modify: `scripts/agent-issue/args.ts`
- Modify: `scripts/agent-issue/args.test.ts`
- Modify: `scripts/agent-issue/pipeline.ts`
- Modify: `scripts/agent-issue/pipeline.test.ts`

- [ ] **Step 1: Update runtime config types**

In `scripts/agent-issue/types.ts`, remove this import:

```ts
import type { CleanupHookConfig } from "../../src/cleanup/types.ts";
```

Replace this field in `AgentIssueConfig`:

```ts
  cleanupHooks: CleanupHookConfig[];
```

with:

```ts
  cleanupHook?: string;
```

- [ ] **Step 2: Update argument-derived config**

In `scripts/agent-issue/args.ts`, replace:

```ts
    cleanupHooks: [...patchmillConfig.cleanupHooks],
```

with:

```ts
    ...(patchmillConfig.cleanupHook !== undefined
      ? { cleanupHook: patchmillConfig.cleanupHook }
      : {}),
```

- [ ] **Step 3: Update args tests**

In `scripts/agent-issue/args.test.ts`, replace each default assertion:

```ts
assert.deepEqual(config.cleanupHooks, []);
```

with:

```ts
assert.equal(config.cleanupHook, undefined);
```

If a test builds a normalized config with `cleanupHooks`, replace that property
with:

```ts
cleanupHook: "./scripts/cleanup.sh",
```

and assert:

```ts
assert.equal(config.cleanupHook, "./scripts/cleanup.sh");
```

- [ ] **Step 4: Update pipeline import and invocation**

In `scripts/agent-issue/pipeline.ts`, replace:

```ts
import { runCleanupHooks } from "../../src/cleanup/hooks.ts";
```

with:

```ts
import { runCleanupHookScript } from "../../src/pi/hooks.ts";
```

Replace the cleanup call:

```ts
const cleanupResults = await runCleanupHooks(
  runner,
  config.repoRoot,
  worktreePath,
  config.cleanupHooks,
);
```

with:

```ts
const cleanupResults = await runCleanupHookScript(
  runner,
  config.repoRoot,
  worktreePath,
  config.cleanupHook,
);
```

Leave the existing progress loop in place. It should continue to log each result
using `cleanup.name` and `cleanup.status`.

- [ ] **Step 5: Update pipeline cleanup test fixture**

In `scripts/agent-issue/pipeline.test.ts`, replace the `cleanupHook` object
constant:

```ts
const cleanupHook = {
  name: "example-cleanup",
  whenPathExists: ".env",
  terminateProcessPatterns: ["example dev server"],
  command: "npm",
  args: ["run", "cleanup:example"],
};
```

with:

```ts
const cleanupHook = "./scripts/cleanup.sh";
```

In the test named `runOneIssue runs configured generic cleanup hooks`, rename it
to:

```ts
test("runOneIssue runs configured cleanup hook script", async () => {
```

Inside that test, replace:

```ts
    cleanupHooks: [cleanupHook],
```

with:

```ts
    cleanupHook,
```

Remove this setup line because Patchmill no longer checks it:

```ts
await writeFile(join(worktreeRoot, ".env"), "READY=1\n", "utf8");
```

Replace the mock runner cleanup command branches:

```ts
if (
  call.command === "bash" &&
  call.args[0] === "-c" &&
  call.args[3] === worktreeRoot
)
  return { code: 0, stdout: "", stderr: "" };
if (
  call.command === "npm" &&
  call.args[0] === "run" &&
  call.args[1] === "cleanup:example" &&
  call.cwd === worktreeRoot
)
  return { code: 0, stdout: "", stderr: "" };
```

with:

```ts
if (
  call.command === "bash" &&
  call.args[0] === "./scripts/cleanup.sh" &&
  call.cwd === worktreeRoot
)
  return { code: 0, stdout: "", stderr: "" };
```

Replace the cleanup call assertions:

```ts
const cleanupCalls = runner.calls.filter(
  (call) =>
    (call.command === "bash" && call.args[0] === "-c") ||
    (call.command === "npm" && call.args[0] === "run"),
);
assert.equal(cleanupCalls[0]?.command, "bash");
assert.equal(cleanupCalls[0]?.args[0], "-c");
assert.equal(cleanupCalls[0]?.args[2], "example-cleanup");
assert.equal(cleanupCalls[0]?.args[3], worktreeRoot);
assert.equal(cleanupCalls[0]?.args[4], "example dev server");
assert.equal(cleanupCalls[0]?.cwd, config.repoRoot);
assert.deepEqual(cleanupCalls[1], {
  command: "npm",
  args: ["run", "cleanup:example"],
  cwd: worktreeRoot,
  onStdout: undefined,
  onStderr: undefined,
});
```

with:

```ts
const cleanupCalls = runner.calls.filter(
  (call) => call.command === "bash" && call.args[0] === "./scripts/cleanup.sh",
);
assert.deepEqual(cleanupCalls, [
  {
    command: "bash",
    args: ["./scripts/cleanup.sh"],
    cwd: worktreeRoot,
    onStdout: undefined,
    onStderr: undefined,
  },
]);
```

Replace the progress message assertion:

```ts
          "cleanup hook example-cleanup: completed for .worktrees/patchmill-issue-45-cleanup-example",
```

with:

```ts
          "cleanup hook ./scripts/cleanup.sh: completed for .worktrees/patchmill-issue-45-cleanup-example",
```

- [ ] **Step 6: Run targeted args and pipeline tests**

Run:

```bash
node --test scripts/agent-issue/args.test.ts scripts/agent-issue/pipeline.test.ts --test-name-pattern="cleanup hook|parseArgs|default"
```

Expected: PASS for matching tests. If the broad `default` pattern runs many
tests and reports old `cleanupHooks` references, run
`rg "cleanupHooks" scripts/agent-issue` and replace each runtime config field
with `cleanupHook` using the exact edits from Steps 1 through 5, then rerun the
command.

- [ ] **Step 7: Commit runtime wiring**

Run:

```bash
git add scripts/agent-issue/types.ts scripts/agent-issue/args.ts scripts/agent-issue/args.test.ts scripts/agent-issue/pipeline.ts scripts/agent-issue/pipeline.test.ts
git commit -m "refactor(agent): run configured cleanup script"
```

Expected: commit succeeds.

## Task 4: Update docs and remove stale references

**Files:**

- Modify: `docs/configuration.md`
- Inspect: files reported by
  `rg "cleanupHooks|terminateProcessPatterns|whenPathExists|CleanupHookConfig|src/cleanup"`

- [ ] **Step 1: Update the configuration example**

In `docs/configuration.md`, replace this example block:

```json
  "cleanupHooks": [
    {
      "name": "stop-local-dev-server",
      "whenPathExists": ".env",
      "terminateProcessPatterns": ["npm run dev"],
      "command": "npm",
      "args": ["run", "cleanup"]
    }
  ],
```

with:

```json
  "cleanupHook": "./scripts/cleanup.sh",
```

If the prose around the example mentions cleanup hook objects, replace it with
this wording:

```md
`cleanupHook` is an optional repository-relative shell script path. Patchmill
runs it with `bash` from the issue worktree root after a successful run. The
script is responsible for its own safety checks and any repository-specific
process shutdown.
```

- [ ] **Step 2: Search for stale code references**

Run:

```bash
rg "cleanupHooks|terminateProcessPatterns|whenPathExists|CleanupHookConfig|src/cleanup|runCleanupHooks" src scripts docs/configuration.md
```

Expected: no matches in `src`, `scripts`, or `docs/configuration.md`.

Do not edit historical design/plan documents under `docs/specs/` or
`docs/plans/` solely to remove old references. They are records of previous
designs unless a current test or audit requires changing them.

- [ ] **Step 3: Run lint on edited markdown and TypeScript**

Run:

```bash
npm run lint
```

Expected: PASS. If markdown line length or formatting changes are needed, run
`npm run format -- docs/configuration.md` and rerun lint.

- [ ] **Step 4: Commit docs cleanup**

Run:

```bash
git add docs/configuration.md
git commit -m "docs(config): document explicit cleanup hook"
```

Expected: commit succeeds.

## Task 5: Final verification

**Files:**

- Verify all changed files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test src/pi/hooks.test.ts src/config/defaults.test.ts src/config/load.test.ts scripts/agent-issue/args.test.ts scripts/agent-issue/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Confirm no stale cleanup implementation remains**

Run:

```bash
test ! -d src/cleanup
rg "cleanupHooks|terminateProcessPatterns|whenPathExists|CleanupHookConfig|runCleanupHooks" src scripts docs/configuration.md
```

Expected: `test ! -d src/cleanup` exits `0`, and `rg` prints no matches and
exits `1` because there are no matches.

- [ ] **Step 5: Review final diff**

Run:

```bash
git status --short
git diff --stat HEAD~4..HEAD
```

Expected: only intended cleanup-hook implementation, config, pipeline, tests,
and documentation changes are present.

- [ ] **Step 6: Final commit if lint/test fixes were needed after Task 4**

If Task 5 required additional edits, commit them:

```bash
git add src scripts docs/configuration.md
git commit -m "chore(cleanup): finish explicit hook migration"
```

Expected: commit succeeds if there were additional changes. If there were no
changes, skip this step.

## Self-review

- Spec coverage: The plan replaces `cleanupHooks` with `cleanupHook`, removes
  process discovery/termination, deletes `src/cleanup/`, adds `src/pi/hooks.ts`,
  updates config/pipeline/docs, and adds focused tests.
- Placeholder scan: No placeholder markers or undefined implementation steps
  remain.
- Type consistency: The plan consistently uses `cleanupHook?: string`,
  `runCleanupHookScript(...)`, and `PiHookResult` with `cleaned | failed`
  statuses.
