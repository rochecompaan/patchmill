# Triage Verbose Tool Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `patchmill triage --verbose` to print live Pi tool-call events
during triage.

**Architecture:** Parse a `verbose` flag into `TriageConfig`, wire a live
`onToolCall` callback from `main()` through `runTriage()`, and run triage Pi
agents with a temporary `--session-dir` only when observing tool calls. Reuse
the existing run-once Pi session observation streamer and keep verbose events
out of triage JSON logs.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing Patchmill
command runner and Pi session stream utilities.

---

## Task 1: CLI flag and reporter output

**Files:**

- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/args.ts`
- Modify: `src/cli/commands/triage/main.ts`
- Modify: `src/cli/commands/triage/progress-output.ts`
- Test: `src/cli/commands/triage/args.test.ts`
- Test: `src/cli/commands/triage/main.test.ts`
- Test: `src/cli/commands/triage/progress-output.test.ts`

- [ ] **Step 1: Write failing args test**

Add a test that calls `parseArgs(["--verbose"], repoRoot, {}, config)` and
asserts `config.verbose === true`.

- [ ] **Step 2: Verify args test fails**

Run: `npm test -- src/cli/commands/triage/args.test.ts`

Expected: FAIL because `--verbose` is an unknown argument or `verbose` is
undefined.

- [ ] **Step 3: Add `verbose` to config parsing**

Add `verbose: false` to the default `TriageConfig` object and parse `--verbose`
to set `config.verbose = true`.

- [ ] **Step 4: Add reporter format tests**

Add tests for a new `formatToolCallLine()` function with inputs such as
`{ toolName: "bash" }` and
`{ toolName: "subagent", arguments: { agent: "worker" } }`.

- [ ] **Step 5: Verify reporter tests fail**

Run: `npm test -- src/cli/commands/triage/progress-output.test.ts`

Expected: FAIL because `formatToolCallLine()` does not exist.

- [ ] **Step 6: Implement concise tool-call rendering**

Add `TriageToolCallEvent` and `formatToolCallLine()` so the reporter prints
lines like `🔧 bash` and `🔧 subagent (agent=worker)`.

- [ ] **Step 7: Add main wiring test**

Add a `main()` test that invokes `main(["--verbose"], dependencies)`, captures
the config passed to `runTriage`, triggers
`config.onToolCall({ toolName: "bash" })`, and asserts stdout includes
`🔧 bash`.

- [ ] **Step 8: Verify main wiring test fails**

Run: `npm test -- src/cli/commands/triage/main.test.ts`

Expected: FAIL because `main()` does not wire `onToolCall`.

- [ ] **Step 9: Wire `onToolCall` in `main()`**

Extend the CLI progress reporter with `onToolCall`, create the reporter with
`verbose: config.verbose`, and pass `onToolCall: reporter.onToolCall` to
`runTriage()` only when verbose is true.

- [ ] **Step 10: Run focused tests**

Run:
`npm test -- src/cli/commands/triage/args.test.ts src/cli/commands/triage/main.test.ts src/cli/commands/triage/progress-output.test.ts`

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

- [ ] **Step 1: Write failing dry-run agent test**

Add a test that calls `runTriageDryRunAgent()` with `onToolCall` and asserts the
`pi` args include `--session-dir`.

- [ ] **Step 2: Verify dry-run agent test fails**

Run: `npm test -- src/cli/commands/triage/dry-run-agent.test.ts`

Expected: FAIL because no session directory is passed.

- [ ] **Step 3: Implement observation helper**

Create `runWithToolCallObservation()` that creates a temp session directory when
`onToolCall` is provided, starts `createPiSessionObservationStreamer()`, runs a
callback with the session directory, stops the streamer in `finally`, and
removes the temp directory.

- [ ] **Step 4: Use helper in dry-run agent**

Wrap the `runner.run("pi", ...)` call so the args include `--session-dir <dir>`
only when observation is enabled.

- [ ] **Step 5: Add execute agent test**

Add the equivalent `--session-dir` test for `runTriageExecuteAgent()` with
`onToolCall`.

- [ ] **Step 6: Implement execute agent wiring**

Pass `onToolCall` through `TriageExecutePromptInput` and use
`runWithToolCallObservation()` in `runTriageExecuteAgent()`.

- [ ] **Step 7: Add pipeline propagation test**

Add a test proving `runTriage()` passes `config.onToolCall` through the execute
path or dry-run path.

- [ ] **Step 8: Implement pipeline propagation**

Add `onToolCall` to `executeTriageIssues()` options and to the dry-run agent
input.

- [ ] **Step 9: Run focused triage tests**

Run: `npm run test:triage`

Expected: PASS.

## Task 3: Final verification and docs

**Files:**

- Modify: `src/cli/commands/triage/main.ts`
- Optional modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Confirm help includes verbose**

Check `HELP_TEXT` includes `--verbose` with live console behavior.

- [ ] **Step 2: Run full verification**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Review diff**

Run:
`git diff -- src/cli/commands/triage docs/specs/2026-06-07-triage-verbose-tool-logging-design.md docs/plans/2026-06-07-triage-verbose-tool-logging.md`

Expected: Diff only covers verbose triage tool-call logging plus spec/plan docs.
