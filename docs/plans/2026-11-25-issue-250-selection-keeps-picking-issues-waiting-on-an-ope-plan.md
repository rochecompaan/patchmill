# Skip issues that wait on an open Planning pull request — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Automatic selection skips a candidate that waits on an open Planning
pull request, prints a warning, and tries the next candidate.

**Architecture:** `selectRunIssue` gets a required, read-only `readFacts` input
that returns `FactsResult`. After the dependency check passes, automatic
selection reads the candidate's facts and applies `derivePhase` and
`derivedStop`. It skips the candidate when the result is the `inProgress` stop
for an open pull request. The explicit path does not change.

**Tech Stack:** TypeScript, Node `node:test`, the `FakeHost` and Git fixtures in
`test-support/`.

**Spec:**
[`docs/specs/2026-11-25-issue-250-selection-keeps-picking-issues-waiting-on-an-ope-design.md`](../specs/2026-11-25-issue-250-selection-keeps-picking-issues-waiting-on-an-ope-design.md)

Plan inputs: the spec above and its inline visual explanation. The spec has no
mockup and no HTML companion.

## Global Constraints

- Warning message passed to `warn`, exactly:
  `planning pull request #<pr> is waiting for review; skipping it.`
- Order of checks: status filter, then dependency check, then wait check.
- Explicit `--issue N` never calls `readFacts`.
- A throw from `readFacts`, an `ambiguous-branches` result, or a throw from
  `host.repository()` selects the candidate, with no warning.
- A skip needs all three: `derivePhase` stop `inProgress`, `derivedStop` label
  `inProgress`, and `facts.pullRequest?.state === "open"`.
- Selection does not read run results. A failed gate-wait publication is not
  retried by automatic selection (spec D8).
- Do not change `localWorkSource`, `gateWaitPublished`, `publishAttemptStop` or
  the conflict search.

## Review Focus

1. An open Planning pull request with `Closes #N`: `derivedStop` gives
   `needsInfo`, so the issue must stay selectable.
2. `readFacts` throws: the candidate is selected, not skipped and not dropped.
3. A blocked candidate must not call `readFacts`.
4. `run-once --interactive` without `--issue` must skip too. Broken wiring there
   would silently select the waiting issue, because errors select.
5. Existing integration tests that reach a gate wait through a second automatic
   run must name issue 9, or they return `no-work`.

---

### Task 1: Wait check in `selectRunIssue` and its callers

All callers change in this task, so the commit passes `npm run check:types`.

**Files:**

- Modify: `src/kernel/issue-selection.ts`
- Modify: `src/kernel/run-once.ts` (the `selectRunIssue` call near line 180)
- Modify: `src/kernel/interactive-start.ts`
- Modify: `src/kernel/run-once.test.ts` (the test
  `selection resumes in-progress issues…`, which calls `selectRunIssue`)
- Modify: `src/host/github-gh.test.ts` (the `selectRunIssue` call near line 766)
- Modify: `src/kernel/run-once-gate-wait.test.ts` (the local `gated` helper)
- Test: `src/kernel/issue-selection.test.ts`

**Interfaces:**

- Consumes: `derivePhase` (`src/kernel/phase.ts`), `derivedStop`
  (`src/kernel/interactive-loop.ts`), `collectFacts`, `FactsResult` and `Facts`
  (`src/kernel/facts.ts`).
- Produces: the new required input field of `selectRunIssue`:
  `readFacts: (issue: TrackedIssue) => Promise<FactsResult>`. The return type
  `RunIssueSelection` does not change.

- [ ] **Step 1: Add a facts helper and a default `readFacts` to the test setup**

In `issue-selection.test.ts`, add
`facts(pullRequest?: Partial<PullRequest>): FactsResult`. It returns
`kind: "facts"` with `stage: "spec"`, branch `agent/issue-9-spec`,
`baseBranch: "main"`, and a pull request when one is given. Pull request
defaults: `number: 48`, `state: "open"`, `draft: false`, `body: "Refs #9"`,
`headBranch` = the branch, `baseBranch: "main"`,
`headRepository: "fixture/repo"`, a URL. Fill the other required `Facts` fields
with fixed strings.

`setup` takes an optional `facts: Record<number, FactsResult | Error>` map. Its
`readFacts` records each issue number in a `readIssues` array. It then throws
the `Error` or returns the mapped result. An issue that is not in the map gets
`facts()` with no pull request. Pass `readFacts` to `selectRunIssue`.

- [ ] **Step 2: Write the failing tests**

All use the fixture issues 9 (older) and 10 (newer), both `agent-ready`.

- `automatic selection skips an issue that waits on an open planning pull request`:
  map 9 → `facts({})`. Expect selected 10, and `warnings` equals
  `["#9: planning pull request #48 is waiting for review; skipping it."]`.
- `a merged planning pull request is not skipped`: map 9 →
  `facts({ state: "merged" })`. Expect selected 9 and no warnings. This tests
  the state guard; `collectFacts` moves past a merged PR before it returns.
- `a closed-unmerged planning pull request is still selected`: map 9 →
  `facts({ state: "closed" })`. Expect selected 9.
- `a planning pull request with a closing reference is still selected`: map 9 →
  `facts({ body: "Closes #9" })`. Expect selected 9.
- `a wrong-target planning pull request is still selected`: map 9 →
  `facts({ baseBranch: "release" })`. Expect selected 9.
- `unreadable facts select the candidate without a warning`: once with 9 →
  `new Error("fetch failed")`, once with 9 →
  `{ kind: "ambiguous-branches", branches: ["a", "b"] }`. Expect selected 9 and
  no warnings.
- `only waiting candidates report no eligible issue`: map 9 and 10 →
  `facts({})`. Expect `{ kind: "none" }` and two warnings.
- `explicit selection of a waiting issue does not read facts`: map 9 →
  `facts({})`, call `select(9)`. Expect selected 9, `readIssues` empty, and no
  warnings.
- `a blocked candidate is not read`: dependencies of 9 have one open dependency,
  map 10 → `facts({})`. Expect `{ kind: "none" }` and `readIssues` equals
  `[10]`.

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `node --test src/kernel/issue-selection.test.ts` Expected: FAIL. The skip
tests select 9.

- [ ] **Step 4: Implement the wait check**

Add `readFacts` to the input type. Replace
`if (!open.length) return { kind: "selected", issue };` with: if there are no
open dependencies and `explicit !== undefined`, select. Otherwise call a private
`waitingPullRequest(issue)` and select when it returns `undefined`. When it
returns a pull request number, call `warn` with the Global Constraints message
and `continue` to the next candidate.

`waitingPullRequest(issue): Promise<number | undefined>` catches every error and
returns `undefined` for it. It returns `undefined` for `ambiguous-branches`. It
reads `host.repository()` only after `derivePhase` gives the `inProgress` stop.
It returns `facts.pullRequest.number` only when the three conditions of the
Global Constraints hold.

Keep the dependency `try` block for dependency reads only, so a facts error does
not become a "Cannot read dependencies" warning.

- [ ] **Step 5: Pass `readFacts` from every caller**

- `runOneIssue`:
  `readFacts: (issue) => collectFacts({ ...deps, config }, issue)`.
- `prepareInteractiveRun`:
  `readFacts: (issue) => collectFacts({ ...input.deps, config: input.config }, issue)`.
- `run-once.test.ts`, `github-gh.test.ts`, and the two direct `selectRunIssue`
  calls in `issue-selection.test.ts` that bypass `setup().select` (near lines
  100 and 127): pass `readFacts: async () => { throw new Error("no facts"); }`,
  so their existing assertions stay the same.

- [ ] **Step 5b: Make the `gated` helper explicit**

In the local `gated` helper of `src/kernel/run-once-gate-wait.test.ts`, the
first run stays automatic, because it publishes the planning PR. Every later
call of its `run` uses `{ issue: 9 }` by default. Those runs check the gate stop
of issue 9, not selection. Without this step, those tests return `no-work` after
the selection change.

- [ ] **Step 6: Run the tests and the type check**

Run: `npm test`. Expected: PASS. If another test fails with `no-work` because it
reaches a gate wait through a second automatic run of a waiting issue, change
that run to `{ issue: 9 }`. Change only tests whose subject is the gate stop,
not selection. Candidates are the test files that set
`specApproval.required = true` or `planApproval.required = true`. For a faster
first check, run:
`npm run check:types && node --test src/kernel/issue-selection.test.ts src/kernel/interactive-start.test.ts src/host/github-gh.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/kernel/issue-selection.ts src/kernel/issue-selection.test.ts \
  src/kernel/run-once.ts src/kernel/interactive-start.ts \
  src/kernel/run-once.test.ts src/host/github-gh.test.ts \
  src/kernel/run-once-gate-wait.test.ts
git add -u src test-support
git commit -m "fix(kernel): skip issues that wait on an open planning pull request (#250)"
```

### Task 2: Integration behavior and existing gate-wait tests

**Files:**

- Modify: `src/kernel/run-once-gate-wait.test.ts` (its local `gated` helper and
  new tests)
- Test: `src/kernel/run-once-gate-wait.test.ts`

**Interfaces:**

- Consumes: Task 1's `selectRunIssue` wiring, `setupRun` and `merge` from
  `test-support/run-once-fixture.ts`, `prepareInteractiveRun` from
  `src/kernel/interactive-start.ts`.
- Produces: no new interface.

- [ ] **Step 1: Give `gated` extra steps**

Give the local `gated` helper an optional `extraSteps: unknown[]` parameter that
it appends to its fake Pi steps.

- [ ] **Step 2: Write the integration tests**

`a waiting issue yields to newer ready work, in dry-run and in a run`:

1. Call
   `gated(t, [{ result: { status: "needs-input", summary: "Question" } }])`.
   Issue 9 now waits on its open spec PR.
2. Append issue 10 to the end of the host issues list (the `comments()` helper
   reads `issues[0]`), with `createdAt: "2026-10-16"`, labels `["agent-ready"]`,
   and the other fields copied from issue 9.
3. Clear `c.output`. Call `c.run({ dryRun: true })`. Expect `status: "dry-run"`
   and `issue: 10`. Expect one output line that matches
   `/Warning: Issue #9: planning pull request #\d+ is waiting for review; skipping it\./`.
4. Clear `c.output`. Call `c.run()`. Expect `status: "stopped"` and `issue: 10`;
   the extra step makes the planning session of issue 10 stop with Needs Info.
   Expect the same warning line.

`after the merge, the waiting issue is selected first again`: call `gated(t)`
and add issue 10 as above. Call
`merge(c, <headBranch of issue 9's open PR from c.host.state().pullRequests>)`.
Call `c.run({ dryRun: true })` while issue 10 is still `ready`. Expect
`issue: 9` and no skip warning.

`only waiting issues report no eligible issue`: call `gated(t)`, then `c.run()`
without an issue. Expect `{ status: "no-work" }` and an output line that
contains `No eligible issue`.

`interactive automatic selection skips a waiting issue`: call `gated(t)`, then
`prepareInteractiveRun({ config: c.config, deps: c.deps, report, sweep: async () => {} })`
with `report` that collects lines. Expect `{ kind: "none" }` and the warning
line.

`an automatic pass does not retry a failed gate publication`: call
`const g = await gated(t)`. Make `g.c.host.commentIssue` throw, call `g.run()`
(explicit) and expect `publicationErrors`. Restore `commentIssue`. Call
`g.c.run()` without an issue. Expect `{ status: "no-work" }` and the comment
count unchanged. Then call `g.run()` and expect a new comment that matches
`/Waiting for it to be merged/` (spec D8).

- [ ] **Step 3: Run the tests**

Run: `node --test src/kernel/run-once-gate-wait.test.ts` Expected: PASS. To
check that the tests can fail, temporarily revert the `issue-selection.ts`
change from Task 1 and confirm that the first, third, fourth and fifth new tests
fail.

- [ ] **Step 4: Run the full suite**

Run: `npm test` Expected: PASS.

- [ ] **Step 5: Run lint**

Run: `npm run lint` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src test-support
git commit -m "test(kernel): cover skipped waiting issues in run-once and interactive selection (#250)"
```

## Verification

- The unit tests in Task 1 cover the skip, the merge guard, the closed-unmerged
  case, the closing reference, the wrong target, unreadable facts, no candidate
  left, the explicit issue and the blocked candidate.
- The integration tests in Task 2 cover `run-once`, dry-run agreement, a real
  merge, "No eligible issue", interactive automatic selection, and D8.
- The existing gate-wait tests, run explicitly, cover `--issue <waiting>`.
- `localWorkSource` already maps `no-work` to an idle pass. Its existing tests
  cover that mapping, so the plan adds no Runner test.
- `npm test` and `npm run lint` pass. No npm dependency changes, so the Nix
  build is not required.

## Visual explanation

The tree shows task order and the files that each task owns.

```text
Task 1  selectRunIssue gets readFacts + wait check; all callers wired
├── src/kernel/issue-selection.ts        (wait check, warning)
├── src/kernel/issue-selection.test.ts   (9 unit tests, fixed facts)
├── src/kernel/run-once.ts               (unattended, dry-run → collectFacts)
├── src/kernel/interactive-start.ts      (run-once --interactive → collectFacts)
├── src/kernel/run-once.test.ts          (direct call gets readFacts)
├── src/host/github-gh.test.ts           (direct call gets readFacts)
└── src/kernel/run-once-gate-wait.test.ts (gated runs name issue 9)
        │ type check passes
        ▼
Task 2  integration tests (gated helper made explicit in Task 1)
└── src/kernel/run-once-gate-wait.test.ts
        ├── waiting issue yields to issue 10 (dry-run + run)
        ├── real merge → issue 9 first again
        ├── only waiting issues → No eligible issue
        ├── interactive automatic selection skips
        └── automatic pass does not retry a failed publication (D8)
```

## Companion artifacts

None. The visual explanation is inline.

## Planning review

### Review 1 — combined pass (spec and plan)

- Scope: this plan, with the specification
  `docs/specs/2026-11-25-issue-250-selection-keeps-picking-issues-waiting-on-an-ope-design.md`.
- Reviewer: `reviewer`, model `claude-bridge/claude-opus-5-5`, thinking `high`.
  Base revision `be9fa9517cac3e848e1b905acc18ae59b8898ad5`.
- Reviewed body SHA-256: plan
  `0eaba649c9684e8d158bfcbf742f133d38c1cfe52e9ba4d168a5a5a4e8acc3b2`, spec
  `40c10615c00cb8b535387471a767a2cc18580faee4631fff71e4eebd8079f352`.
- Survey, findings B1, B2 and S1–S6, and their dispositions: see the spec's
  Planning review record. All were accepted. The maintainer ruled B2.
- Confirmation: ready, no blocker. Optional notes:
  - N1: name the two direct calls in `issue-selection.test.ts`. Accepted: Task 1
    Step 5.
  - N2: the fail-first list missed the D8 test. Accepted: Task 2 Step 3.
  - N3: Task 1's commit left `npm test` failing. Accepted: the `gated` change
    and the full-suite rule moved into Task 1 (Step 5b, Step 6).
  - N4: append issue 10, because `comments()` reads `issues[0]`. Accepted: Task
    2 Step 2.
- Outcome after confirmation: `ready`, at plan body
  `fe780c859d3b81e9c76a6908b726971b4ce10a6fde60486718d32d812638f72e`.

### Review 2 — plan edits N1–N4

- Scope: this plan only, against the unchanged specification.
- Reviewer: `reviewer`, model `claude-bridge/claude-opus-5-5`, thinking `high`.
  Base revision `be9fa9517cac3e848e1b905acc18ae59b8898ad5`.
- Reviewed body SHA-256: plan
  `a87f537fdf59160504f7a595a091dac1eefa45fee307a677461b470572ed1735`. Compared
  spec `6a5c2224fea0cd36e61480fe2b03a210d1ce2f300772c6ccee5c40ec65c876e7`.
- Survey: the reviewer checked the direct `selectRunIssue` calls, the `gated`
  helper, the fixture, and the explicit run path. It confirmed N1–N4 with no
  blocker.
- Findings:
  - S1 (suggestion): `run-once-cost.test.ts:182` will need `{ issue: 9 }`.
    Rejected: Task 1 Step 6 already states the rule for this case, and
    `git add -u src test-support` stages it.
  - S2 (suggestion): "type check passes" wording undersells Step 6. Rejected:
    Step 6 runs `npm test` explicitly; the wording has no effect on the work.
  - S3 (suggestion): how `gated` keeps its first run automatic. Rejected: a
    sensible builder can decide; the existing `minute` counter already orders
    results.
- Inspection limits: no tests were run; other gated test files were
  spot-checked.
- Confirmation: not needed; there were no blockers.
- Final body SHA-256:
  `a87f537fdf59160504f7a595a091dac1eefa45fee307a677461b470572ed1735`. Compared
  spec `6a5c2224fea0cd36e61480fe2b03a210d1ce2f300772c6ccee5c40ec65c876e7`.
- Outcome: `ready`.

### Review 3 — post-review edits (spec and plan)

- Scope: the specification and the plan together.
- Reviewer: `reviewer`, model `claude-bridge/claude-opus-5-5`, thinking `high`.
  Base revision `be9fa9517cac3e848e1b905acc18ae59b8898ad5`.
- Edits reviewed: one blank line that ends each body before this record, and a
  markdownlint MD038 fix in spec D6 (the warning prefix code span).
- Reviewed body SHA-256: spec
  `12cade1fb5d6214e249f03295ea2095e32e081fa51c44b79feef97a5e3eba69d`, plan
  `4a10359660092a929e386c8c340d2e2fdf29c049d44173c2b8c6c7672ba39e19`.
- Survey: the reviewer confirmed that no other body change exists, and that D6
  still matches the `warn` prefix in `run-once.ts` and `interactive-start.ts`
  and the plan's Global Constraints.
- Findings: none.
- Inspection limits: no tests were run; the review covered only these edits.
- Final body SHA-256: spec
  `12cade1fb5d6214e249f03295ea2095e32e081fa51c44b79feef97a5e3eba69d`, plan
  `4a10359660092a929e386c8c340d2e2fdf29c049d44173c2b8c6c7672ba39e19`. The plan
  was compared with the spec at that hash.
- Outcome: `ready`.
