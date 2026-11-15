# Run state in the Pi status bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox syntax.
> This kernel plan does not require subagent tools.

**Goal:** Show `#N <title>  ·  <state>` in the Pi footer during an Interactive
Issue run, and clear it when the run ends or the console shuts down.

**Architecture:** The kernel adds an optional issue title to `RunSnapshot`. A
new console module `run-status.ts` formats the segment and owns the `patchmill`
footer status. `ConsoleController` feeds it snapshots and clears it when the run
settles. The extension builds its UI adapter from `ctx.ui` and `process.stdout`.

**Tech Stack:** TypeScript, Node.js `node:test`,
`@earendil-works/pi-coding-agent` extension API, `visibleWidth` from
`@earendil-works/pi-tui`.

**Spec:**
[Issue #367 design](../specs/2026-11-15-issue-367-console-extension-show-current-issue-and-run-sta-design.md).
No mockup applies (terminal footer text, no browser layout).

## Global Constraints

- Footer status key: `patchmill`.
- Separator: `" \u00a0·\u00a0 "` (space, no-break space, `·`, no-break space,
  space). Visible width 5.
- Labels: `deriving` → `preparing`; `planning` and `implementation` →
  `formatPhaseStart(phase ?? state, session)`; `gate-wait` →
  `awaiting approval`; `review-wait` → `awaiting review`; `blocked` → `blocked`;
  `ended` → `ended`.
- Segment: `#<issue> <title><sep><label>`; without a title:
  `#<issue><sep><label>`. No `patchmill` prefix. No ANSI escapes.
- Shortening: title only, ending in `…`, at grapheme boundaries; drop the title
  when the budget is below 2 columns.
- Width source: `process.stdout.columns`, default 80.
- Status errors never reach the run or the shutdown.
- `progress.json` does not change. No dependency changes, so no Nix build is
  needed.

## Review Focus

1. A title with newlines, tabs, or repeated spaces: the segment stays on one
   line with single spaces. Task 2.
2. A title with wide characters (CJK, emoji) in a narrow terminal: the segment
   fits the width and keeps the state. Task 2.
3. A terminal so narrow that the state alone barely fits: the title is dropped,
   not shown as a lone `…`. Task 2.
4. The run throws instead of returning: the segment is still cleared. Task 3.
5. A stale Pi context (`setStatus` throws) during shutdown: shutdown still
   completes. Tasks 2 and 4.

## File responsibilities

| File                                 | Responsibility                                            |
| ------------------------------------ | --------------------------------------------------------- |
| `src/kernel/run-snapshot.ts`         | `title?: string` on `RunSnapshot`; `title()` setter.      |
| `src/kernel/run-once.ts`             | Set the title after each issue fetch.                     |
| `src/console/run-status.ts` (new)    | Segment text, width budget, `patchmill` status ownership. |
| `src/console/controller.ts`          | Feed snapshots to `runStatus`; clear on settle and close. |
| `src/console/extension.ts`           | Build the UI adapter, resize refresh, clear on shutdown.  |
| `test-support/fake-extension-api.ts` | Record footer statuses set through `ctx.ui.setStatus`.    |

---

### Task 1: Issue title in run snapshots

**Files:**

- Modify: `src/kernel/run-snapshot.ts`
- Modify: `src/kernel/run-once.ts` (the two `workflow.issue(issueNumber)`
  assignments to `issue`, near the claim check and after `snapshot.deriving()`)
- Test: `src/kernel/run-snapshot.test.ts`

**Interfaces:**

- Produces: `RunSnapshot.title?: string`;
  `runSnapshot(...).title(title: string): void`.

- [ ] **Step 1: Write the failing tests**
  - `"title() is carried by the next emission without emitting or persisting"`:
    build `runSnapshot` with recording `observe` and `persist`; call
    `snapshot.title("Add login")`; assert both recorders are empty; call
    `await snapshot.phase("planning", 1)`; assert the observed snapshot has
    `title === "Add login"`.
  - `"every emitted snapshot carries the issue title"`: use the existing
    two-session fixture (`setupRun` with plan then `implement`) and
    `observe: (s) => snapshots.push(s)`; assert `snapshots.length > 0` and
    `snapshots.every((s) => s.title === "Add login")`.
  - `"an edited title appears on the next emission"`: build `runSnapshot` with a
    recording `observe`; `title("Old")`, `phase("planning", 1)`, `title("New")`,
    `deriving()`; assert the observed titles are `["Old", "New"]`.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test src/kernel/run-snapshot.test.ts` Expected: FAIL
  (`snapshot.title is not a function`, missing `title`).

- [ ] **Step 3: Implement**

  Add `title?: string` to `RunSnapshot`. Add
  `title(title: string) { current = { ...current, title }; }` to the returned
  object. In `runOneIssue`, call `snapshot.title(issue.title)` directly after
  each `issue = await workflow.issue(issueNumber)` /
  `let issue = await workflow.issue(...)`.

- [ ] **Step 4: Run to verify they pass**

  Run:
  `node --test src/kernel/run-snapshot.test.ts src/kernel/run-progress*.test.ts`
  Expected: PASS. `progress.json` assertions are unchanged.

- [ ] **Step 5: Commit** —
      `feat(kernel): carry the issue title in run snapshots`

### Task 2: Segment formatter and status owner

**Files:**

- Create: `src/console/run-status.ts`
- Test: `src/console/run-status.test.ts`

**Interfaces:**

- Consumes: `RunSnapshot` (Task 1), `formatPhaseStart` from
  `src/kernel/console.ts`, `visibleWidth` from `@earendil-works/pi-tui`.
- Produces:
  - `export const RUN_STATUS_KEY = "patchmill"`
  - `export function formatRunStatus(snapshot: RunSnapshot, width: number): string`
  - `export type RunStatusUi = { setStatus(key: string, text: string | undefined): void; columns(): number }`
  - `export type RunStatus = { show(snapshot: RunSnapshot): void; refresh(): void; clear(): void }`
  - `export function createRunStatus(ui: RunStatusUi): RunStatus`

- [ ] **Step 1: Write the failing tests**

  Use a helper `snap(state, extra?)` with `issue: 142`,
  `title: "Show issue and step in status bar"`, `session: 2`, and
  `const SEP = " \u00a0·\u00a0 "`.
  - `"labels every run state"`: at width 200, assert the segment equals
    `#142 Show issue and step in status bar${SEP}<label>` for: `deriving` →
    `preparing`; `planning` with `phase: "planning", session: 1` →
    `01 planning`; `implementation` with `phase: "implementation"` →
    `02 implementation`; `gate-wait` → `awaiting approval`; `review-wait` →
    `awaiting review`; `blocked` → `blocked`; `ended` → `ended`.
  - `"cleans the title and omits a missing one"`: title `"A\n\tB   C "` →
    `#142 A B C${SEP}preparing`; title `undefined` and title `" \n"` →
    `#142${SEP}preparing`; title `"a\u009bb \u001b[31mred\u001b[0m"` → a segment
    with no character in `\u0000-\u001f` or `\u007f-\u009f` and no `[31m`.
  - `"shortens only the title to fit the width"`: for the full implementation
    segment `s` at width 200, assert `formatRunStatus(…, visibleWidth(s))`
    equals `s`. At width 40, assert the result ends with
    `…${SEP}02 implementation`, starts with `#142 Show`, and
    `visibleWidth(result) <= 40`.
  - `"counts wide characters"`: title `"状態バーに課題を表示する"`, state
    `blocked`, width 24; assert `visibleWidth(result) <= 24` and it ends with
    `…${SEP}blocked`.
  - `"drops the title when no room remains"`: width
    `visibleWidth("#142 " + SEP + "02 implementation") + 1`; assert the result
    equals `#142${SEP}02 implementation`.
  - `"show, refresh and clear drive the patchmill status"`: a recording fake UI
    with mutable `columns`; `show` at 200 sets the full text under
    `"patchmill"`; set columns to 40 and `refresh()`; assert the new text is
    shortened; `clear()` records `undefined`; a later `refresh()` records
    nothing new.
  - `"status errors are ignored"`: a UI whose `setStatus` throws, and a UI whose
    `columns` throws; assert `show`, `refresh`, and `clear` do not throw.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test src/console/run-status.test.ts` Expected: FAIL (module not
  found).

- [ ] **Step 3: Implement `run-status.ts`**

  Clean the title with `cleanValue(title).replace(/\s+/g, " ").trim()`
  (`cleanValue` from `src/kernel/terminal-layout.ts`). Cut the title with
  `new Intl.Segmenter(undefined, { granularity: "grapheme" })`, appending
  graphemes while the visible width stays at most `budget - 1`, then `trimEnd()`
  and add `…`. `createRunStatus` keeps the last snapshot and wraps each `ui`
  call in `try { … } catch {}`.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test src/console/run-status.test.ts` Expected: PASS.

- [ ] **Step 5: Commit** — `feat(console): format the run status segment`

### Task 3: Controller drives the status

**Files:**

- Modify: `src/console/controller.ts`
- Test: `src/console/controller.test.ts`

**Interfaces:**

- Consumes: `RunStatus` (Task 2).
- Produces: `ConsoleController` dependency
  `runStatus?: Pick<RunStatus, "show" | "clear">`.

- [ ] **Step 1: Write the failing tests**

  Extend `setup()` with an optional recording `runStatus` that pushes
  `["show", snapshot.state]` and `["clear"]`.
  - `"snapshots update the status and a settled run clears it"`: `startRun`
    calls `observe` with `deriving`, then `planning` (`phase: "planning"`), then
    `ended`, and returns `{ status: "no-work" }`. After the run settles (await
    `setImmediate`), assert the calls equal
    `[["show","deriving"], ["show","planning"], ["show","ended"], ["clear"]]`.
  - `"a thrown run clears the status"`: `startRun` observes `deriving` then
    throws; after it settles, assert the last call is `["clear"]`.
  - `"shutdown clears the status"`: `startRun` observes `gate-wait` and awaits
    `human.awaitContinue(...)`; call `controller.shutdown()`; assert the calls
    contain `["clear"]` after `["show","gate-wait"]`.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test src/console/controller.test.ts` Expected: FAIL (no
  `show`/`clear` calls).

- [ ] **Step 3: Implement**

  Add `runStatus` to `Dependencies`. In the `observe` callback, call
  `this.deps.runStatus?.show(snapshot)` first. In the existing `.finally`, call
  `this.deps.runStatus?.clear()`. At the start of `close()`, call
  `this.deps.runStatus?.clear()`.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test src/console/controller.test.ts` Expected: PASS.

- [ ] **Step 5: Commit** —
      `feat(console): update the status bar from run snapshots`

### Task 4: Extension wiring

**Files:**

- Modify: `src/console/extension.ts`
- Modify: `test-support/fake-extension-api.ts`
- Test: `src/console/extension.test.ts`

**Interfaces:**

- Consumes: `createRunStatus`, `RUN_STATUS_KEY` (Task 2); controller `runStatus`
  dependency (Task 3).
- Produces: `fakeExtensionApi().statuses: Map<string, string | undefined>` and
  an optional `setStatus` failure switch for tests.

- [ ] **Step 1: Extend the fake and write the failing tests**

  In `fire`, pass `{ sessionManager, hasUI: true, ui: { setStatus } }`. The fake
  `setStatus` records into `statuses` and throws when the test sets
  `failStatus = true`.
  - `"the Issue run segment shows in the status bar and shutdown clears it"`:
    use a `startRun` that observes a `planning` snapshot (`issue: 9`,
    `title: "Polls"`, `phase: "planning"`, `session: 1`) and then waits for the
    shutdown (`human.awaitContinue`). Fire `session_start` with `firstIssue: 9`
    and no stray workers. Assert `statuses.get("patchmill")` contains `#9 Polls`
    and `01 planning`. Fire `session_shutdown`. Assert
    `statuses.get("patchmill") === undefined`.
  - `"a failing status bar does not block shutdown"`: same start, set
    `failStatus = true`, fire `session_shutdown`; assert it resolves.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test src/console/extension.test.ts` Expected: FAIL (no
  `patchmill` status).

- [ ] **Step 3: Implement**

  In `session_start`, when `ctx.hasUI`, create
  `createRunStatus({ setStatus: (k, t) => ctx.ui.setStatus(k, t), columns: () => process.stdout.columns || 80 })`
  and pass it to the controller. Declare `let runStatus: RunStatus | undefined`
  and `const onResize = () => runStatus?.refresh()` at factory scope, next to
  `controller`, so shutdown can remove the listener even without a
  `session_start`. Register it in `session_start` with
  `process.stdout.on("resize", onResize)`. In the shutdown function, in the
  `finally`, call `process.stdout.off("resize", onResize)` and
  `runStatus?.clear()`, next to `client?.dispose()`.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test src/console/*.test.ts` Expected: PASS, including the
  existing lifecycle tests.

- [ ] **Step 5: Full verification and commit**

  Run: `npm test` and `npm run lint`. Expected: both pass. Commit —
  `feat(console): show the Issue run in the Pi status bar`.

- [ ] **Step 6: Manual check**

  Start `patchmill run-once --interactive --issue <N>` in a terminal. Confirm
  the footer shows `#N <title>  ·  01 planning`. Narrow the terminal and confirm
  the title shortens with `…` while the state stays visible. Quit and confirm
  the console exits normally.
