# Node Coverage Test Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Node built-in coverage reporting, capture a baseline, and prepare
a critical unit-test audit without adding third-party coverage dependencies.

**Architecture:** Patchmill already uses Node 24's built-in `node:test` runner.
This plan adds a `test:coverage` npm script that reuses the existing test globs
with Node's built-in coverage flags and excludes test files from the report,
then documents the baseline and first audit targets.

**Tech Stack:** TypeScript, Node 24 built-in test runner, npm scripts, Markdown
docs.

---

## File structure

- Modify `package.json`: add `test:coverage` next to the existing `test` script.
- Create `docs/test-coverage-baseline.md`: record the first coverage run and
  test-audit hotspots.
- No production TypeScript files should change in this plan.
- No third-party dependencies should be added.

## Task 1: Add the built-in coverage npm script

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add `test:coverage` to `package.json`**

In `package.json`, add this script immediately after the existing `test` script:

```json
"test:coverage": "node --test --experimental-test-coverage --test-coverage-include='bin/**/*.ts' --test-coverage-include='scripts/**/*.ts' --test-coverage-include='src/**/*.ts' --test-coverage-include='test-support/**/*.ts' --test-coverage-exclude='**/*.test.ts' \"bin/*.test.ts\" \"scripts/agent-issue-triage/*.test.ts\" \"scripts/agent-issue/*.test.ts\" \"src/**/*.test.ts\" \"test-support/*.test.ts\"",
```

The surrounding scripts block should become:

```json
"scripts": {
  "patchmill": "node bin/patchmill.ts",
  "triage": "node scripts/agent-issue-triage.ts",
  "run-once": "node scripts/agent-issue-once.ts",
  "audit:generalization": "bash ./scripts/audit-generalization.sh",
  "lint": "npm run format:check && npm run lint:ts && npm run lint:md",
  "lint:ts": "eslint \"{bin,scripts,src,test-support}/**/*.ts\" --max-warnings=0",
  "lint:md": "markdownlint-cli2",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "prepare": "husky",
  "test": "node --test \"bin/*.test.ts\" \"scripts/agent-issue-triage/*.test.ts\" \"scripts/agent-issue/*.test.ts\" \"src/**/*.test.ts\" \"test-support/*.test.ts\"",
  "test:coverage": "node --test --experimental-test-coverage --test-coverage-include='bin/**/*.ts' --test-coverage-include='scripts/**/*.ts' --test-coverage-include='src/**/*.ts' --test-coverage-include='test-support/**/*.ts' --test-coverage-exclude='**/*.test.ts' \"bin/*.test.ts\" \"scripts/agent-issue-triage/*.test.ts\" \"scripts/agent-issue/*.test.ts\" \"src/**/*.test.ts\" \"test-support/*.test.ts\"",
  "test:cli": "node --test bin/*.test.ts",
  "test:triage": "node --test scripts/agent-issue-triage/*.test.ts",
  "test:run-once": "node --test scripts/agent-issue/*.test.ts"
}
```

- [ ] **Step 2: Verify the coverage command runs**

Run:

```bash
npm run test:coverage
```

Expected:

- All tests pass.
- The output ends with `# start of coverage report` and
  `# end of coverage report`.
- Test files such as `*.test.ts` do not appear as rows in the coverage table.
- There are no new npm dependencies or lockfile changes.

- [ ] **Step 3: Verify the normal test command still runs**

Run:

```bash
npm test
```

Expected:

- All tests pass.
- The command output does not include a coverage report.

- [ ] **Step 4: Commit the script change**

Run:

```bash
git add package.json
git commit -m "test: add node coverage script"
```

## Task 2: Record the coverage baseline and audit targets

**Files:**

- Create: `docs/test-coverage-baseline.md`

- [ ] **Step 1: Create the baseline document**

Create `docs/test-coverage-baseline.md` after `npm run test:coverage` has
completed. Copy the exact `all files` percentages from the coverage report into
the Summary section.

Use this content, replacing only the three percentage values with the values
from the coverage report:

````markdown
# Test Coverage Baseline

Generated with:

```bash
npm run test:coverage
```

## Summary

- Date: 2026-05-24
- Runner: Node built-in `node:test` coverage
- Line coverage: copy the `line %` value from the `all files` row
- Branch coverage: copy the `branch %` value from the `all files` row
- Function coverage: copy the `funcs %` value from the `all files` row

## Initial observations

- `scripts/agent-issue/pipeline.test.ts` is the largest test hotspot by size and
  should be reviewed first for duplicate orchestration coverage.
- Direct unit tests should remain close to the modules they exercise.
- Pipeline tests should be retained when they cover unique workflow transitions,
  resume behavior, or safety boundaries not asserted elsewhere.
- No coverage threshold is enforced yet; thresholds should be considered after
  the cleanup pass stabilizes the baseline.

## First audit targets

1. `scripts/agent-issue/pipeline.test.ts` — identify scenarios that retest
   lower-level selection, state, prompt, git, or visual-evidence behavior.
2. `scripts/agent-issue/pi.test.ts` and `scripts/agent-issue/prompts.test.ts` —
   check for duplicated prompt-string assertions and replace brittle text checks
   with contract-level assertions where possible.
3. `src/config/load.test.ts` — check whether validation cases can be
   table-driven while preserving one direct assertion per validation rule.
````

- [ ] **Step 2: Verify Markdown formatting**

Run:

```bash
npm run lint:md
```

Expected:

- Markdown lint passes.

- [ ] **Step 3: Commit the baseline document**

Run:

```bash
git add docs/test-coverage-baseline.md
git commit -m "docs(test): record coverage baseline"
```

## Task 3: Do the first critical test-audit pass

**Files:**

- Modify: `docs/test-coverage-baseline.md`

- [ ] **Step 1: Inspect test suite size and distribution**

Run:

```bash
for f in $(find bin scripts src test-support -type f -name '*.test.ts' | sort); do
  printf '%4d %s\n' "$(rg -n '(^|[[:space:]])test\(' "$f" | wc -l)" "$f"
done | sort -nr | head -40

wc -l $(find bin scripts src test-support -type f -name '*.test.ts' | sort) | sort -nr | head -25
```

Expected:

- The output ranks test files by test count and line count.
- `scripts/agent-issue/pipeline.test.ts` appears near the top.

- [ ] **Step 2: Read the largest pipeline-test sections**

Run:

```bash
rg -n "^test\(" scripts/agent-issue/pipeline.test.ts
```

Expected:

- The output lists every pipeline scenario name in
  `scripts/agent-issue/pipeline.test.ts`.

Review each scenario name and mark it as one of:

- `keep`: unique orchestration, resume, safety, or side-effect sequencing
  coverage.
- `merge`: same workflow branch as another test with only cosmetic variation.
- `move-down`: detailed behavior better covered by a direct unit test in a
  lower-level module.
- `delete-after-confirming-direct-coverage`: duplicate coverage already proven
  by direct unit tests.

- [ ] **Step 3: Append concrete audit candidates to the baseline doc**

Append a `Candidate cleanup items` section to `docs/test-coverage-baseline.md`
using the findings from Step 2. Use this table shape and write one row for each
concrete candidate found during the review:

```markdown
## Candidate cleanup items

| File | Test or area | Recommendation | Reason | Required safety check |
| ---- | ------------ | -------------- | ------ | --------------------- |
```

Each recommendation must be one of `keep`, `merge`, `move-down`, or
`delete-after-confirming-direct-coverage`. Each row must name the exact test or
area, explain why the recommendation is safe, and state which direct test or
command protects the same behavior.

- [ ] **Step 4: Verify docs and tests**

Run:

```bash
npm run lint:md
npm test
npm run test:coverage
```

Expected:

- Markdown lint passes.
- Normal tests pass.
- Coverage tests pass and the report remains usable.

- [ ] **Step 5: Commit the audit notes**

Run:

```bash
git add docs/test-coverage-baseline.md
git commit -m "docs(test): identify test audit targets"
```

## Completion criteria

- `npm run test:coverage` exists and uses Node built-in coverage only.
- Coverage output excludes `*.test.ts` rows.
- `npm test` still passes.
- `docs/test-coverage-baseline.md` records the current baseline and concrete
  first-pass audit candidates.
- No production behavior changes are introduced.
