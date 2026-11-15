# Show the current issue and run state in the Pi status bar

- **Issue:** #367
- **Status:** Proposed for the Interactive Issue run approval dialog.
- **Scope:** One Patchmill segment in the Pi footer of the Patchmill console.

## Intent

During an Interactive Issue run, the console output prints the issue line
(`issue #N · title`) and each phase start (`01 planning`). These lines scroll
away. The operator then cannot see which issue runs or what the run does. A
status-bar segment keeps this information visible at all times.

## Evidence and constraints

- `src/kernel/run-snapshot.ts` defines `RunSnapshot` and `RunState`. The
  snapshot has `issue`, `state`, `phase`, and `session`. It has no issue title.
- `src/kernel/run-once.ts` fetches the issue (`workflow.issue`) and prints
  `formatRunStart(issue)` before the first snapshot emission. It refetches the
  issue at the start of each loop pass, after `snapshot.deriving()`.
- `formatPhaseStart(phase, step)` in `src/kernel/console.ts` produces
  `01 planning`. The kernel calls it with the session number, which is also
  `RunSnapshot.session`.
- `ConsoleController` in `src/console/controller.ts` receives every snapshot
  through the `observe` callback of `StartRun`. Its `active` promise settles
  when the Issue run ends. `shutdown()` closes the controller.
- `createPatchmillExtension` in `src/console/extension.ts` creates the
  controller on `session_start` and calls `shutdown` on `session_shutdown`. A
  `/patchmill-issue` switch shuts down the old extension instance and starts a
  new one.
- Pi's `ctx.ui.setStatus(key, text)` sets one footer status. The built-in footer
  (`pi-coding-agent` `FooterComponent`) does three things to statuses:
  - It sorts them by key and joins them with one space on one line.
  - It replaces tabs and newlines with spaces, collapses runs of ASCII spaces,
    and trims each text.
  - It cuts the joined line at the terminal width from the right with `...`.
- `pi-subagents` also sets footer statuses (`subagent-slash`,
  `subagent-slash-text`). The key `patchmill` sorts before them, so the
  Patchmill segment starts the status line.
- `snapshot.ended()` emits immediately before `runOneIssue` returns.

## Goals and exclusions

Goals:

- While an Issue run is active, the footer shows `#N <title>  ·  <state>`.
- The segment follows every state and phase change in the run snapshots.
- A narrow terminal shortens the title first, so the state stays visible.
- The segment is cleared when the run ends and when the console shuts down.

Exclusions:

- No per-task progress such as `task 3/7`. The kernel does not know the current
  plan task.
- No new tool, prompt change, custom footer, or widget. The existing
  `patchmill_run_status` tool prints `controller.status()`, so its snapshot
  output gains the `title` field. This is intended.
- No change to `progress.json`, run history, or the web views.
- Non-interactive `run-once` does not change. It has no Pi footer.

Anti-goals: the segment must never stop, delay, or fail an Issue run. It is a
display aid only.

## Approaches

The open choice was the source of the issue title.

| Approach                                          | Benefit                                                                          | Cost                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Add an optional `title` to `RunSnapshot` (chosen) | One source of run state. The kernel already has the issue before the first emit. | A small kernel change to the snapshot type and `run-once.ts`.            |
| The console fetches the title from the host       | No kernel change.                                                                | A second host dependency and a second fetch in the console for one fact. |

The maintainer chose the snapshot title.

For rendering, `ctx.ui.setStatus` is the only approach that puts text in Pi's
status bar without replacing the whole footer. A custom footer (`setFooter`)
would have to copy Pi's built-in footer. A widget is not in the status bar.

## Design

### Snapshot title (kernel)

- `RunSnapshot` gets `title?: string`.
- The object that `runSnapshot()` returns gets `title(title: string): void`. It
  stores the title in the current snapshot. It does not emit, persist, or call
  the observer. The next emission carries the title.
- `runOneIssue` calls `snapshot.title(issue.title)` after each
  `workflow.issue(issueNumber)` fetch in the claim step and in the loop. Thus
  every emitted snapshot has the title, and an edited title shows on the next
  emission.
- `projectRunProgress` lists its fields explicitly. `progress.json` thus does
  not get the title. This is intentional: the web views get titles from the
  host.

### Segment text (console)

A new module `src/console/run-status.ts` owns the segment text and its footer
key. Its pure function `formatRunStatus(snapshot, width)` returns the text.

State labels:

| `RunState`       | Label                                                |
| ---------------- | ---------------------------------------------------- |
| `deriving`       | `preparing`                                          |
| `planning`       | `formatPhaseStart(snapshot.phase, snapshot.session)` |
| `implementation` | `formatPhaseStart(snapshot.phase, snapshot.session)` |
| `gate-wait`      | `awaiting approval`                                  |
| `review-wait`    | `awaiting review`                                    |
| `blocked`        | `blocked`                                            |
| `ended`          | `ended`                                              |

When `planning` or `implementation` arrives without a `phase`, use the state
name as the phase. The kernel always sets both, so this is a guard only.

Text rules:

- The segment is `#<issue> <title><separator><label>`.
- The separator is a space, a no-break space (U+00A0), `·`, a no-break space,
  and a space. In code it is `" \u00a0·\u00a0 "`. It shows as two spaces, `·`,
  and two spaces: 5 columns. Pi collapses only runs of ASCII spaces, so the
  separator keeps its width.
- The title is cleaned with `cleanValue` from `src/kernel/terminal-layout.ts`,
  the same filter that `formatRunStart` uses. It removes terminal escape
  sequences and replaces C0 and C1 control characters. Then whitespace runs
  become one space, and the result is trimmed. Issue titles are untrusted host
  text, so the footer must not pass control codes to the terminal.
- With no title, or an empty cleaned title, the segment is
  `#<issue><separator><label>`.
- Width is measured with `visibleWidth` from `@earendil-works/pi-tui`, so wide
  characters count correctly.
- When the full segment fits in `width`, use it.
- Otherwise the title budget is `width` minus the width of `#<issue>` plus one
  space and of `<separator><label>`. With a budget of 2 or more, cut the title
  at grapheme boundaries to at most `budget - 1` columns, trim trailing spaces,
  and add `…`. With a smaller budget, drop the title. Pi's footer then cuts
  anything that still does not fit.
- Known limitation: when another extension status is also set (for example
  `subagent-slash` during an operator slash command) and the segment fills the
  width, Pi's footer cuts the joined line. The last columns of the state can
  then show as `...`. The budget does not reserve room for other statuses,
  because those statuses are rare and short-lived.
- The text contains no ANSI escape sequences. (`truncateToWidth` adds reset
  codes, so the module does its own grapheme cut.)

### Status line owner (console)

`run-status.ts` also exports `createRunStatus(ui)`. Its input is
`{ setStatus(key, text | undefined): void; columns(): number }`. It returns:

- `show(snapshot)`: remember the snapshot and set the `patchmill` status to
  `formatRunStatus(snapshot, columns())`.
- `refresh()`: render the remembered snapshot again at the current width. It
  does nothing when no snapshot is remembered.
- `clear()`: forget the snapshot and set the `patchmill` status to `undefined`.

All three methods catch and ignore errors from `setStatus` and `columns`. A
stale Pi context after a session switch must not break the run or the shutdown.

### Wiring

- `ConsoleController` dependencies get an optional
  `runStatus?: Pick<RunStatus, "show" | "clear">`.
- The controller's `observe` callback calls `runStatus.show(snapshot)` for every
  snapshot, before its existing `reportNext` logic.
- The controller calls `runStatus.clear()` when the `active` promise settles
  (resolve or reject), in the existing `finally`. It also calls `clear()` at the
  start of `close()`.
- `createPatchmillExtension` creates the run status on `session_start` when
  `ctx.hasUI` is true. The adapter uses `ctx.ui.setStatus` and
  `process.stdout.columns`, with 80 when the value is missing.
- The extension subscribes to the `resize` event of `process.stdout` and calls
  `refresh()`. The listener is a constant defined when the extension factory
  runs, so removing it is safe even when `session_start` never ran. The
  extension removes the listener and calls `clear()` in its `session_shutdown`
  handler, also when the controller shutdown fails.

The `ended` snapshot thus shows only briefly. The segment is then cleared
because no Issue run is active. This matches the issue rules.

### Module design notes

The `run-status.ts` module is deep for its size. Callers know three methods and
one footer key. The module hides the label table, the separator trick, title
cleaning, width budgeting, grapheme cutting, and error isolation. The UI seam
has a real production adapter (`ctx.ui` plus `process.stdout`) and a test
adapter that records statuses. The controller depends on `show` and `clear`
only, so controller tests use a small recording fake.

Domain modeling does not apply. The change adds no domain term and no
architectural decision. It uses the existing terms Issue run and Interactive
Issue run from `GLOSSARY.md`.

Frontend design does not apply. The change is one line of plain terminal text in
Pi's footer. It has no browser layout, so the spec has no HTML mockup.

## Testing

- Formatter tests: each `RunState` label, the separator, title cleaning, no
  title, exact-fit width, title shortening with `…`, wide characters, and the
  drop-title case.
- Run status tests: show, refresh at a new width, clear, and ignored `setStatus`
  errors.
- Controller tests: snapshots reach `show`, and `clear` runs when the run
  settles and on shutdown.
- Extension test: `session_shutdown` clears the `patchmill` status.
- Kernel test: emitted snapshots in a run-once fixture carry the issue title.

## What is left to the builder

- Exact test names and fixture shapes.
- The internal structure of the grapheme cut, within the rules above.
