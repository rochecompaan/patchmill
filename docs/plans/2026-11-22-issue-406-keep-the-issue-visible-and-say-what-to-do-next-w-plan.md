# Keep the issue visible and say what to do next: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Keep the issue and a state label in the console status bar from the
start of an Interactive Issue run until shutdown or an issue switch. Make the
review wait and the end of the run say who acts next.

**Architecture:** The kernel records the cleanup result in the ended
`RunSnapshot` and owns the review-wait text. A new console module, `run-end.ts`,
turns the settled run into one status label, one chat message, and one status
report. `run-status.ts` only fits an issue line into the terminal.
`ConsoleController` shows the line, posts the message, and clears only on
shutdown. The Web session keeps its own closing line.

**Tech Stack:** TypeScript on Node (type stripping), `node:test`, Pi extension
API.

**Spec:**
`docs/specs/2026-11-22-issue-406-keep-the-issue-visible-and-say-what-to-do-next-w-design.md`

## Inputs

- The spec above. Its labels, messages, and tool rules are exact copy.
- The spec's `## Visual explanation` (inline Mermaid). The spec has no mockup
  and no HTML companion.
- `GLOSSARY.md` (the widened Console agent entry).

## Global Constraints

- The maintainer merges the pull request. Patchmill does not poll for the merge.
- Guidance never tells the maintainer to edit code by hand. The Console agent
  makes requested pull request changes.
- Only `session_shutdown` (which an issue switch also fires) clears the
  `patchmill` status.
- Status labels and message lines are copied verbatim from the spec tables.
- Status and message failures never change a run decision or block shutdown.
- A thrown run error is always posted once, unless the console is closing.
- Do not change persisted run progress (`projectRunProgress`, `RunProgress`),
  issue comments, or labels.
- Never push the base branch. Never force-push.

In the commands below, `T` means
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test`, as `npm test`
uses it.

## Review Focus

1. **A run that settles during shutdown.** The controller must not show a status
   or post a message after `close()` starts. A pending continue must resolve.
   Task 5 tests it.
2. **A thrown run error shows once,** also with no issue number and in a Web
   session. Task 5 tests it.
3. **A recheck after a restart into the review wait.** The first wait of an
   attempt uses the first message, also on a restart. Task 2 tests it.
4. **A merged run whose cleanup was skipped.** The label must say
   `cleanup on next run`, not `cleaned up`. Task 4 tests it.
5. **A new run in the same controller after an ended run.** `ended` must reset,
   and `preparing` must show at once. Task 5 tests it.

---

### Task 1: Record the cleanup result in the ended snapshot

**Files:**

- Modify: `src/kernel/run-snapshot.ts`
- Modify: `src/kernel/run-once.ts` (the `cleanupMergedIssue` call and the
  `snapshot.ended` call near the end of `runOneIssue`)
- Test: `src/kernel/interactive-waits.test.ts`

**Interfaces:**

- Produces: `RunSnapshot.cleanup?: CleanupResult["status"]`. Import the type
  from `./merged-cleanup.ts`.
- Produces: `ended(summary, outcome, cleanup?)` on the `runSnapshot(...)`
  object. It sets `cleanup` only when the argument is defined.

- [ ] **Step 1: Write the failing tests** in `interactive-waits.test.ts`.
  - New test `a merged review wait reports the cleanup result`: use
    `setupRun(t, [implement])` and seed spec and plan. The `fakeHuman` `onWait`
    calls `mergePullRequest(c, branch, { closeIssue: true })` and returns
    `"continue"`. Without `closeIssue`, the fixture issue stays open and cleanup
    returns `skipped`. Pass `observe: (s) => snapshots.push(s)` to `c.run`.
    Assert that the last snapshot has `state` `"ended"` and `cleanup`
    `"cleaned"`.
  - In `a restart in the review wait ...` (the `fakeHuman` quits), observe the
    snapshots too. Assert that the last snapshot has `cleanup` `"skipped"`.
- [ ] **Step 2: Run them and make sure they fail.** Run
      `T src/kernel/interactive-waits.test.ts`. Expected: FAIL, because
      `cleanup` is `undefined`.
- [ ] **Step 3: Implement.** Keep the `cleanupMergedIssue` result in a variable
      and pass its `status` to `snapshot.ended`.
- [ ] **Step 4: Run them and make sure they pass.** Same command. Expected:
      PASS.
- [ ] **Step 5: Commit.** Message:
      `feat(kernel): record the cleanup result in the ended run snapshot (#406)`.

### Task 2: Say what to do in the review wait

**Files:**

- Modify: `src/kernel/review-wait.ts`
- Create: `src/kernel/review-wait.test.ts`
- Test: `src/kernel/interactive-waits.test.ts`

**Interfaces:**

- Produces: `reviewWaitMessage(input)` with
  `input: { url: string; issue: number; recheck: boolean }`. It returns the
  spec's first or recheck message exactly.

- [ ] **Step 1: Write the failing tests.**
  - `review-wait.test.ts`, test
    `the first message names the PR, the merger, continue, cleanup, changes and stop`:
    `assert.equal` of
    `reviewWaitMessage({ url: "https://x/pr/1", issue: 9, recheck: false })`
    against the spec's first message with the values filled in.
  - Same file, test `the recheck message says the PR is not merged yet`: the
    same check with `recheck: true` against the spec's recheck message.
  - `interactive-waits.test.ts`, test
    `review continue on an open PR waits again; ...`: record each
    `wait.message`. Assert that the first message starts with
    `Pull request ready for review:` and that the second message contains
    `is not merged yet`.
  - Same file, test `a verified PR gets agent-done ...`: replace
    `/https:.*merge/i` (it fails on the new multi-line text) with
    `/^Pull request ready for review: https:/`.
  - Same file, test `a restart in the review wait ...`: assert that the one wait
    message starts with `Pull request ready for review:`.
- [ ] **Step 2: Run them and make sure they fail.** Run
      `T src/kernel/review-wait.test.ts src/kernel/interactive-waits.test.ts`.
      Expected: FAIL. The function is not exported, and the text is old.
- [ ] **Step 3: Implement.** Add `reviewWaitMessage` with the spec copy. In
      `reviewWait`, keep a `recheck` flag. It is `false` for the first
      `awaitContinue` of the call, and `true` after each `continue` that goes
      back into the loop.
- [ ] **Step 4: Run them and make sure they pass.** Same command. Expected:
      PASS.
- [ ] **Step 5: Commit.** Message:
      `feat(kernel): explain the review wait and its recheck (#406)`.

### Task 3: Make the run status display one issue line

**Files:**

- Modify: `src/console/run-status.ts`
- Modify: `src/console/controller.ts` (only the `runStatus.show` call in the
  snapshot observer)
- Test: `src/console/run-status.test.ts`
- Test: `src/console/controller.test.ts` (`recordingStatus` only)

**Interfaces:**

- Produces: `StatusLine`, defined as
  `{ issue: number; title?: string; label: string }`.
- Produces: `formatRunStatus(line: StatusLine, width: number): string`. The
  shortening rules do not change.
- Produces: `progressLabel(snapshot: RunSnapshot): string`. It is the current
  state map, but `review-wait` gives the spec's review-wait label.
- Produces: `RunStatus` with `show(line: StatusLine)`, `refresh()`, and
  `clear()`. `createRunStatus` keeps its error handling.

- [ ] **Step 1: Update the tests** in `run-status.test.ts`.
  - `labels every run state` asserts `progressLabel(snapshot)` for each case,
    with the new review-wait label.
  - The width, title, and grapheme tests call `formatRunStatus` with
    `{ issue: 142, title, label }`.
  - `show, refresh and clear ...` passes a `StatusLine`.
  - New test `a long end label keeps the issue and shortens only the title`: use
    the line with `issue` 142, `title` `Show issue and step in status bar`,
    `label` `merged · cleaned up — safe to quit`, and width 60. The result
    starts with `#142`, ends with the full label, and has a `visibleWidth` of 60
    or less.
- [ ] **Step 2: Run them and make sure they fail.** Run
      `T src/console/run-status.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces. In the controller's snapshot
      observer, call `runStatus.show` with the issue, the title, and
      `progressLabel(snapshot)`. In `controller.test.ts`, make `recordingStatus`
      record `["show", line.label]`, and change the `runStatus` parameter type
      of `setup()` to `show(line: StatusLine)`. Change its expected calls from
      states to labels (for example `"preparing"` for `deriving`).
- [ ] **Step 4: Run the console suite.** Run `T "src/console/*.test.ts"`.
      Expected: PASS. `npm run check:types` passes.
- [ ] **Step 5: Commit.** Message:
      `refactor(console): show one issue line in the run status (#406)`.

### Task 4: Describe the end of a run

**Files:**

- Create: `src/console/run-end.ts`
- Create: `src/console/run-end.test.ts`

**Interfaces:**

- Consumes: `StatusLine` (Task 3), `RunSnapshot.cleanup` (Task 1), and
  `RunOnceOutcome` (`src/kernel/run-once.ts`).
- Produces: `RunEndInput`, `EndedRun`, and
  `describeRunEnd(input: RunEndInput): EndedRun | undefined`, as the spec
  defines them. `EndedRun` has the `StatusLine` fields, so callers pass it to
  `RunStatus.show` directly.

- [ ] **Step 1: Write the failing tests.**
  - `labels and messages for every end case` is a table test. It has one row for
    each row of the spec's label table: merged `cleaned`, merged `kept`, merged
    `skipped`, merged with no `cleanup`, pr-ready, stopped `needsInfo`, stopped
    `inProgress`, paused, failed, and not-started (`refused` with a reason).
    Each row asserts `outcome`, `label`, `explain`, and the full `message` with
    `assert.equal`. `<number>` stays literal in the text. Build the snapshot
    with `state: "ended"`, `summary`, `facts.pullRequest.state`, and `cleanup`,
    as each row needs.
  - `a thrown error wins over the ended snapshot summary`: an ended snapshot
    with the summary `The pull request is merged.` and `{ error: "boom" }` gives
    `outcome` `"failed"` and `summary` `"boom"`.
  - `the issue comes from the outcome or the start issue`: a refused outcome
    with no snapshot gives the outcome's `issue` and no `title`. A thrown error
    with no snapshot gives `input.issue`.
  - `returns undefined when no issue is known`: no `issue`, no snapshot, and a
    `no-work` outcome. Also no `issue`, no snapshot, and `{ error: "boom" }`.
- [ ] **Step 2: Run them and make sure they fail.** Run
      `T src/console/run-end.test.ts`. Expected: FAIL, because the module is
      missing.
- [ ] **Step 3: Implement** `describeRunEnd` with the spec rules and copy. Keep
      the copy tables in this module.
- [ ] **Step 4: Run them and make sure they pass.** Same command. Expected:
      PASS.
- [ ] **Step 5: Commit.** Message:
      `feat(console): describe how an Issue run ended (#406)`.

### Task 5: Keep the status after the run and post the end message

**Files:**

- Modify: `src/console/controller.ts`
- Modify: `src/console/extension.ts` (pass `announceRunEnd` through)
- Modify: `src/console/web-session-extension.ts` (pass `announceRunEnd: false`)
- Modify: `src/console/tools.ts`
- Modify: `README.md` (the Console agent tool list)
- Test: `src/console/controller.test.ts`
- Verify, unchanged: `src/console/web-session-extension.test.ts`

**Interfaces:**

- Consumes: `progressLabel` and `RunStatus` (Task 3), and `describeRunEnd` and
  `EndedRun` (Task 4).
- Produces: `ConsoleStatus.ended?: EndedRun`.
- Produces: an `announceRunEnd?: boolean` option on the controller dependencies
  and on `createPatchmillExtension`. The default is `true`.

- [ ] **Step 1: Write the failing tests** in `controller.test.ts`. Replace
      `snapshots update the status and a settled run clears it` and
      `a thrown run clears the status` with these tests:
  - `the status shows preparing at once and keeps the end label after a merged run`:
    `startRun` observes `deriving`, then an `ended` snapshot with a merged pull
    request and `cleanup: "cleaned"`. It returns
    `{ status: "completed", issue: 9 }`. The calls start with
    `["show", "preparing"]` and end with
    `["show", "merged · cleaned up — safe to quit"]`. They contain no `clear`.
  - `a stopped run keeps the end label`: a `stopped` outcome with `needsInfo`.
    The last call is `["show", "stopped: needs info — see the summary"]`.
  - `a thrown run keeps the end label and posts the error once`: the last call
    is `["show", "failed — see the error"]`. Exactly one `pi.messages` entry
    contains `boom`, and it starts with `Issue #9 run ended: failed.`.
  - `the end message resolves a pending continue`: in a review wait, call
    `controller.continueRun()`. The run then returns the merged outcome. The
    promise resolves to `status().ended.message`. The last `pi.messages` entry
    has that content.
  - `status reports the ended run`: after the run settles, `status().ended` has
    `outcome` `"merged"` and the merged label.
  - `a new run resets the ended run`: after one run ends, a second
    `startIssueRun(9)` that waits makes `status().ended` undefined. Its first
    call is `["show", "preparing"]`.
  - `shutdown after an ended run clears the status`: the last call is
    `["clear"]`.
  - Update `shutdown clears the status`: the calls before shutdown are
    `[["show", "preparing"], ["show", "awaiting approval"]]`, and the next call
    is `["clear"]`.
  - New test `a run that settles during shutdown shows and posts nothing`: after
    `awaitContinue` returns `quit`, `startRun` observes an `ended` snapshot and
    returns. No call comes after `["clear"]`, and no end message is posted.
  - New test `stopped and failed runs ask the Console agent to explain`: the end
    message of a `stopped` run and of a thrown run is posted with
    `triggerTurn: true`, and so is a merged run with `cleanup: "kept"`. A
    merged, cleaned run posts with `triggerTurn: false`.
  - New test `shutdown resolves a pending continue`: a run waits again after
    `continue`. Call `continueRun()`, then `shutdown()`. The promise resolves to
    `The console is shutting down.`.
  - New test `announceRunEnd false posts only a thrown error`: with
    `announceRunEnd: false`, a `stopped` run posts no message. A thrown run
    posts `boom` only. The status still shows the end label. A pending
    `continueRun` still resolves, with `ended.summary`.
  - New test `a failing end message does not block continue or shutdown`: make
    `pi.sendMessage` throw for the end message. A pending `continueRun` still
    resolves, and `shutdown()` resolves.
  - Update `continue reports the next end rather than stale state`. The `end`
    case expects the end message, which starts with
    `Issue #9 run ended: stopped (needs info).`.
  - Update `settled runs release the slot and only thrown errors notify`. The
    first run has no issue and throws, so `boom` is posted, as it is now. The
    second run, `startIssueRun(10)` with `no-work`, posts the not-started end
    message for issue #10. Wait one tick
    (`await new Promise((resolve) => setImmediate(resolve))`) after
    `startIssueRun(10)` and before `shutdown()`, so the second run settles while
    the console is open. The final count is 2.
- [ ] **Step 2: Run them and make sure they fail.** Run
      `T src/console/controller.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the controller rules and the Web session option from
      the spec. Remove `runStatus.clear()` from `finally`. Replace the outcome
      and error handlers with one settle step that does nothing when `closing`
      is true. The settle step catches and ignores its own failures. It resolves
      a pending `next` in a `finally` block: with the end message, or with
      `ended.summary` when `announceRunEnd` is false. In `close()`, resolve a
      pending `next` with `The console is shutting down.`. In `tools.ts`, add
      the spec's rules to the `promptGuidelines` of
      `patchmill_continue_issue_run` (with the explain rule and its safety
      rule), and change the `patchmill_run_status` description. Update
      `README.md` as the spec's README section says.
- [ ] **Step 4: Run the console and kernel suites.** Run
      `T "src/console/*.test.ts" "src/kernel/*.test.ts"`. Expected: PASS.
      `web-session-extension.test.ts` stays unchanged and green: its closing
      line, its `sync failed` error, and its refusal line. The shutdown
      assertions in `extension.test.ts` stay. Change other assertions only where
      the new `preparing` or end label changes them.
- [ ] **Step 5: Commit.** Message:
      `feat(console): keep the issue status after the run and say what to do next (#406)`.

### Final validation

- [ ] Run `npm test`. Expected: all suites pass, and `check:types` passes.
- [ ] Run `npm run lint`. Expected: no errors.
- [ ] Inspect `src/console/tools.ts`. Each spec guidance rule must be in
      `promptGuidelines`. This is static text, so there is no test.
- [ ] There are no npm dependency changes, so no Nix build is necessary.

## Visual explanation

Task order and ownership:

```text
Task 1  kernel: RunSnapshot.cleanup ──────────────┐
Task 2  kernel: reviewWaitMessage                 │ (independent)
Task 3  console: run-status StatusLine ───────┐   │
Task 4  console: run-end describeRunEnd ◄─────┴───┘ (uses StatusLine, cleanup)
Task 5  console: controller, web option, tools, README ◄── Tasks 3, 4
```

## Companion artifacts

None.

## Planning review

All passes are combined passes: the scope is this specification and the
implementation plan
(`docs/plans/2026-11-22-issue-406-keep-the-issue-visible-and-say-what-to-do-next-w-plan.md`).
Reviewer: canonical `reviewer` agent, model `claude-bridge/claude-opus-5-5`,
thinking `high`. Base revision: `f88c16b1a9fed98b2a99fe51d384b806ace6985d`. The
planner did not record body hashes for the intermediate passes. Only the final
hashes are recorded.

### Review 1, pass 1: initial

- **Survey:** the reviewer checked `review-wait.ts`, `run-once.ts`,
  `merged-cleanup.ts`, `run-progress.ts`, `controller.ts`, `run-status.ts`,
  `extension.ts`, `tools.ts`, `web-session-extension.ts`, `web-session.ts`, and
  their tests.
- **Findings and dispositions:**
  - B1 (the Web session end path was not designed): accepted. Added the
    `announceRunEnd` option and the Web session section.
  - B2 (the cleanup test merged without closing the issue): accepted. The plan
    now uses `closeIssue: true`.
  - B3 (an old regex breaks on the new text): accepted. Task 2 replaces it.
  - B4 (broken controller tests, and an error lost when no issue is known):
    accepted. Added the error fallback, the corrected undefined cases, and the
    test updates.
  - S1 to S11: accepted. Pending continue on close, copy fixes, the error wins
    the failed summary, Task 3 adapts the controller, `endedStatusLine` dropped,
    README step, glossary entry, diagram paths, test env prefix,
    shutdown-after-end test, note on the kernel copy voice.
- **Limits:** no tests run. The reviewer simulated the promise order and the
  regex with node.

### Review 1, pass 2: scoped confirmation

- R1 (blocker: a test expected 2 messages, but shutdown closed before the second
  run settled): accepted. The test waits one tick.
- Suggestions accepted: a pending continue resolves in the Web session, exact
  stopped sentences, the web test is verify-only, the `setup()` type.
- **Outcome:** `blocked` (a blocker remained after the confirmation). The
  maintainer asked for a new Planning review.

### Review 2, pass 1: initial (maintainer request)

- **Findings:** no blockers. Eight suggestions.
- **Dispositions:**
  - S1 (no show after closing), S2 (shutdown test copy), S4 ("Quit, and"), S5
    (constraint wording), S7 (`<number>` literal), and S8 (the settle step never
    rejects): accepted.
  - S3 ("fix the cause" wording): settled by the maintainer. The Console agent
    explains the problem from the summary at once (`triggerTurn: true`) and
    offers to resolve it.
  - S6 (Web continue text): rejected at first as low impact, then adopted
    through review 2 pass 2, S-a.
- **Outcome:** `ready`.

### Review 2, pass 2: scoped confirmation

- B1 (blocker: the offer to resolve a problem after the run had no safety
  limits, so data loss or label changes were possible): accepted. The Console
  agent guidance now has a safety rule, and the Risks section and the glossary
  are updated.
- Suggestions accepted: S-a (the Web continue resolves with the summary), S-b
  (the settle step uses `finally`, with a test for a failed post), S-c (the goal
  and the test cover a kept cleanup), and S-d (the no-issue error case is
  test-only).
- **Maintainer ruling:** the maintainer reviewed the B1 correction in the chat
  and declined a further reviewer pass ("no reviewer pass needed, proceed"). The
  ruling settles B1.
- **Final body SHA-256:**
  - specification:
    `db8d61c18d53227fabf601f8c1213d0bd097d76c78ff89eec776e7d0bf1215fc`
  - plan: `018a16c63c109e6d829eb333605e9cc2bd6ca7fe4fd49021c1db11773315746a`
  - the plan was compared with specification
    `db8d61c18d53227fabf601f8c1213d0bd097d76c78ff89eec776e7d0bf1215fc`
- **Outcome:** `ready`.
