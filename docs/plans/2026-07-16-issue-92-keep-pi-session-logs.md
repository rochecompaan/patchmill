# Issue 92 Keep Pi Session Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Pi session JSONL logs for every Patchmill `run-once` Pi invocation without letting durable log directories confuse current-session streaming.

**Architecture:** Split prompt temporary storage from session-log storage. `runPiPrompt()` remains the Pi boundary and owns session path derivation: pipeline callers pass one durable `sessionRoot`, and `runPiPrompt()` creates a fresh `<sessionRoot>/<stage>/invocation-*` leaf for each invocation. Exact `sessionDir` remains a low-level override, but run-once orchestration does not construct stage-specific session paths.

**Tech Stack:** TypeScript, Node.js `node:test`, Patchmill run-once pipeline, Pi CLI `--session-dir`, JSONL progress logging.

## Global Constraints

- Do not change npm dependencies, `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`; if a dependency change becomes necessary, stop and report before proceeding.
- Durable Pi session artifact roots must live under `config.runStateDir` and the selected issue directory, not under `/tmp`, `.pi`, or `.patchmill/pi-agent`.
- Each Pi invocation that uses a durable root must get a fresh per-invocation leaf under `<sessionRoot>/<stage>/invocation-*`.
- Temporary prompt files may still be removed after each Pi invocation.
- `runPiPrompt()` must never remove a caller-provided `sessionRoot`, exact `sessionDir`, or generated durable invocation leaf.
- Direct `runPiPrompt()` callers without a configured durable session root keep the existing temporary fallback behavior.
- Run-once orchestration should pass a durable session root only; stage and invocation path policy belongs inside the Pi boundary.
- Pipeline JSON summaries should include `piSessionPath` only for selected-issue results where the issue-specific root exists.
- Apply the Testing Value Gate: this change is reusable control-flow and filesystem behavior, so write automated regression tests.

---

## File Structure

- `src/cli/commands/run-once/pi.ts`
  - Owns prompt-temp creation, Pi command invocation, durable session-root expansion, and fresh invocation leaf creation.
  - Add `RunPiPromptOptions.sessionRoot?: string` for pipeline callers.
  - Keep `RunPiPromptOptions.sessionDir?: string` as an exact low-level override.
- `src/cli/commands/run-once/pi.test.ts`
  - Add focused unit tests for fresh durable invocation leaves, stale JSONL isolation, exact override retention, and debug event emission.
- `src/cli/commands/run-once/progress.ts`
  - Add `runPiSessionPath()` next to `runLogPath()` so session artifact roots share timestamp formatting.
- `src/cli/commands/run-once/pipeline-progress.ts`
  - Carry `piSessionPath` through pipeline progress options and `withLogPath()`.
- `src/cli/commands/run-once/types.ts`
  - Add `piSessionPath?: string` to pipeline result metadata.
- `src/cli/commands/run-once/main.ts`
  - Include `piSessionPath` in `summarizeResult()` JSON output when present.
- `src/cli/commands/run-once/pipeline.ts`
  - Compute the per-run durable Pi session artifact root after issue selection.
  - Pass the root through existing stage option objects.
- `src/cli/commands/run-once/stage-advancement.ts`
  - Pass `sessionRoot: runOptions.piSessionPath` into spec and plan Pi calls.
  - Do not construct `<root>/<stage>` paths here.
- `src/cli/commands/run-once/development-environment-stage.ts`
  - Pass `sessionRoot: options.piSessionPath` into the development-environment Pi call.
  - Do not construct `<root>/<stage>` paths here.
- `src/cli/commands/run-once/pipeline-implementation.ts`
  - Pass `sessionRoot: runOptions.piSessionPath` into the implementation Pi call.
  - Do not construct `<root>/<stage>` paths here.
- `src/cli/commands/run-once/args.test.ts`
  - Assert JSON summary output includes `piSessionPath` for a selected-issue result.
- `src/cli/commands/run-once/pipeline-progress.test.ts`
  - Assert `runPiSessionPath()` shape and `withLogPath()` selected-issue metadata.
- `src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts`
  - Add a pipeline-level test that captures Pi `--session-dir` arguments and verifies fresh invocation leaves under planning and implementation stage roots.
- `src/cli/commands/run-once/pipeline-development-environment.test.ts`
  - Add or extend a test that captures the development-environment `--session-dir` argument and verifies a fresh invocation leaf under the stage root.

---

### Task 1: Add durable session-root lifecycle support to `runPiPrompt()`

**Files:**

- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

**Interfaces:**

- Consumes: existing `RunPiPromptOptions`, `piPromptArgs(promptPath, sessionDir, skillPaths)`, `ProgressReporter`, and Pi session streamers.
- Produces:
  - `RunPiPromptOptions.sessionRoot?: string` for durable run-once session artifacts.
  - `RunPiPromptOptions.sessionDir?: string` as an exact low-level override.
  - Fresh durable invocation leaves under `<sessionRoot>/<stage>/invocation-*`.

- [ ] **Step 1: Write failing unit coverage for fresh invocation leaves and stale JSONL isolation**

Update imports in `src/cli/commands/run-once/pi.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
```

Add this test near the existing session streaming tests:

```ts
test("runPiPrompt creates a fresh durable invocation leaf and ignores stale JSONL", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-session-"));
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const sessionRoot = join(
    repoRoot,
    ".patchmill",
    "runs",
    "issue-92",
    "run-2026-07-16T09-00-00-000Z-pi-sessions",
  );
  const staleLeaf = join(sessionRoot, "pi-plan", "invocation-stale");
  await mkdir(join(staleLeaf, "--repo--"), { recursive: true });
  await writeFile(
    join(staleLeaf, "--repo--", "session.jsonl"),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "stale progress" }],
      },
    }) + "\n",
    "utf8",
  );

  const streamed: string[] = [];
  let capturedPromptPath = "";
  let capturedSessionDir = "";

  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    capturedPromptPath = promptPath(args);
    const sessionDirIndex = args.indexOf("--session-dir");
    assert.ok(sessionDirIndex >= 0, `expected --session-dir in ${args.join(" ")}`);
    capturedSessionDir = args[sessionDirIndex + 1] ?? "";

    assert.equal(dirname(capturedSessionDir), join(sessionRoot, "pi-plan"));
    assert.match(basename(capturedSessionDir), /^invocation-/);
    assert.notEqual(capturedSessionDir, staleLeaf);

    await mkdir(join(capturedSessionDir, "--repo--"), { recursive: true });
    await writeFile(
      join(capturedSessionDir, "--repo--", "session.jsonl"),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "current progress" }],
        },
      }) + "\n",
      "utf8",
    );

    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    sessionRoot,
    streamOutput: (chunk) => streamed.push(chunk),
  });

  assert.deepEqual(streamed, ["current progress\n"]);
  await assert.rejects(readFile(capturedPromptPath, "utf8"), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(capturedSessionDir, "--repo--", "session.jsonl"), "utf8"),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "current progress" }],
      },
    }) + "\n",
  );
});
```

This test proves behavior rather than argument wiring: stale durable JSONL exists before the run, but only current invocation output streams.

- [ ] **Step 2: Write failing unit coverage for the exact `sessionDir` override and debug event**

Add this test after the fresh leaf test:

```ts
test("runPiPrompt preserves an exact sessionDir override and logs the actual session dir", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-session-override-"));
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const events: AgentIssueProgressEvent[] = [];
  const exactSessionDir = join(repoRoot, "exact-session-dir");
  let capturedPromptPath = "";

  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    capturedPromptPath = promptPath(args);
    const sessionDirIndex = args.indexOf("--session-dir");
    assert.ok(sessionDirIndex >= 0, `expected --session-dir in ${args.join(" ")}`);
    assert.equal(args[sessionDirIndex + 1], exactSessionDir);

    await mkdir(join(exactSessionDir, "--repo--"), { recursive: true });
    await writeFile(
      join(exactSessionDir, "--repo--", "session.jsonl"),
      JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" }) + "\n",
      "utf8",
    );

    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    progress: { event: (event) => events.push(event) },
    stage: "pi-plan",
    observeSession: true,
    sessionDir: exactSessionDir,
  });

  await assert.rejects(readFile(capturedPromptPath, "utf8"), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(exactSessionDir, "--repo--", "session.jsonl"), "utf8"),
    JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" }) + "\n",
  );
  assert.ok(
    events.some(
      (event) =>
        event.level === "debug" &&
        event.stage === "pi-plan" &&
        event.message === "pi session dir" &&
        event.data === exactSessionDir,
    ),
  );
});
```

- [ ] **Step 3: Run the focused test file to verify the new tests fail**

Run:

```bash
node --test src/cli/commands/run-once/pi.test.ts
```

Expected before implementation: failure because `sessionRoot`, exact `sessionDir`, or the debug event is missing.

- [ ] **Step 4: Add `sessionRoot` and exact `sessionDir` options**

In `src/cli/commands/run-once/pi.ts`, extend `RunPiPromptOptions`:

```ts
export type RunPiPromptOptions<Result = AgentIssuePiResult> = {
  progress?: ProgressReporter;
  stage: RunPiPromptStage;
  parseResult?: (stdout: string) => Result;
  skillPaths?: string[];
  heartbeatMs?: number;
  streamOutput?: (chunk: string) => void;
  issueNumber?: number;
  repoRoot?: string;
  taskProgress?: () =>
    | PiTaskProgress
    | undefined
    | Promise<PiTaskProgress | undefined>;
  onTaskProgress?: (progress: PiTaskProgress) => void | Promise<void>;
  tokenUsage?: () => string | undefined;
  tokenUsageState?: { total: number };
  observeSession?: boolean;
  sessionRoot?: string;
  sessionDir?: string;
  onObservation?: (observation: PiSessionObservation) => void | Promise<void>;
  verbosePiOutput?: boolean;
  taskContract?: PatchmillPiTaskContract;
  piAgentDir?: string;
  piCommand?: PiCommandSpec;
};
```

- [ ] **Step 5: Centralize durable invocation leaf creation in the Pi boundary**

In `src/cli/commands/run-once/pi.ts`, add this helper above `runPiPrompt()`:

```ts
async function createSessionDirForPi(
  options: RunPiPromptOptions,
  promptTempDir: string,
): Promise<string | undefined> {
  const shouldCreateSession = options.observeSession || options.streamOutput;
  if (!shouldCreateSession) return undefined;

  if (options.sessionDir) {
    await mkdir(options.sessionDir, { recursive: true });
    return options.sessionDir;
  }

  if (options.sessionRoot) {
    const stageRoot = join(options.sessionRoot, options.stage);
    await mkdir(stageRoot, { recursive: true });
    return await mkdtemp(join(stageRoot, "invocation-"));
  }

  const sessionDir = join(promptTempDir, "sessions");
  await mkdir(sessionDir, { recursive: true });
  return sessionDir;
}
```

Then replace the existing session-dir setup in `runPiPrompt()` with:

```ts
const streamOutput = options?.streamOutput;
const sessionDir = options
  ? await createSessionDirForPi(options, dir)
  : undefined;
if (sessionDir) {
  await options?.progress?.event({
    time: new Date().toISOString(),
    level: "debug",
    stage: options.stage,
    message: "pi session dir",
    data: sessionDir,
  });
}
```

Keep the existing final cleanup unchanged:

```ts
await rm(dir, { recursive: true, force: true });
```

That cleanup removes the prompt temp directory. It does not remove exact session dirs or durable invocation leaves because those paths are no longer nested under `dir` when caller-provided session options are used.

- [ ] **Step 6: Run the focused test file to verify Task 1 passes**

Run:

```bash
node --test src/cli/commands/run-once/pi.test.ts
```

Expected after implementation: all tests in `pi.test.ts` pass.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts
git commit -m "fix(run-once): isolate durable pi session streams"
```

---

### Task 2: Add durable Pi session artifact root metadata

**Files:**

- Modify: `src/cli/commands/run-once/progress.ts`
- Modify: `src/cli/commands/run-once/pipeline-progress.ts`
- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/main.ts`
- Modify: `src/cli/commands/run-once/pipeline-progress.test.ts`
- Modify: `src/cli/commands/run-once/args.test.ts`

**Interfaces:**

- Consumes: `runStateDir`, `timestamp`, selected `issueNumber`.
- Produces: `runPiSessionPath(runStateDir, timestamp, issueNumber): string`, and `piSessionPath?: string` on selected-issue pipeline results and JSON summaries.

- [ ] **Step 1: Write failing tests for path and selected-issue result metadata**

In `src/cli/commands/run-once/pipeline-progress.test.ts`, extend imports to include `runPiSessionPath` from `progress.ts` if needed. Add this test:

```ts
test("runPiSessionPath stores session logs beside issue run logs", () => {
  assert.equal(
    runPiSessionPath(".patchmill/runs", "2026-07-16T09:00:00.000Z", 92),
    ".patchmill/runs/issue-92/run-2026-07-16T09-00-00-000Z-pi-sessions",
  );
});
```

Replace or extend the existing `withLogPath` test with a selected-issue result shape, not `no-issue`:

```ts
test("withLogPath attaches log and Pi session paths to selected issue results", () => {
  assert.deepEqual(
    withLogPath(
      {
        status: "spec-created",
        issue: { number: 92, title: "Keep Pi session logs", labels: [] },
        specPath: "docs/specs/issue-92.md",
      },
      {
        logPath: ".patchmill/runs/issue-92/run.jsonl",
        piSessionPath: ".patchmill/runs/issue-92/run-x-pi-sessions",
      },
    ),
    {
      status: "spec-created",
      issue: { number: 92, title: "Keep Pi session logs", labels: [] },
      specPath: "docs/specs/issue-92.md",
      logPath: ".patchmill/runs/issue-92/run.jsonl",
      piSessionPath: ".patchmill/runs/issue-92/run-x-pi-sessions",
    },
  );
});
```

In `src/cli/commands/run-once/args.test.ts`, add `piSessionPath` to one existing selected-issue summary assertion, for example the merged result test:

```ts
assert.deepEqual(
  summarizeResult({
    status: "merged",
    issue: { number: 42, title: "Example", labels: [] },
    specPath: "docs/specs/example.md",
    planPath: "docs/plans/example.md",
    worktreePath: ".worktrees/patchmill-issue-42-example",
    branch: "patchmill/issue-42/example",
    mergeCommit: "abc123",
    commits: ["abc123"],
    validation: ["npm test"],
    logPath: ".patchmill/runs/issue-42/run.jsonl",
    piSessionPath: ".patchmill/runs/issue-42/run-pi-sessions",
  }),
  {
    status: "merged",
    issueNumber: 42,
    specPath: "docs/specs/example.md",
    planPath: "docs/plans/example.md",
    worktreePath: ".worktrees/patchmill-issue-42-example",
    branch: "patchmill/issue-42/example",
    mergeCommit: "abc123",
    commits: ["abc123"],
    validation: ["npm test"],
    logPath: ".patchmill/runs/issue-42/run.jsonl",
    piSessionPath: ".patchmill/runs/issue-42/run-pi-sessions",
  },
);
```

If `args.test.ts` has an existing issue helper, use that helper instead of the inline issue object.

- [ ] **Step 2: Run focused tests to verify metadata tests fail**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-progress.test.ts src/cli/commands/run-once/args.test.ts
```

Expected before implementation: failure because `runPiSessionPath` and `piSessionPath` metadata are not implemented.

- [ ] **Step 3: Implement `runPiSessionPath()`**

In `src/cli/commands/run-once/progress.ts`, add this function after `runLogPath()`:

```ts
export function runPiSessionPath(
  runStateDir: string,
  timestamp: string,
  issueNumber: number,
): string {
  return join(
    runStateDir,
    `issue-${issueNumber}`,
    `run-${safeTimestamp(timestamp)}-pi-sessions`,
  );
}
```

- [ ] **Step 4: Carry `piSessionPath` through pipeline result metadata**

In `src/cli/commands/run-once/pipeline-progress.ts`, change `PipelineProgressOptions`:

```ts
export type PipelineProgressOptions = {
  now?: Date;
  progress?: ProgressReporter;
  logPath?: string;
  piSessionPath?: string;
};
```

Replace `withLogPath()` with:

```ts
export function withLogPath<T extends AgentIssuePipelineResult>(
  result: T,
  options: PipelineProgressOptions,
): T {
  return {
    ...result,
    ...(options.logPath ? { logPath: options.logPath } : {}),
    ...(options.piSessionPath ? { piSessionPath: options.piSessionPath } : {}),
  };
}
```

In `src/cli/commands/run-once/types.ts`, change:

```ts
type AgentIssuePipelineResultLog = { logPath?: string };
```

to:

```ts
type AgentIssuePipelineResultLog = {
  logPath?: string;
  piSessionPath?: string;
};
```

- [ ] **Step 5: Include `piSessionPath` in CLI JSON summaries**

In `src/cli/commands/run-once/main.ts`, change:

```ts
type JsonResultLog = { logPath?: string };
```

to:

```ts
type JsonResultLog = { logPath?: string; piSessionPath?: string };
```

Then change the local metadata object in `summarizeResult()`:

```ts
const withLogPath = {
  ...(result.logPath ? { logPath: result.logPath } : {}),
  ...(result.piSessionPath ? { piSessionPath: result.piSessionPath } : {}),
};
```

Leave the existing `...withLogPath` spread sites unchanged.

- [ ] **Step 6: Run focused metadata tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-progress.test.ts src/cli/commands/run-once/args.test.ts
```

Expected after implementation: both focused test files pass.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add \
  src/cli/commands/run-once/progress.ts \
  src/cli/commands/run-once/pipeline-progress.ts \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/main.ts \
  src/cli/commands/run-once/pipeline-progress.test.ts \
  src/cli/commands/run-once/args.test.ts
git commit -m "feat(run-once): report pi session artifact roots"
```

---

### Task 3: Wire durable session roots through run-once Pi stages

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Modify: `src/cli/commands/run-once/development-environment-stage.ts`
- Modify: `src/cli/commands/run-once/pipeline-implementation.ts`
- Modify: `src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-development-environment.test.ts`

**Interfaces:**

- Consumes: `runPiSessionPath()` from Task 2 and `RunPiPromptOptions.sessionRoot` from Task 1.
- Produces: selected-issue pipeline options with `piSessionPath`; all run-once Pi calls pass the durable root as `sessionRoot` and let `runPiPrompt()` derive fresh per-stage invocation leaves.

- [ ] **Step 1: Write a helper assertion for fresh invocation leaves in test files**

In each touched pipeline test file, add this helper near existing local helpers if no shared helper already exists:

```ts
function assertInvocationLeaf(
  actual: string,
  expectedStageRoot: string,
): void {
  assert.equal(dirname(actual), expectedStageRoot);
  assert.match(basename(actual), /^invocation-/);
}
```

Add `basename` and `dirname` to the `node:path` import in that file if needed.

- [ ] **Step 2: Write failing pipeline coverage for planning and implementation session roots**

In `src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts`, add or extend a scenario that creates a missing plan and then runs implementation. Capture workflow Pi calls after the run:

```ts
const piSessionDirs = workflowPiCalls(runner.calls).map((call) => {
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.ok(sessionDirIndex >= 0, `expected --session-dir in ${call.args.join(" ")}`);
  return call.args[sessionDirIndex + 1] ?? "";
});

const expectedRoot = join(
  config.runStateDir,
  "issue-45",
  "run-2026-05-09T12-00-00-000Z-pi-sessions",
);
assert.equal(result.piSessionPath, expectedRoot);
assert.ok(
  piSessionDirs.some((dir) => {
    assertInvocationLeaf(dir, join(expectedRoot, "pi-plan"));
    return true;
  }),
);
assert.ok(
  piSessionDirs.some((dir) => dirname(dir) === join(expectedRoot, "pi-implementation")),
);
```

If the existing scenario has a different issue number, replace `issue-45` with that scenario's issue number. The important contract is that captured Pi session dirs are fresh leaves under the expected stage roots, not the stage roots themselves.

- [ ] **Step 3: Write failing development-environment session-root coverage**

In `src/cli/commands/run-once/pipeline-development-environment.test.ts`, extend the existing development-environment scenario. After the run, inspect `workflowPiCalls(runner.calls)` and assert:

```ts
const piSessionDirs = workflowPiCalls(runner.calls).map((call) => {
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.ok(sessionDirIndex >= 0, `expected --session-dir in ${call.args.join(" ")}`);
  return call.args[sessionDirIndex + 1] ?? "";
});

const expectedRoot = join(
  config.runStateDir,
  "issue-45",
  "run-2026-05-09T12-00-00-000Z-pi-sessions",
);
assert.equal(result.piSessionPath, expectedRoot);
assert.ok(
  piSessionDirs.some((dir) => dirname(dir) === join(expectedRoot, "pi-development-environment")),
);
assert.ok(
  piSessionDirs.some((dir) => dirname(dir) === join(expectedRoot, "pi-implementation")),
);
```

Use that test file's existing issue number and `NOW` constant when constructing the expected root.

- [ ] **Step 4: Run the focused pipeline tests to verify they fail**

Run:

```bash
node --test \
  src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts
```

Expected before implementation: failure because `result.piSessionPath` is absent or Pi calls still use temp session dirs.

- [ ] **Step 5: Compute `piSessionPath` in `runOneIssue()`**

In `src/cli/commands/run-once/pipeline.ts`, import `runPiSessionPath` from `progress.ts`:

```ts
import { runPiSessionPath } from "./progress.ts";
```

After `const timestamp = (options.now ?? new Date()).toISOString();`, add:

```ts
const piSessionPath = runPiSessionPath(
  config.runStateDir,
  timestamp,
  issue.number,
);
const runOptions = { ...options, piSessionPath };
```

Then use `runOptions` for selected-issue progress, stage calls, and result metadata after this point. Keep selection diagnostics before issue selection on `options`, because `piSessionPath` does not exist until an issue is selected.

Examples:

```ts
await progress(runOptions, "info", "git", "checking issue branch base containment", {
  issueNumber: issue.number,
});
```

```ts
return withLogPath(planningStages.result, runOptions);
```

- [ ] **Step 6: Pass `sessionRoot`, not stage-specific paths, to all run-once Pi calls**

In `src/cli/commands/run-once/stage-advancement.ts`, add this property inside both spec and plan creation `runPiPrompt()` options objects:

```ts
sessionRoot: runOptions.piSessionPath,
```

In `src/cli/commands/run-once/development-environment-stage.ts`, add this property inside the development-environment `runPiPrompt()` options object:

```ts
sessionRoot: options.piSessionPath,
```

In `src/cli/commands/run-once/pipeline-implementation.ts`, add this property inside the implementation `runPiPrompt()` options object:

```ts
sessionRoot: runOptions.piSessionPath,
```

Do not construct stage-specific child paths in orchestration files. Those
stage paths are derived by `runPiPrompt()` from `sessionRoot` and `stage`.

- [ ] **Step 7: Run focused pipeline tests**

Run:

```bash
node --test \
  src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts
```

Expected after implementation: tests pass and captured Pi calls use fresh durable invocation leaves under the expected stage roots.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/development-environment-stage.ts \
  src/cli/commands/run-once/pipeline-implementation.ts \
  src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-development-environment.test.ts
git commit -m "fix(run-once): store pi sessions as invocation artifacts"
```

---

### Task 4: Full verification and final readiness

**Files:**

- Modify only if a previous task revealed a focused test or lint fix in touched files.

**Interfaces:**

- Consumes: all code and tests from Tasks 1-3.
- Produces: verified branch ready for review or pull request creation.

- [ ] **Step 1: Inspect the final diff for accidental dependency or generated-file changes**

Run:

```bash
git status --short
git diff --stat
git diff -- package.json package-lock.json npm-shrinkwrap.json
```

Expected: no changes to npm dependency files. If dependency files changed, stop and report; the project requires Nix build verification for dependency changes.

- [ ] **Step 2: Run the full run-once test suite**

Run:

```bash
npm run test:run-once
```

Expected: all run-once tests pass.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: format, TypeScript lint, and markdown lint pass.

- [ ] **Step 5: Reproduce the issue-92 stale-session regression with a focused command**

Run the specific test that exercises fresh invocation leaves and stale durable JSONL isolation:

```bash
node --test src/cli/commands/run-once/pi.test.ts --test-name-pattern "fresh durable invocation leaf"
```

Expected: test passes, proving stale JSONL under the durable root does not stream and prompt temp cleanup does not remove the current session JSONL.

- [ ] **Step 6: Inspect final diff for scope**

Run:

```bash
git diff --check
git diff --name-only HEAD~3..HEAD
```

Expected: no whitespace errors; changed files are limited to run-once code and tests.

- [ ] **Step 7: Commit any final verification-only adjustments**

If verification required code or test fixes, commit them:

```bash
git add <fixed-files>
git commit -m "test(run-once): cover durable pi session artifacts"
```

Skip this step if there are no uncommitted verification fixes.

- [ ] **Step 8: Prepare the handoff summary**

Report:

```text
Implemented issue #92 durable Pi session logs.

Commits:
- <sha> fix(run-once): isolate durable pi session streams
- <sha> feat(run-once): report pi session artifact roots
- <sha> fix(run-once): store pi sessions as invocation artifacts

Verification:
- npm run test:run-once
- npm test
- npm run lint
- node --test src/cli/commands/run-once/pi.test.ts --test-name-pattern "fresh durable invocation leaf"

Notes:
- No npm dependency files changed.
- Pi session artifact root is .patchmill/runs/issue-<n>/run-<timestamp>-pi-sessions/.
- Each Pi invocation uses a fresh <root>/<stage>/invocation-* leaf.
```
