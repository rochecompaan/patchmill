# Triage Tool-Call Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill triage` print live Pi tool-call events by default.

**Architecture:** Wire a live `onToolCall` callback from `main()` through
`runTriage()` by default, and run triage Pi agents with a temporary
`--session-dir` whenever that callback is present. Reuse the existing run-once
Pi session observation streamer and keep tool-call events out of triage JSON
logs.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing Patchmill
command runner and Pi session stream utilities.

---

## Task 1: Default CLI tool-call output

**Files:**

- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/args.ts`
- Modify: `src/cli/commands/triage/main.ts`
- Modify: `src/cli/commands/triage/progress-output.ts`
- Test: `src/cli/commands/triage/args.test.ts`
- Test: `src/cli/commands/triage/main.test.ts`
- Test: `src/cli/commands/triage/progress-output.test.ts`

- [x] **Step 1: Write failing args test**

Add a test proving `parseArgs(["--verbose"], "/repo")` rejects the flag because
tool-call output is now default behavior.

- [x] **Step 2: Verify args test fails**

Run: `node --test src/cli/commands/triage/args.test.ts`

Expected: FAIL while `--verbose` is still accepted.

- [x] **Step 3: Remove `verbose` config parsing**

Remove `verbose` from `TriageConfig`, remove the default config field, and
remove `--verbose` from `parseArgs()` and `HELP_TEXT`.

- [x] **Step 4: Write failing reporter test**

Update `createTriageProgressReporter` tests to assert
`reporter.onToolCall({ toolName: "bash" })` prints `🔧 bash` without any verbose
option.

- [x] **Step 5: Implement default reporter output**

Remove the verbose guard in `onToolCall()` so the reporter always prints concise
tool-call lines.

- [x] **Step 6: Write failing main wiring test**

Update `main()` tests to call `main([])` and assert `runTriage()` receives an
`onToolCall` handler by default.

- [x] **Step 7: Implement default main wiring**

Create the progress reporter without a verbose option and always pass
`onToolCall: reporter.onToolCall` to `runTriage()`.

- [x] **Step 8: Run focused tests**

Run:
`node --test src/cli/commands/triage/args.test.ts src/cli/commands/triage/main.test.ts src/cli/commands/triage/progress-output.test.ts`

Expected: PASS.

## Task 2: Pi agent session observation

**Files:**

- Create: `src/cli/commands/triage/tool-call-observer.ts`
- Modify: `src/cli/commands/triage/dry-run-agent.ts`
- Modify: `src/cli/commands/triage/execute-agent.ts`
- Modify: `src/cli/commands/triage/execute-issues.ts`
- Modify: `src/cli/commands/triage/pipeline.ts`
- Test: `src/cli/commands/triage/dry-run-agent.test.ts`
- Test: `src/cli/commands/triage/execute-agent.test.ts`
- Test: `src/cli/commands/triage/pipeline.test.ts`

- [x] **Step 1: Write failing dry-run agent test**

Add a test that calls `runTriageDryRunAgent()` with `onToolCall` and asserts the
`pi` args include `--session-dir`.

- [x] **Step 2: Implement observation helper**

Create `runWithToolCallObservation()` that creates a temp session directory when
`onToolCall` is provided, starts `createPiSessionObservationStreamer()`, runs a
callback with the session directory, stops the streamer in `finally`, and
removes the temp directory.

- [x] **Step 3: Use helper in dry-run agent**

Wrap the `runner.run("pi", ...)` call so the args include `--session-dir <dir>`
only when observation is enabled.

- [x] **Step 4: Add execute agent test and wiring**

Add the equivalent `--session-dir` test for `runTriageExecuteAgent()` and pass
`onToolCall` through `TriageExecutePromptInput`.

- [x] **Step 5: Add pipeline propagation test and wiring**

Add a test proving `runTriage()` passes `config.onToolCall` through the dry-run
path, then pass `onToolCall` through dry-run and execute options.

- [x] **Step 6: Run focused triage tests**

Run: `npm run test:triage`

Expected: PASS.

## Task 3: Final verification and docs

**Files:**

- Modify: `docs/issue-agent-workflows.md`
- Modify: `docs/specs/2026-06-07-triage-tool-call-output-design.md`
- Modify: `docs/plans/2026-06-07-triage-tool-call-output.md`

- [x] **Step 1: Update docs**

Document that triage tool calls are streamed to the live console by default and
are not written to JSON logs.

- [x] **Step 2: Run full verification**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [x] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.
