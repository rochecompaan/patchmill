# Deterministic Abortable Run-Once Pi Session Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `run-once` observe exactly one owned parent Pi session with serial callback backpressure, prompt cancellation on observation failure, and complete terminal error reporting.

**Architecture:** Observed `runPiPrompt()` calls allocate a unique pre-created parent JSONL file in the durable invocation leaf, pass that file to Pi with `--session`, and start an exact-file observer that never scans for the newest recursive JSONL. The command runner accepts an `AbortSignal`, and `runPiPrompt()` coordinates the runner, streamer, heartbeat, parsing, and cleanup through ordered cause collection so independent failures are preserved.

**Tech Stack:** Node.js 22.19+, TypeScript ESM, `node:test`, Node `child_process.spawn`, Node `fs/promises`, existing Patchmill progress reporters and Pi JSONL session parsing.

## Global Constraints

- Scope is limited to exact-session ownership, streaming backpressure, cancellation, and terminal-error preservation for issue #123.
- Do not change `pi-subagents` or parse/render subagent-specific metadata.
- Do not migrate triage to exact-session observation; triage keeps the legacy directory-based observer and receives regression coverage only.
- Successful `run-once` stdout remains the final JSON object only; progress, verbose Pi output, and error detail stay on stderr and in the JSONL run log.
- Tests for new production behavior must use deterministic synchronization primitives, not timing races.
- Apply Patchmill's Testing Value Gate: automated tests are required here because this changes reusable streaming, cancellation, API contracts, error handling, and regressions.
- Do not change `package.json`, `npm-shrinkwrap.json`, or `package-lock.json`; if an implementation accidentally changes npm dependency files, revert them or run the Nix build required by `AGENTS.md`.

---

## File Structure

- `src/cli/commands/triage/types.ts` owns the shared command-runner type. Add only `signal?: AbortSignal` to `CommandRunOptions` so all current callers remain compatible.
- `src/cli/commands/triage/command.ts` owns the real spawned-process adapter. Add abort handling here without changing its `CommandResult` return contract.
- `src/cli/commands/run-once/pi-session-allocation.ts` is a new focused module for durable invocation directory creation and exact parent session file pre-creation. This keeps filesystem allocation separate from `pi.ts`, which is already a broad Pi orchestration module.
- `src/cli/commands/run-once/pi-errors.ts` is a new focused module for converting independent terminal causes into a single thrown error and formatting aggregate causes for CLI/log output.
- `src/cli/commands/run-once/pi-session-stream.ts` keeps session JSONL parsing and streaming. Add exact-file observation beside the legacy directory observer; do not remove `findNewestSessionFile()` because triage still depends on it.
- `src/cli/commands/run-once/pi.ts` remains the `runPiPrompt()` orchestration facade. Replace observed-session directory discovery with exact session allocation, wire the abort controller, and delegate aggregation to `pi-errors.ts`.
- `src/cli/commands/run-once/main.ts` owns run-once CLI terminal JSON/log formatting. Teach its error path to include aggregate causes without changing success-result JSON.
- Tests stay near owners: `src/cli/commands/triage/command.test.ts`, `src/cli/commands/triage/tool-call-observer.test.ts`, and `src/cli/commands/run-once/pi.test.ts`.

---

### Task 1: Add AbortSignal Support to the Reusable Command Runner

**Files:**

- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/command.ts`
- Modify: `src/cli/commands/triage/command.test.ts`
- Modify: `test-support/command-runner.ts`

**Interfaces:**

- Consumes: existing `CommandRunner.run(command, args, options)` contract.
- Produces: `CommandRunOptions.signal?: AbortSignal`; real runner terminates an in-flight child on abort, keeps collecting stdout/stderr until `close`, and returns a nonzero `CommandResult` without spawning when the signal is already aborted.

- [ ] **Step 1: Write the failing command-runner abort tests**

  Add these tests to `src/cli/commands/triage/command.test.ts`:

  ```ts
  test("command runner aborts an in-flight process and waits for close", async () => {
    const runner = createCommandRunner();
    const controller = new AbortController();
    const resultPromise = runner.run(
      process.execPath,
      [
        "-e",
        [
          "process.stdout.write('started\\n');",
          "process.stderr.write('stderr-before-abort\\n');",
          "process.on('SIGTERM', () => {",
          "  process.stdout.write('closed-after-abort\\n');",
          "  process.exit(0);",
          "});",
          "setInterval(() => {}, 1000);",
        ].join(""),
      ],
      { signal: controller.signal },
    );

    controller.abort();
    const result = await resultPromise;

    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /started|closed-after-abort/);
    assert.match(result.stderr, /stderr-before-abort|aborted/i);
  });

  test("command runner does not spawn when signal is already aborted", async () => {
    const runner = createCommandRunner();
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run(
      process.execPath,
      ["-e", "process.stdout.write('should-not-run')"],
      { signal: controller.signal },
    );

    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /aborted/i);
  });
  ```

- [ ] **Step 2: Run the failing command-runner tests**

  Run:

  ```sh
  node --test src/cli/commands/triage/command.test.ts
  ```

  Expected: TypeScript or runtime failure because `CommandRunOptions` has no `signal` property and `createCommandRunner()` ignores aborts.

- [ ] **Step 3: Extend the shared command-runner type and test support**

  In `src/cli/commands/triage/types.ts`, change `CommandRunOptions` to:

  ```ts
  export type CommandRunOptions = {
    cwd?: string;
    env?: Record<string, string | undefined>;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    signal?: AbortSignal;
  };
  ```

  In `test-support/command-runner.ts`, keep static-runner compatibility and record no new state unless a future test needs it:

  ```ts
  async run(command, args, options = {}) {
    calls.push(normalizeRecordedPiCall(command, args, options.cwd));
    const result = results[index];
    index += 1;
    return result ?? { code: 0, stdout: "", stderr: "" };
  }
  ```

- [ ] **Step 4: Implement minimal abort handling in `createCommandRunner()`**

  Update `src/cli/commands/triage/command.ts` so it checks `options.signal?.aborted` before `spawn`, attaches one abort listener after spawn, calls `child.kill("SIGTERM")`, and settles only from `close` or `error`:

  ```ts
  if (options.signal?.aborted) {
    return Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "command aborted before spawn",
    });
  }
  ```

  Ensure the abort path appends an abort marker to `stderr` without discarding existing stderr:

  ```ts
  const onAbort = () => {
    stderr += stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n";
    stderr += "command aborted\n";
    child.kill("SIGTERM");
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  child.on("close", (code, signal) => {
    options.signal?.removeEventListener("abort", onAbort);
    const aborted = options.signal?.aborted === true;
    settle({
      code: aborted ? 1 : (code ?? 1),
      stdout,
      stderr:
        signal && !stderr.includes(signal) ? `${stderr}${signal}\n` : stderr,
    });
  });
  ```

- [ ] **Step 5: Verify command-runner behavior**

  Run:

  ```sh
  node --test src/cli/commands/triage/command.test.ts
  ```

  Expected: PASS, including existing stdout/stderr/cwd tests and the two abort tests.

- [ ] **Step 6: Commit this task**

  ```sh
  git add src/cli/commands/triage/types.ts src/cli/commands/triage/command.ts src/cli/commands/triage/command.test.ts test-support/command-runner.ts
  git commit -m "feat: make command runner abortable"
  ```

---

### Task 2: Allocate and Pass Exact Parent Pi Session Files for Observed Run-Once Calls

**Files:**

- Create: `src/cli/commands/run-once/pi-session-allocation.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

**Interfaces:**

- Consumes: `RunPiPromptOptions.stage`, `observeSession`, `streamOutput`, `sessionRoot`, `sessionDir`, and the prompt temp dir.
- Produces: `PiSessionAllocation { sessionDir: string; sessionPath?: string }`; observed calls receive a pre-created `sessionPath` passed via `--session <path>`, while non-observed message streaming keeps `--session-dir <dir>`.

- [ ] **Step 1: Write failing exact-session allocation tests**

  In `src/cli/commands/run-once/pi.test.ts`, add tests that assert observed calls pass `--session` and not `--session-dir`:

  ```ts
  test("runPiPrompt pre-creates and passes an exact observed parent session", async (t) => {
    const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-exact-session-"));
    t.after(async () => {
      await rm(repoRoot, { recursive: true, force: true });
    });
    const sessionRoot = join(repoRoot, ".patchmill", "runs", "issue-123", "run-pi-sessions");
    const events: AgentIssueProgressEvent[] = [];
    let observedSessionPath = "";

    const runner = createMockRunner(async (call) => {
      const args = assertBundledPiCall(call);
      const sessionIndex = args.indexOf("--session");
      assert.ok(sessionIndex >= 0, `expected --session in ${args.join(" ")}`);
      assert.equal(args.includes("--session-dir"), false);
      observedSessionPath = args[sessionIndex + 1] ?? "";
      const invocationDir = dirname(observedSessionPath);
      assert.equal(dirname(invocationDir), join(sessionRoot, "pi-plan"));
      assert.match(basename(invocationDir), /^invocation-/);
      assert.match(basename(observedSessionPath), /^parent-[0-9a-f-]+\.jsonl$/);
      assert.equal(await readFile(observedSessionPath, "utf8"), "");
      await writeFile(
        observedSessionPath,
        JSON.stringify({ type: "session", id: "parent", cwd: "/repo" }) + "\n",
        "utf8",
      );
      return { code: 0, stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}', stderr: "" };
    });

    await runPiPrompt(runner, "/repo", "prompt", {
      progress: { event: (event) => events.push(event) },
      stage: "pi-plan",
      observeSession: true,
      sessionRoot,
    });

    assert.ok(observedSessionPath.endsWith(".jsonl"));
    assert.ok(events.some((event) => event.message === "pi session path" && event.data === observedSessionPath));
  });
  ```

  Also replace the current observed `sessionDir` override assertion so it expects `--session <exactSessionDir>/parent-*.jsonl` and a `pi session path` debug event. Keep the existing non-observed `streamOutput` tests expecting `--session-dir`.

- [ ] **Step 2: Run the exact-session allocation tests and confirm failure**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts
  ```

  Expected: FAIL because observed `runPiPrompt()` still passes `--session-dir` and does not pre-create a parent file.

- [ ] **Step 3: Add the allocation module**

  Create `src/cli/commands/run-once/pi-session-allocation.ts` with this public surface:

  ```ts
  import { mkdir, mkdtemp, open } from "node:fs/promises";
  import { randomUUID } from "node:crypto";
  import { join } from "node:path";

  export type PiSessionAllocation = {
    sessionDir: string;
    sessionPath?: string;
  };

  export type PiSessionAllocationOptions = {
    stage: string;
    promptTempDir: string;
    observeSession?: boolean;
    streamOutput?: boolean;
    sessionRoot?: string;
    sessionDir?: string;
    idFactory?: () => string;
  };

  export async function createPiSessionAllocation(
    options: PiSessionAllocationOptions,
  ): Promise<PiSessionAllocation | undefined> {
    const shouldCreateSession = options.observeSession || options.streamOutput;
    if (!shouldCreateSession) return undefined;

    const sessionDir = await createInvocationDir(options);
    if (!options.observeSession) return { sessionDir };

    const sessionPath = await createExactParentSessionFile(
      sessionDir,
      options.idFactory ?? randomUUID,
    );
    return { sessionDir, sessionPath };
  }
  ```

  Implement private `createInvocationDir()` with the current `sessionRoot/<stage>/invocation-*`, explicit `sessionDir`, and prompt temp `sessions` behavior. Implement private `createExactParentSessionFile()` with `await open(path, "wx")`, `await handle.close()`, and a bounded retry loop such as 10 attempts using names `parent-${idFactory()}.jsonl`.

- [ ] **Step 4: Switch Pi argument construction to support exact session paths**

  In `src/cli/commands/run-once/pi.ts`, replace `createSessionDirForPi()` with the new allocation module and change `piPromptArgs()` to accept an allocation:

  ```ts
  function piPromptArgs(
    promptPath: string,
    session: PiSessionAllocation | undefined,
    skillPaths: string[] = [],
    extensionArgs: string[] = [],
  ): string[] {
    const skillArgs = skillPaths.flatMap((path) => ["--skill", path]);
    const baseArgs = [...extensionArgs, ...skillArgs, "-p"];
    if (session?.sessionPath) return [...baseArgs, "--session", session.sessionPath, `@${promptPath}`];
    if (session?.sessionDir) return [...baseArgs, "--session-dir", session.sessionDir, `@${promptPath}`];
    return [...baseArgs, `@${promptPath}`];
  }
  ```

- [ ] **Step 5: Log exact session metadata**

  In `runPiPrompt()`, emit both the invocation directory and exact path when present:

  ```ts
  if (sessionAllocation?.sessionDir) {
    await options?.progress?.event({
      time: new Date().toISOString(),
      level: "debug",
      stage: options.stage,
      message: "pi session dir",
      data: sessionAllocation.sessionDir,
    });
  }
  if (sessionAllocation?.sessionPath) {
    await options?.progress?.event({
      time: new Date().toISOString(),
      level: "debug",
      stage: options.stage,
      message: "pi session path",
      data: sessionAllocation.sessionPath,
    });
  }
  ```

- [ ] **Step 6: Verify allocation behavior**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts
  ```

  Expected: PASS for exact observed `--session`, pre-created zero-byte parent files, debug metadata, and unchanged non-observed `--session-dir` message streaming.

- [ ] **Step 7: Commit this task**

  ```sh
  git add src/cli/commands/run-once/pi-session-allocation.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts
  git commit -m "feat: allocate exact run-once pi sessions"
  ```

---

### Task 3: Add Exact-File Observation with Serial Backpressure and Hard Failures

**Files:**

- Modify: `src/cli/commands/run-once/pi-session-stream.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

**Interfaces:**

- Consumes: exact `sessionPath`, existing `sessionEntryToObservations()`, and optional verbose output callback.
- Produces: `createExactPiSessionObservationStreamer(sessionPath, onObservation, options)` whose callback can return `void | Promise<void>`, whose polls are serialized, and whose `stop()` rejects with parse, stat, read, or callback failures. The legacy `createPiSessionObservationStreamer(sessionDir, ...)` remains directory-based for triage.

- [ ] **Step 1: Write failing deterministic streaming tests**

  Add tests to `src/cli/commands/run-once/pi.test.ts` using explicit promises instead of timers:

  ```ts
  test("exact session observation awaits callbacks in file order", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "patchmill-exact-stream-"));
    t.after(async () => {
      await rm(dir, { recursive: true, force: true });
    });
    const sessionPath = join(dir, "parent.jsonl");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "first" }] } }),
        JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }] } }),
      ].join("\n") + "\n",
      "utf8",
    );

    const delivered: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstWasDelivered = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const streamer = createExactPiSessionObservationStreamer(
      sessionPath,
      async (observation) => {
        if (observation.type !== "text") return;
        delivered.push(observation.text);
        if (observation.text === "first") {
          firstStarted();
          await firstCanFinish;
        }
      },
      { pollMs: 60_000 },
    );

    streamer.start();
    await firstWasDelivered;
    assert.deepEqual(delivered, ["first"]);
    releaseFirst();
    await streamer.stop();
    assert.deepEqual(delivered, ["first", "second"]);
  });
  ```

  Add companion tests that `stop()` rejects on malformed non-empty JSON and on injected `stat`/`readRange` failures with the original error message.

- [ ] **Step 2: Run the streaming tests and confirm failure**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts
  ```

  Expected: FAIL because there is no exact streamer, malformed JSON is skipped, and observation callbacks are not awaited inline.

- [ ] **Step 3: Export exact-streamer types and parse failure behavior**

  In `src/cli/commands/run-once/pi-session-stream.ts`, add a strict parser used only by exact observation:

  ```ts
  function parseStrictSessionLine(line: string): JsonObject | undefined {
    const trimmed = line.trim();
    if (!trimmed) return undefined;
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isObject(parsed)) throw new Error("Pi session line must be a JSON object");
    return parsed;
  }
  ```

  Keep `parseSessionLine()` lenient for message streaming and legacy triage behavior.

- [ ] **Step 4: Implement `createExactPiSessionObservationStreamer()`**

  Add an exact streamer that stores only `sessionPath`, never calls `findNewestSessionFile()`, awaits `onObservation()` inline, and records the first asynchronous failure so `stop()` rejects:

  ```ts
  export function createExactPiSessionObservationStreamer(
    sessionPath: string,
    onObservation: (observation: PiSessionObservation) => void | Promise<void>,
    options: ExactPiSessionObservationStreamerOptions = {},
  ): { start(): void; stop(): Promise<void>; failure: Promise<never> } {
    // exact implementation reads only sessionPath, serializes runPoll(),
    // and rejects failure when stat, read, JSON.parse, or onObservation fails.
  }
  ```

  Use options with deterministic test seams:

  ```ts
  type ExactPiSessionObservationStreamerOptions = {
    pollMs?: number;
    verboseOutput?: (chunk: string) => void;
    statFile?: typeof stat;
    readRange?: typeof readRange;
  };
  ```

- [ ] **Step 5: Keep legacy triage behavior unchanged**

  Leave `createPiSessionObservationStreamer(sessionDir, ...)` as the directory-discovery observer. If its callback type changes, make it accept `void | Promise<void>` but do not make it strict and do not remove `findNewestSessionFile()`.

- [ ] **Step 6: Verify exact and legacy streaming tests**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts
  node --test src/cli/commands/triage/*.test.ts
  ```

  Expected: PASS. Exact streaming rejects meaningful failures and preserves callback order; triage tests remain compatible with directory discovery.

- [ ] **Step 7: Commit this task**

  ```sh
  git add src/cli/commands/run-once/pi-session-stream.ts src/cli/commands/run-once/pi.test.ts src/cli/commands/triage
  git commit -m "feat: stream exact pi sessions serially"
  ```

---

### Task 4: Abort Pi Prompt Runs on Observation Failure and Preserve All Terminal Causes

**Files:**

- Create: `src/cli/commands/run-once/pi-errors.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

**Interfaces:**

- Consumes: `CommandRunner` with `signal`, `createExactPiSessionObservationStreamer()`, `ProgressReporter`, and prompt temp cleanup.
- Produces: observed `runPiPrompt()` starts the exact streamer before Pi, aborts the command when observation fails, awaits runner close and streamer cleanup, then throws either the single original error or an `AggregateError` preserving observation, runner, parse, heartbeat/progress, and cleanup causes.

- [ ] **Step 1: Write failing cancellation and aggregation tests**

  Add deterministic mock-runner tests to `src/cli/commands/run-once/pi.test.ts`:

  ```ts
  test("runPiPrompt aborts the runner when exact observation fails", async (t) => {
    const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-observe-abort-"));
    t.after(async () => {
      await rm(repoRoot, { recursive: true, force: true });
    });
    let abortObserved = false;
    let allowClose!: () => void;
    const closeAllowed = new Promise<void>((resolve) => {
      allowClose = resolve;
    });

    const runner = createMockRunner(async (call) => {
      const args = assertBundledPiCall(call);
      const sessionPath = args[args.indexOf("--session") + 1] ?? "";
      await writeFile(sessionPath, "{bad json\n", "utf8");
      call.signal?.addEventListener("abort", () => {
        abortObserved = true;
        allowClose();
      });
      await closeAllowed;
      return { code: 1, stdout: "partial stdout", stderr: "runner closed after abort" };
    });

    await assert.rejects(
      () => runPiPrompt(runner, "/repo", "prompt", { stage: "pi-plan", observeSession: true, sessionRoot: repoRoot }),
      (error) => error instanceof AggregateError && error.errors.length >= 2,
    );
    assert.equal(abortObserved, true);
  });
  ```

  Extend the local test `Call` type and `createMockRunner()` in `pi.test.ts` to carry `signal?: AbortSignal` so mocks can assert abort behavior.

- [ ] **Step 2: Add terminal aggregation tests for runner plus cleanup**

  Add a test that injects three independent failures: callback rejection, runner nonzero result, and prompt temp cleanup rejection. Use a test-only `cleanupPromptTempDir` option on `RunPiPromptOptions` so cleanup failure is deterministic:

  ```ts
  await assert.rejects(
    () => runPiPrompt(runner, "/repo", "prompt", {
      stage: "pi-plan",
      observeSession: true,
      onObservation: () => Promise.reject(new Error("callback exploded")),
      cleanupPromptTempDir: async () => {
        throw new Error("cleanup exploded");
      },
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.match(String(error), /pi prompt failed/);
      assert.deepEqual(
        (error as AggregateError).errors.map((cause) => (cause as Error).message),
        ["callback exploded", "pi failed: runner failed", "cleanup exploded"],
      );
      return true;
    },
  );
  ```

- [ ] **Step 3: Run the new run-once tests and confirm failure**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts
  ```

  Expected: FAIL because `runPiPrompt()` does not pass a signal, does not abort on observation failure, and masks failures through nested `finally` blocks.

- [ ] **Step 4: Add `pi-errors.ts`**

  Create `src/cli/commands/run-once/pi-errors.ts` with narrow helpers:

  ```ts
  export type PiErrorCause = {
    label: string;
    error: unknown;
  };

  export function errorFromUnknown(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  export function aggregatePiErrors(message: string, causes: PiErrorCause[]): Error | undefined {
    const normalized = causes.map((cause) => {
      const error = errorFromUnknown(cause.error);
      return new Error(`${cause.label}: ${error.message}`, { cause: error });
    });
    if (normalized.length === 0) return undefined;
    if (normalized.length === 1) return normalized[0].cause instanceof Error ? normalized[0].cause : normalized[0];
    return new AggregateError(normalized, message);
  }

  export function formatErrorWithCauses(error: unknown): { message: string; causes?: string[] } {
    const normalized = errorFromUnknown(error);
    if (normalized instanceof AggregateError) {
      return {
        message: normalized.message,
        causes: normalized.errors.map((cause) => errorFromUnknown(cause).message),
      };
    }
    return { message: normalized.message };
  }
  ```

  The single-cause path must return the original `Error` object so existing `assert.rejects()` checks that match the original message continue to work without wrapping.

- [ ] **Step 5: Rework `runPiPrompt()` orchestration around one `AbortController`**

  In `src/cli/commands/run-once/pi.ts`, create an `AbortController` for observed exact sessions, pass `signal: controller.signal` to `runner.run()`, and attach `sessionStreamer.failure.catch(...)` before awaiting the runner:

  ```ts
  const controller = new AbortController();
  const terminalCauses: PiErrorCause[] = [];
  const observationFailure = sessionStreamer?.failure.catch((error) => {
    terminalCauses.push({ label: "observation", error });
    controller.abort(error);
  });
  const runnerPromise = runner.run(command, args, { cwd, env, signal: controller.signal });
  const result = await runnerPromise.catch((error) => {
    terminalCauses.push({ label: "runner", error });
    return undefined;
  });
  await observationFailure;
  ```

  Preserve existing behavior for non-observed message streaming: it may pass no signal unless the refactor makes a signal harmless there.

- [ ] **Step 6: Record all shutdown, parse, heartbeat, progress, and cleanup errors**

  Replace nested `finally` masking with ordered cause collection:

  ```ts
  try {
    await sessionStreamer?.stop();
  } catch (error) {
    terminalCauses.push({ label: "streamer shutdown", error });
  }
  try {
    await emitPiOutput(result, options);
  } catch (error) {
    terminalCauses.push({ label: "progress", error });
  }
  if (result && result.code !== 0) {
    terminalCauses.push({ label: "runner", error: new Error(`pi failed: ${result.stderr || result.stdout}`) });
  }
  if (result && terminalCauses.length === 0) {
    try {
      return parseResult(result.stdout) as Result;
    } catch (error) {
      terminalCauses.push({ label: "result parsing", error });
    }
  }
  const combined = aggregatePiErrors("pi prompt failed", terminalCauses);
  if (combined) throw combined;
  ```

  In the outer cleanup path, catch `await (options?.cleanupPromptTempDir ?? defaultRm)(dir)` errors and aggregate them with any earlier error instead of replacing the earlier failure.

- [ ] **Step 7: Verify cancellation, aggregation, and existing run-once behavior**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts
  npm run test:run-once
  ```

  Expected: PASS. Observation failures abort the mock runner before normal completion, all independent causes appear in thrown aggregate errors, and successful result parsing remains unchanged.

- [ ] **Step 8: Commit this task**

  ```sh
  git add src/cli/commands/run-once/pi-errors.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts
  git commit -m "feat: abort pi runs on observation failure"
  ```

---

### Task 5: Format Aggregate Errors in Run-Once CLI Output and Preserve Triage Regression Behavior

**Files:**

- Modify: `src/cli/commands/run-once/main.ts`
- Modify: `src/cli/commands/run-once/pipeline-failures.test.ts` or `src/cli/commands/run-once/main.test.ts`
- Create: `src/cli/commands/triage/tool-call-observer.test.ts`
- Modify: `src/cli/commands/triage/tool-call-observer.ts` only if type compatibility requires it

**Interfaces:**

- Consumes: `formatErrorWithCauses(error)` from `pi-errors.ts` and legacy `runWithToolCallObservation(onToolCall, run)`.
- Produces: CLI error JSON may include `causes: string[]` for error results, JSONL error events include cause data, terminal success JSON remains unchanged, and triage still observes tool calls from a session directory.

- [ ] **Step 1: Write failing CLI aggregate-format test**

  In the most focused existing run-once CLI error test file, add coverage that an `AggregateError` is logged and printed with all causes:

  ```ts
  test("run-once CLI includes aggregate causes in error output", async () => {
    const error = new AggregateError(
      [new Error("observation: malformed json"), new Error("runner: pi failed")],
      "pi prompt failed",
    );
    const formatted = formatErrorWithCauses(error);

    assert.deepEqual(formatted, {
      message: "pi prompt failed",
      causes: ["observation: malformed json", "runner: pi failed"],
    });
  });
  ```

  If the repository already has a stronger `main()` stdout capture test, assert the final JSON shape instead:

  ```json
  {"status":"error","error":"pi prompt failed","causes":["observation: malformed json","runner: pi failed"],"logPath":"..."}
  ```

- [ ] **Step 2: Write triage legacy observer regression coverage**

  Create `src/cli/commands/triage/tool-call-observer.test.ts`:

  ```ts
  test("runWithToolCallObservation supplies a session directory and observes legacy tool calls", async () => {
    const observed: Array<{ toolName?: string; toolCallId?: string }> = [];
    let suppliedSessionDir = "";

    const result = await runWithToolCallObservation(
      (event) => observed.push({ toolName: event.toolName, toolCallId: event.toolCallId }),
      async (sessionDir) => {
        assert.ok(sessionDir);
        suppliedSessionDir = sessionDir;
        await mkdir(join(sessionDir, "child"), { recursive: true });
        await writeFile(
          join(sessionDir, "child", "session.jsonl"),
          JSON.stringify({
            type: "message",
            message: { role: "toolResult", toolName: "bash", toolCallId: "call-1" },
          }) + "\n",
          "utf8",
        );
        return "ok";
      },
    );

    assert.equal(result, "ok");
    assert.deepEqual(observed, [{ toolName: "bash", toolCallId: "call-1" }]);
    await assert.rejects(stat(suppliedSessionDir), { code: "ENOENT" });
  });
  ```

- [ ] **Step 3: Run the new formatting and triage tests and confirm failure**

  Run:

  ```sh
  node --test src/cli/commands/run-once/main.test.ts src/cli/commands/triage/tool-call-observer.test.ts
  ```

  Expected: CLI formatting test fails until `main.ts` uses aggregate formatting. The triage regression should pass unless an earlier task changed legacy observation behavior; if it fails, restore directory-based behavior.

- [ ] **Step 4: Use aggregate formatting in `main.ts`**

  Import `formatErrorWithCauses()` and replace both current `const message = ...` error blocks with:

  ```ts
  const formatted = formatErrorWithCauses(error);
  await progress.event({
    time: new Date().toISOString(),
    level: "error",
    stage: "error",
    message: `blocked: ${formatted.message}`,
    data: { error: formatted.message, causes: formatted.causes },
  });
  console.log(JSON.stringify({
    status: "error",
    error: formatted.message,
    ...(formatted.causes ? { causes: formatted.causes } : {}),
    logPath,
  }));
  ```

  In the outer `catch`, use the same formatter but omit `logPath` because it may not exist yet.

- [ ] **Step 5: Keep successful stdout contracts unchanged**

  Run or add an assertion using `summarizeResult()` that successful `plan-created`, `pr-created`, `merged`, `blocked`, and approval JSON do not gain a `causes` property. Do not add new tests that only restate static JSON shape if existing tests already cover these success variants; the Testing Value Gate permits direct verification through the focused formatting test plus existing run-once tests.

- [ ] **Step 6: Verify CLI and triage behavior**

  Run:

  ```sh
  node --test src/cli/commands/run-once/main.test.ts src/cli/commands/triage/tool-call-observer.test.ts
  node --test src/cli/commands/triage/*.test.ts
  ```

  Expected: PASS. Error JSON and JSONL logs preserve cause arrays, and triage still supplies a session directory rather than `--session` metadata.

- [ ] **Step 7: Commit this task**

  ```sh
  git add src/cli/commands/run-once/main.ts src/cli/commands/run-once/main.test.ts src/cli/commands/run-once/pipeline-failures.test.ts src/cli/commands/triage/tool-call-observer.ts src/cli/commands/triage/tool-call-observer.test.ts
  git commit -m "feat: report aggregate run-once errors"
  ```

---

### Task 6: Verify Exact Ownership Under Concurrency and Complete the Issue Validation

**Files:**

- Modify: `src/cli/commands/run-once/pi.test.ts`
- Modify: `src/cli/commands/triage/*.test.ts` only if a previous task required compatibility updates
- No production code changes unless this task exposes a regression from Tasks 1-5

**Interfaces:**

- Consumes: exact allocation, exact streamer, abortable runner, aggregate errors, and legacy triage behavior from earlier tasks.
- Produces: deterministic regression coverage for sibling/nested JSONL isolation and concurrent observed invocation isolation, plus final validation evidence for the PR.

- [ ] **Step 1: Add deterministic exact-session ownership tests**

  In `src/cli/commands/run-once/pi.test.ts`, add a test that writes a newer sibling/nested JSONL file and verifies only the exact parent file is observed:

  ```ts
  test("runPiPrompt ignores newer sibling and nested JSONL when observing exact parent", async (t) => {
    const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-exact-ignore-"));
    t.after(async () => {
      await rm(repoRoot, { recursive: true, force: true });
    });
    const observations: string[] = [];

    const runner = createMockRunner(async (call) => {
      const args = assertBundledPiCall(call);
      const sessionPath = args[args.indexOf("--session") + 1] ?? "";
      const invocationDir = dirname(sessionPath);
      await mkdir(join(invocationDir, "nested"), { recursive: true });
      await writeFile(
        join(invocationDir, "nested", "session.jsonl"),
        JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "nested" }] } }) + "\n",
        "utf8",
      );
      await writeFile(
        join(invocationDir, "sibling.jsonl"),
        JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "sibling" }] } }) + "\n",
        "utf8",
      );
      await writeFile(
        sessionPath,
        JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "parent" }] } }) + "\n",
        "utf8",
      );
      return { code: 0, stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}', stderr: "" };
    });

    await runPiPrompt(runner, "/repo", "prompt", {
      stage: "pi-plan",
      observeSession: true,
      sessionRoot: repoRoot,
      onObservation: (observation) => {
        if (observation.type === "text") observations.push(observation.text);
      },
    });

    assert.deepEqual(observations, ["parent"]);
  });
  ```

- [ ] **Step 2: Add concurrent observed invocation isolation test**

  Add a test that starts two `runPiPrompt()` calls with the same `sessionRoot`, captures both `--session` paths, writes distinct parent observations, and asserts both paths and observations are distinct:

  ```ts
  assert.notEqual(firstSessionPath, secondSessionPath);
  assert.deepEqual(firstObservations, ["first parent"]);
  assert.deepEqual(secondObservations, ["second parent"]);
  ```

  Use explicit deferred promises to control when each mock runner writes and closes; do not use `setTimeout()` to order the two invocations.

- [ ] **Step 3: Run the focused issue tests**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/triage/*.test.ts
  ```

  Expected: PASS. Concurrent or nested sessions cannot redirect observed parent progress, and triage still uses directory observation.

- [ ] **Step 4: Run the required run-once suite**

  Run:

  ```sh
  npm run test:run-once
  ```

  Expected: PASS.

- [ ] **Step 5: Run TypeScript lint**

  Run:

  ```sh
  npm run lint:ts
  ```

  Expected: PASS with zero warnings.

- [ ] **Step 6: Run Markdown lint**

  Run:

  ```sh
  npm run lint:md
  ```

  Expected: PASS.

- [ ] **Step 7: Confirm dependency files did not change**

  Run:

  ```sh
  git diff -- package.json npm-shrinkwrap.json package-lock.json
  ```

  Expected: no output. Because no npm dependency files changed, no Nix build is required by `AGENTS.md`.

- [ ] **Step 8: Commit final validation-only test adjustments if any were needed**

  ```sh
  git add src/cli/commands/run-once/pi.test.ts src/cli/commands/triage
  git commit -m "test: cover exact pi session isolation"
  ```

  If Step 1 and Step 2 were already committed in earlier tasks and this task only ran validation, skip this commit and record the validation output in the PR summary.

---

## Final Verification Commands

Run these commands before opening the implementation PR:

```sh
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/triage/*.test.ts
npm run test:run-once
npm run lint:ts
npm run lint:md
git diff -- package.json npm-shrinkwrap.json package-lock.json
```

Expected final results:

- All listed tests and lints pass.
- The dependency-file diff command prints no output; therefore no Nix build is required.
- Successful `run-once` still prints only the final JSON object to stdout.
- Error `run-once` JSON may include `causes`, and the same cause details appear in JSONL progress data.

## Self-Review Notes

- Spec coverage: Tasks 2 and 6 cover exact parent session ownership and nested/concurrent isolation; Task 3 covers exact-file reading, strict malformed JSON failure, I/O failure, serialized polling, and callback backpressure; Task 4 covers prompt abort, awaiting runner close and cleanup, and preserving independent terminal causes; Task 5 covers CLI aggregate formatting and triage non-migration; Task 1 covers reusable command-runner cancellation.
- Placeholder scan: The plan contains concrete file paths, interfaces, tests, commands, expected outcomes, and commit messages for each task.
- Type consistency: `CommandRunOptions.signal`, `PiSessionAllocation`, `createExactPiSessionObservationStreamer()`, `aggregatePiErrors()`, and `formatErrorWithCauses()` names are used consistently across tasks.
