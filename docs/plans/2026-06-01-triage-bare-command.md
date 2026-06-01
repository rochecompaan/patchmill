# Bare `patchmill triage` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill triage` execute the safe default triage run and
reserve help display for `--help`/`-h`.

**Architecture:** The command already separates argument parsing, CLI entrypoint
behavior, and triage issue selection. This change only updates the argument/help
defaults and tests; the existing safe issue selector remains unchanged.

**Tech Stack:** TypeScript, Node test runner, Patchmill CLI command modules.

---

## Files

- Modify: `src/cli/commands/triage/args.test.ts` to assert empty args execute by
  default.
- Modify: `src/cli/commands/triage/pipeline.test.ts` to assert updated help
  text.
- Modify: `src/cli/commands/triage/main.ts` to update help-only handling and
  help copy.
- Modify: `src/cli/commands/triage/args.ts` to stop treating empty args as help.

## Task 1: Empty args execute by default

- [ ] **Step 1: Write the failing test**

In `src/cli/commands/triage/args.test.ts`, change the empty-args test to expect
`showHelp` false while keeping execution enabled.

```ts
test("parseArgs executes safe default triage when no args are provided", () => {
  const config = parseArgs([], "/repo");

  assert.equal(config.showHelp, false);
  assert.equal(config.dryRun, false);
  assert.equal(config.execute, true);
  assert.equal(config.repoRoot, "/repo");
  assert.equal(config.issueNumber, undefined);
  assert.equal(config.limit, undefined);
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.triageThinking, "high");
  assert.equal(config.logDir, "/repo/.patchmill/triage-runs");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/cli/commands/triage/args.test.ts` Expected: FAIL because
`config.showHelp` is still `true` for empty args.

- [ ] **Step 3: Update production code**

In `src/cli/commands/triage/args.ts`, initialize `showHelp` to `false` instead
of `args.length === 0`.

In `src/cli/commands/triage/main.ts`, update `isHelpOnlyInvocation` so it
returns true only for `--help` or `-h`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/cli/commands/triage/args.test.ts` Expected: PASS.

## Task 2: Help copy documents the new default

- [ ] **Step 1: Write the failing test**

In `src/cli/commands/triage/pipeline.test.ts`, update the help text test to
match copy that says bare `patchmill triage` runs the configured triage skill
for eligible untriaged open issues.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/cli/commands/triage/pipeline.test.ts` Expected: FAIL
because the current help text still says no-arg invocations show help.

- [ ] **Step 3: Update help text**

In `src/cli/commands/triage/main.ts`, replace the no-arg help sentence with
explicit default-run wording and clarify `--all` as an include/re-triage option.

- [ ] **Step 4: Run focused triage tests**

Run: `npm run test:triage` Expected: PASS.

## Task 3: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test` Expected: PASS.

- [ ] **Step 2: Check working tree**

Run: `git status --short` Expected: only the intended docs and triage
command/test files are modified.
