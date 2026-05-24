# Pipeline Test Cleanup Pass 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce superfluous `runOneIssue` pipeline tests while preserving
direct unit coverage and one representative orchestration smoke per workflow
boundary.

**Architecture:** This pass changes tests only. It removes redundant broad
pipeline scenarios that duplicate direct lower-level tests already identified in
`docs/test-coverage-baseline.md`, then verifies the full test suite and coverage
command still pass.

**Tech Stack:** TypeScript, Node 24 built-in `node:test`, Node built-in
coverage, npm scripts.

---

## File structure

- Modify `scripts/agent-issue/pipeline.test.ts`: remove redundant `runOneIssue`
  scenarios.
- Modify `docs/test-coverage-baseline.md`: record which cleanup candidates were
  applied and the resulting test-count change.
- No production TypeScript files should change.
- No package or lockfile changes should be made.

## Task 1: Remove redundant dry-run pipeline tests

**Files:**

- Modify: `scripts/agent-issue/pipeline.test.ts`
- Modify: `docs/test-coverage-baseline.md`

- [ ] **Step 1: Confirm direct safety coverage exists**

Run:

```bash
node --test scripts/agent-issue/selection.test.ts scripts/agent-issue/run-state.test.ts
```

Expected: both direct suites pass. These direct suites cover priority selection
and resumable-state classification.

- [ ] **Step 2: Remove two redundant dry-run scenarios**

In `scripts/agent-issue/pipeline.test.ts`, keep this representative pipeline
smoke:

```ts
test("runOneIssue dry-run lists open issues and returns the selected agent-ready issue without mutations", async () => {
```

Delete these two entire test blocks:

```ts
test("runOneIssue dry-run ignores resumable in-progress issues and previews the next ready issue", async () => {
```

```ts
test("runOneIssue dry-run previews agent-ready issues even when saved state has stale finished branch and worktree", async () => {
```

Do not alter production code.

- [ ] **Step 3: Verify focused pipeline tests still pass**

Run:

```bash
node --test scripts/agent-issue/pipeline.test.ts --test-name-pattern="dry-run|returns no-issue|resumes a single in-progress"
```

Expected: focused pipeline tests pass.

- [ ] **Step 4: Update the audit document**

In `docs/test-coverage-baseline.md`, append this section after the Candidate
cleanup items table:

```markdown
## Cleanup pass 1 results

- Removed two redundant dry-run pipeline scenarios while keeping the
  representative dry-run smoke test.
- Direct safety coverage remains in `scripts/agent-issue/selection.test.ts` and
  `scripts/agent-issue/run-state.test.ts`.
```

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add scripts/agent-issue/pipeline.test.ts docs/test-coverage-baseline.md
git commit -m "test: trim dry-run pipeline coverage"
```

## Task 2: Consolidate clean-worktree ignore pipeline coverage

**Files:**

- Modify: `scripts/agent-issue/pipeline.test.ts`
- Modify: `docs/test-coverage-baseline.md`

- [ ] **Step 1: Confirm direct git safety coverage exists**

Run:

```bash
node --test scripts/agent-issue/git.test.ts
```

Expected: direct git tests pass, including ignore-prefix and todo-root coverage.

- [ ] **Step 2: Keep one configured-ignore pipeline smoke**

In `scripts/agent-issue/pipeline.test.ts`, keep this representative pipeline
scenario because it proves configured clean-status ignore prefixes flow through
`runOneIssue`:

```ts
test("runOneIssue honors configured clean-status ignore prefixes", async () => {
```

Delete these four entire test blocks:

```ts
test("runOneIssue ignores configured run-state logs during the clean-worktree check", async () => {
```

```ts
test("runOneIssue ignores the default Pi todo root during the clean-worktree check", async () => {
```

```ts
test("runOneIssue ignores a custom Pi todo root during the clean-worktree check", async () => {
```

```ts
test("runOneIssue ignores a custom Pi todo root when reusing an existing worktree", async () => {
```

- [ ] **Step 3: Verify focused clean-worktree behavior**

Run:

```bash
node --test scripts/agent-issue/pipeline.test.ts --test-name-pattern="clean-worktree|clean-status ignore"
```

Expected: the remaining configured-ignore pipeline test passes.

- [ ] **Step 4: Update the audit document**

Append these bullets under `## Cleanup pass 1 results` in
`docs/test-coverage-baseline.md`:

```markdown
- Removed four clean-worktree ignore pipeline variants while keeping the
  configured clean-status ignore prefix smoke test.
- Direct safety coverage remains in `scripts/agent-issue/git.test.ts` for
  run-state log, todo-root, reuse, and similar-path ignore behavior.
```

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add scripts/agent-issue/pipeline.test.ts docs/test-coverage-baseline.md
git commit -m "test: consolidate clean-worktree pipeline cases"
```

## Task 3: Consolidate cleanup hook and visual evidence pass-through coverage

**Files:**

- Modify: `scripts/agent-issue/pipeline.test.ts`
- Modify: `docs/test-coverage-baseline.md`

- [ ] **Step 1: Confirm direct safety coverage exists**

Run:

```bash
node --test src/cleanup/hooks.test.ts scripts/agent-issue/visual-evidence.test.ts src/host/forgejo-visual-evidence.test.ts
```

Expected: direct cleanup-hook and visual-evidence tests pass.

- [ ] **Step 2: Keep representative orchestration boundaries**

In `scripts/agent-issue/pipeline.test.ts`, keep these representative pipeline
scenarios:

```ts
test("runOneIssue runs configured generic cleanup hooks", async () => {
```

```ts
test("runOneIssue uploads visual evidence to the PR before posting the issue handoff", async () => {
```

Delete these three entire test blocks:

```ts
test("runOneIssue does not run cleanup commands when cleanup hooks are not configured", async () => {
```

```ts
test("runOneIssue reports cleanup hook failures when process termination is unsafe", async () => {
```

```ts
test("runOneIssue keeps visual evidence when no uploader is configured", async () => {
```

- [ ] **Step 3: Verify focused behavior still passes**

Run:

```bash
node --test scripts/agent-issue/pipeline.test.ts --test-name-pattern="cleanup hooks|visual evidence"
```

Expected: the remaining cleanup-hook and visual-evidence orchestration tests
pass.

- [ ] **Step 4: Update the audit document**

Append these bullets under `## Cleanup pass 1 results` in
`docs/test-coverage-baseline.md`:

```markdown
- Removed two cleanup-hook pipeline variants while keeping the configured
  cleanup-hook invocation smoke test.
- Removed the no-uploader visual-evidence pipeline pass-through test while
  keeping the upload-before-handoff ordering test.
- Direct safety coverage remains in `src/cleanup/hooks.test.ts`,
  `scripts/agent-issue/visual-evidence.test.ts`, and
  `src/host/forgejo-visual-evidence.test.ts`.
```

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add scripts/agent-issue/pipeline.test.ts docs/test-coverage-baseline.md
git commit -m "test: trim pipeline hook pass-through cases"
```

## Task 4: Final verification and result notes

**Files:**

- Modify: `docs/test-coverage-baseline.md`

- [ ] **Step 1: Count remaining pipeline tests**

Run:

```bash
rg -n "^test\(" scripts/agent-issue/pipeline.test.ts | wc -l
```

Expected: the count is 55, down from the original 64.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run test:coverage
npm run lint:md
```

Expected:

- `npm test` passes.
- `npm run test:coverage` passes and prints a coverage report.
- `npm run lint:md` passes.

- [ ] **Step 3: Update final result notes**

Append this bullet under `## Cleanup pass 1 results` in
`docs/test-coverage-baseline.md`, replacing the coverage values with the
all-files row from the verification run:

```markdown
- Pipeline test count changed from 64 to 55. Final full-suite coverage after
  pass 1: line `<line>%`, branch `<branch>%`, function `<function>%`.
```

- [ ] **Step 4: Commit final notes**

Run:

```bash
git add docs/test-coverage-baseline.md
git commit -m "docs(test): record cleanup pass results"
```

## Completion criteria

- `scripts/agent-issue/pipeline.test.ts` removes exactly nine redundant pipeline
  scenarios.
- At least one representative pipeline smoke remains for dry-run selection,
  configured clean-status ignores, cleanup-hook invocation, and visual-evidence
  upload ordering.
- Direct lower-level tests pass for every removed behavior family.
- `npm test`, `npm run test:coverage`, and `npm run lint:md` pass.
- `docs/test-coverage-baseline.md` records what was removed and the final
  coverage result.
