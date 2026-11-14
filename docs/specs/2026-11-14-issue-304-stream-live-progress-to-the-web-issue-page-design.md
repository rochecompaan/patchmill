# Stream live progress to the web issue page

- Issue: [#304](https://github.com/rochecompaan/patchmill/issues/304)
- Parent: [#300](https://github.com/rochecompaan/patchmill/issues/300)
- Prerequisite: #303 closed. Inspected base:
  `d8ffd5d248ef680c5cdcee876043a10efde4a157`.
- Status: Proposed for the Interactive Issue run approval dialog.

## Intent

A maintainer can watch an active Issue run on its issue page. New progress
lines, agent messages, and tool calls appear without a reload. The elapsed time
counts up. When the run ends, the header shows the final step and the cost. The
page remains view only.

## Decisions from the maintainer

- **Stream what runs already write.** Every run writes its terminal progress to
  `history.jsonl` while it runs. Unattended runs also write their Pi session log
  while they run, because `pi -p --session-dir` appends each entry. These logs
  stream live.
- **Interactive transcripts are deferred to #305.** Interactive runs copy the
  planning transcript and the implementation worker transcript into the run
  directory only when each session ends. In this slice, their progress lines
  stream live. Their agent messages and tool calls appear when each session
  ends. #305 (Pi RPC mode in run-once) owns live interactive transcripts. This
  slice changes no kernel or console writer.

## Existing decisions and source evidence

The
[#303 specification](2026-11-14-issue-303-show-finished-issue-runs-on-the-web-issue-page-design.md)
and #302 decisions still apply: current run formats only, confined reads, text
only display, and no board change. #300 requires one read-only `RunDataSource`
with `snapshot` and `subscribe`, `EventSource` in the browser, `node:http` on
the server, and no new npm dependencies.

Current sources establish these facts:

- `src/web/run-data.ts` declares
  `subscribe(listener: (change: RunDataChange) => void)`. In
  `createFileRunDataSource()`, it reports only board-revision changes that a
  `snapshot()` call happens to find. Nothing watches files. Only tests call it.
  `createSampleRunDataSource()` returns a no-op.
- `readIssueDetail()` returns early for a live run with no thread and no cost.
  `web/issue.js` then shows “Run active. Live progress comes in a later update.”
  This slice removes that placeholder.
- `readIssueObservation()` sets `live` from `probeIssueLock()`. A held lock that
  is newer than the latest retained attempt means a new attempt that has not
  written progress yet. `file-run-observations.test.ts` covers this case. Thus
  issue ownership does not always identify an active attempt.
- `runOneIssue()` writes its last progress line and `result.json` before it
  releases the issue lock. Thus a released lock with a valid attempt result is a
  final state.
- `createRunHistory()` appends one JSON line for each progress line, session
  launch, and progress snapshot. Pi's `SessionManager._persist()` writes the
  file when the session has its first user or assistant message, then appends
  one JSON line for each entry.
- `runFiles().lines()` parses an unterminated last line and warns when it is not
  valid JSON. A live reader can see a line that a writer has not completed.
- Thread IDs are stable when files grow. Pi entries use
  `RUN_ID:SESSION:FILE:INDEX`, and progress lines use `RUN_ID:history:SEQUENCE`.
  A tool call changes in place when its result arrives. A projection can also
  insert an entry before older entries, because it sorts a session by time.
- The internal `snapshot()` function in `file-run-data.ts` reads observations,
  workflow roles, and Git document links for every open issue. A projection of
  one issue every second must not repeat that work for the whole board.
- `startServeServer().close()` calls `server.close()` and
  `closeIdleConnections()`. An open event stream is never idle, so close would
  wait forever.
- `web/controller.js` loads an issue once and polls only the board. `app.js`
  renders the full page with `replaceChildren()`. `createViewState()` keeps open
  `details` elements and the composer state across renders. `web/thread.js`
  already renders a running tool and “The agent is working…” for a working
  summary.

## Goals, exclusions, and constraints

### Goals

- Show new thread entries and header changes of an active run within a few
  seconds.
- Deliver updates in order. Give each update an ID. After a reconnect, send only
  the missed updates when the server still has them.
- Stop all file reads for an issue when its last subscriber disconnects.
- Count the elapsed time up each second while the run is active.
- At the end of the run, show the final status, step, end time, and cost without
  a reload.

### Non-goals

- Live interactive transcripts (#305).
- Chat, the **Waiting for reply** marker, and any control that changes a run.
- Board streaming. The board keeps its 15-second timer.
- A live subscription for an issue page that opens before a run starts. A reload
  shows the new run.
- Subagent transcripts, live cost, and a durable replay store.

### Global constraints

- Add no npm dependencies, browser framework, or browser build step.
- Preserve authentication, Host and Origin checks, CSP, and static-file
  confinement for the stream route.
- The web server never starts runs, writes run files, or mutates host data.
- Read detailed logs only for a requested eligible issue.
- Treat all run text as text. Do not expose detailed text in board JSON.
- Keep sample mode functional.

## Approaches

| Approach                                                 | Benefit                                                    | Cost                                                               | Decision |
| -------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| Poll a cheap file fingerprint and project on change      | Finds lock release and process death. Deterministic tests. | Up to one second of delay                                          | Selected |
| `fs.watch` on the issue directory                        | Lower delay                                                | Recursive watch varies by platform. A dead process sends no event. | Rejected |
| Mirror interactive transcripts while they run (option B) | Interactive runs stream fully                              | Changes console writers that #305 replaces                         | Deferred |

## Domain and architecture

The architecture changes. `RunDataSource.subscribe` gets a new contract, and a
new module owns live updates. Domain modeling and codebase design apply. This is
a single-context change in the web read model. There are no ADRs or context maps
in this checkout.

**Term:** an **Issue update** is one ordered change to an issue page's header or
Issue thread that the server sends to a live subscriber. It is not a Ledger
event. It is not durable, and its ID orders updates only inside one server
process. `GLOSSARY.md` records this term.

### The `RunDataSource` interface

```typescript
export interface RunDataSource {
  snapshot(selection?: { issue: number }): Promise<RunDataSnapshot>;
  subscribe(
    selection: { issue: number; lastEventId: string | null },
    listener: (update: IssueUpdate) => void,
  ): () => void;
}
```

`RunDataChange` and the board-revision listener go away. Only tests use them.
The route calls `snapshot({ issue })` first and returns 404 for an unknown or
ineligible issue. Thus `subscribe` is only for issues that exist.

`api-types.ts` defines the wire types, so the page can import them:

```typescript
export type IssueHeader = Omit<IssueDetail, "thread">;
export type IssueUpdate = { readonly id: string } & (
  | { readonly kind: "reset"; readonly issue: IssueResponse }
  | {
      readonly kind: "header";
      readonly header: IssueHeader;
      readonly syncedAt: string | null;
    }
  | {
      readonly kind: "thread";
      readonly after: string | null;
      readonly entries: readonly ThreadEvent[];
    }
  | { readonly kind: "unavailable" }
);
```

- `reset` replaces the whole issue response.
- `header` replaces every detail field except the thread.
- `thread` keeps the entries up to and including the entry with ID `after`. It
  replaces all later entries with `entries`. `after: null` replaces the whole
  thread. A new entry at the end sends only that entry. A tool result sends the
  tool entry and the entries after it.
- `unavailable` means the issue left the eligible set. The page stops its
  subscription and keeps its content.

`IssueDetail.run` gets `activeSince: string | null`. It is the start time of the
active attempt and is null when no attempt is active.

The **active attempt** is the latest retained attempt when three conditions are
true: the issue lock is held, the attempt has no finish time, and the attempt
started at or after the lock's `startedAt`. `readIssueObservation()` exposes it
as `RunObservation.activeRunId: string | null`. When the lock is held without an
active attempt, the run outcome is `active`, `activeSince` is null, and all
retained attempts keep their ended projection. The next projection finds the new
attempt when it writes its progress.

While a run is active, `summary.elapsedSeconds` is the known duration of the
earlier ended attempts: zero when there are none, and null when one is unknown.
The page shows that total plus the time since `activeSince`. After the run ends,
the existing #303 rules apply.

### The live feed module

`src/web/issue-feed.ts` owns live updates. It is a deep module: callers supply
two functions and a clock, and receive ordered updates.

```typescript
export function createIssueFeed(input: {
  fingerprint(issue: number): Promise<string>;
  project(issue: number): Promise<IssueResponse | null>;
  clock: {
    now(): number;
    every(ms: number, fn: () => void): () => void;
    after(ms: number, fn: () => void): () => void;
  };
  epoch(): string;
  warn(message: string): void;
}): Pick<RunDataSource, "subscribe">;
```

The module hides these rules:

- **One hub for each issue.** All subscribers of an issue share one poll, one
  projection, and one update log.
- **Polling.** While a hub has a subscriber, it calls `fingerprint()` every
  1,000 ms. It calls `project()` when the fingerprint changes, and at least
  every 60,000 ms so that a host-cache refresh can change the header. Only one
  fingerprint or projection runs at a time. A tick during that work is skipped.
- **Diff.** The hub compares the new projection with its last state. A header
  that differs by JSON value produces one `header` update. A thread that differs
  produces one `thread` update after the longest common prefix of entries with
  the same JSON value. A `thread` update comes before a `header` update from the
  same projection. Thus the page has the final entries when a header reports the
  end of the run. An unchanged projection produces no update. A `null`
  projection produces `unavailable` once.
- **IDs.** An ID is `EPOCH-SEQUENCE`. `EPOCH` is eight random lowercase
  hexadecimal characters for each hub instance. `SEQUENCE` is a decimal integer
  that increases by one for each update.
- **Start of a subscription.** The hub sends the updates after `lastEventId`
  when the ID has the hub's epoch and the log still holds the next update. In
  all other cases, it sends one `reset` with the current state and the latest
  ID. This includes a missing, invalid, or unknown ID, another epoch, or an ID
  older than the log. When the hub has no state yet, it projects first. The
  subscriber receives these updates before any newer update.
- **Log.** The log keeps the last 1,000 updates. A subscriber that is further
  behind receives a `reset`.
- **Stop.** When the last subscriber of a hub disconnects, the hub stops its
  poll at once and starts no more reads. It keeps its state and log for 300,000
  ms, so that a fast reconnect can still replay. A new subscriber in that period
  restarts the poll with one immediate projection, then sends its missed
  updates. After that period, the hub is discarded.
- **Errors.** A failed fingerprint or projection emits a short warning and keeps
  the last state. A listener that throws does not stop other listeners.

`epoch` and `clock` are injected. The production adapter uses
`crypto.randomBytes` and Node timers. Tests use a manual clock. These two real
adapters justify the seam. The fingerprint and projection functions are real
variation too: the file adapter supplies file reads, and tests supply fakes that
the test changes between ticks.

### The file adapter

`createFileRunDataSource()` creates one feed and connects it to two functions
that it owns:

- **`projectIssue(number)`** is a refactor of the body of the current
  `snapshot()` loop for one issue. It reads the host cache (60-second period),
  the workflow roles, the observation, PR association, document links,
  `projectBoardIssue()`, and `readIssueDetail()`. `snapshot()` keeps its board
  loop and uses the same function for the selected issue. Thus a live projection
  does not read other issues.
- **`issueFingerprint(number)`** in `src/web/run-fingerprint.ts` reads only
  metadata in the issue's run directory. It records the lock probe result, and
  the size and modification time of `progress.json`. For each attempt directory
  it records `result.json`, `history.jsonl`, and the immediate `.jsonl` files in
  each numeric session directory. It uses the confined `runFiles` listing and
  rejects symlinks like the detail reader. It never opens a log.

`readIssueDetail()` projects the active attempt instead of returning early:

- Pass `active: true` only for the attempt with ID `activeRunId`.
- An unmatched tool call in the active attempt has state `running` and a null
  result. Ended attempts keep `stopped` and “Output not recorded.”
- The active attempt has no “Agent transcript not recorded” notice and no “Run
  needs attention” block. These describe ended attempts only.
- In the active attempt, `runFiles().lines()` skips an unterminated last line
  without a warning. The next projection reads it after the writer completes the
  line. Use a `{ complete: true }` option. Ended attempts keep the #303
  behavior.
- When the active attempt is interactive (`progress.interactive`), and its
  latest session has no transcript entries, add one `progress` entry at the end
  with ID `RUN_ID:interactive-pending`: “Agent messages appear when this
  interactive session ends.”
- `finalUsage` stays null while the run is active. `run.outcome` stays `active`.

The fingerprint can change many times each second during an active run. The
projection runs at most once each second and rereads the issue's logs. Long runs
can have large logs. The browser check records the projection time. Add caching
only when that time exceeds the poll interval. Coalescing keeps the cost bounded
in that case.

The sample adapter implements `subscribe` with one `reset` of its fixed issue,
or `unavailable` for an unknown issue. The sample page never subscribes, because
its details have no active run.

## HTTP stream

`GET /api/issues/:number/events` streams Issue updates as Server-Sent Events.
`src/web/event-stream.ts` owns the route. `request.ts` calls it before
`apiResponse()`. The route passes through the existing Host, token, and cookie
checks.

1. Validate the number like the issue route: 400 for an invalid number.
2. Accept `GET` only for the stream. Send 405 with `Allow: GET` for `HEAD`.
3. Call `snapshot({ issue })`. Send the existing JSON 404 when the issue is
   absent.
4. Send status 200 with `Content-Type: text/event-stream; charset=utf-8`, the
   existing security headers, and no `Content-Length`. Write `retry: 3000`.
5. Read one `Last-Event-ID` header. Pass it only when it matches
   `^[0-9a-f]{8}-[0-9]{1,15}$`. Otherwise pass null.
6. Write each update as `id: ID`, `event: KIND`, and one `data:` line with the
   JSON update, then a blank line. JSON escapes line breaks, so data is one
   line.
7. Write the comment `: keep-alive` every 15,000 ms.
8. When the request or response closes, unsubscribe and stop the keep-alive
   timer. When the response buffers more than 8 MiB, end the stream. The browser
   reconnects with its last ID.

`startServeServer()` keeps a registry of open streams. `close()` ends each
stream before it waits for the server to close. A stream that opens during
shutdown ends at once.

## Page behavior

- After the page loads an issue with `source: "live"` and
  `run.outcome === "active"`, the controller opens one `EventSource` for
  `/api/issues/N/events`. The browser sends the cookie and `Last-Event-ID`.
- A pure module `web/live-issue.js` applies updates:
  `applyIssueUpdate(response, update)` returns the next `IssueResponse`, and
  `liveElapsedSeconds(detail, nowMs)` returns the elapsed seconds. An update for
  an `after` ID that the page does not have replaces the whole thread. The next
  projection is still correct.
- The controller closes the stream when the run outcome is no longer `active`,
  on `unavailable`, on navigation, and on page hide. After a header that ends
  the run, the controller fetches the issue once through the normal path. This
  final response is the settled page, even if a thread update was lost. A stream
  error that closes the `EventSource` makes the controller reload the issue once
  through the normal path. Thus a 401 or 404 shows the existing states.
- `PageState` gets `connection: "connecting" | "live" | "reconnecting" | null`.
  The header shows “Live” with the existing live dot, or “Reconnecting…”.
- The elapsed meta item has the attribute `data-live-elapsed`. `app.js` updates
  only its text each second from `liveElapsedSeconds()`. It does not render the
  page again.
- Each update renders the page through the existing `render()`. Open tools and
  the composer keep their state. A render for the same issue keeps the window's
  scroll position: `createViewState().restore()` does not scroll the workflow
  rail into view for it. When the window was within 120 pixels of the bottom
  before the render, the page scrolls to the bottom after it, without smooth
  scrolling.
- The thread has no live region, so a screen reader does not read every tool
  call. One visually hidden polite status reads “Run finished” or “Run stopped”
  when the run ends.
- The active page shows its thread and the existing running tool state. It shows
  the existing “The agent is working…” row when the summary status is `working`.
  The composer keeps its #303 behavior: the terminal note for an unattended run,
  and the disabled “View only. Messages come with live chat.” box for an
  interactive run.

## Page design

Frontend design applies, because the active issue page changes visibly: a live
thread, a counting elapsed time, a connection state, and the end transition. The
approved #301–#303 visual system takes priority over generic guidance. There is
no new visual language. The dark palette stays night `#08090b`, panel `#121418`,
brass `#c4a882`, green `#39c96b`, and red `#ff4c4c`, with the existing light
theme.

```text
Board > #N Host issue title
workflow rail
● Run active | Live | step Implementation | elapsed 4m 12s ↑ | PR links
started 14 Nov 2026, 12:00 UTC

  Run attempt 1
  01 implementation
  > Patchmill prompt                           [collapsed]
  agent   I will add the feed module first.
  > read(path="src/web/run-data.ts")           [completed]
  > bash(command="npm test")          running
  ✳ The agent is working…

View only. This run was started in a terminal with patchmill run-once --issue N.
```

At the end, the status becomes “Finished” or “Stopped”, “Live” disappears, the
elapsed time stops, and the cost appears. The live dot pulse respects
`prefers-reduced-motion`. New entries do not animate. At 390px, the meta items
wrap as they do today.

## Verification

Apply the Testing Value Gate. Tests cover observable behavior through the feed
interface, the file adapter, the HTTP route, and the page modules. Do not test
document text or mockup structure.

- **Feed:** with a manual clock and fake functions, check ordered thread and
  header updates, no update for an unchanged projection, replay after
  `lastEventId`, `reset` for another epoch or an overflowed log, one projection
  at a time, isolated listener errors, `unavailable`, and the stop of all
  fingerprint calls after the last unsubscribe.
- **File adapter:** append history lines and Pi entries to an active fixture
  attempt with a held lock. Check that a subscriber receives the new entries in
  order. Check that a partial last line appears only after it is complete, a
  tool changes from `running` to `completed`, and a lock release sends the final
  thread and then a final header with an outcome and cost. Check that a held
  lock newer than the retained attempts keeps those attempts ended. Check that
  no file reads occur after the last unsubscribe.
- **HTTP:** check authentication, 400, 404, 405, the event-stream headers, a
  reconnect with `Last-Event-ID` that receives only the missed entries, the
  unsubscribe on client disconnect, and a server close with an open stream.
- **Page:** check `applyIssueUpdate()`, `liveElapsedSeconds()`, and the
  controller's open, close, final fetch, and reload behavior with a fake
  `EventSource`. The browser check proves that a reader away from the bottom
  stays in place, and that an open tool stays open, when an update arrives.
- **Browser check:** create a test repository with `patchmill setup-test-repo`.
  Start an unattended `patchmill run-once --issue N` and `patchmill serve`. Open
  the issue page in an authenticated browser. Record that new tool calls and
  progress lines appear within a few seconds, that the elapsed time counts, and
  that the end shows the final step and cost. Record the projection time.
  Capture desktop and 390px screenshots of the active and ended states in both
  themes with the visual-evidence and frontend-review skills.
- Run `npm test`, `npm run check:types`, and `npm run lint`. If npm dependencies
  change, run the Nix build.

## Companion artifacts

- `docs/mockups/2026-11-14-issue-304-live-progress.html`:
  [Full-page live issue mockup](../mockups/2026-11-14-issue-304-live-progress.html)
- `GLOSSARY.md`: [Issue update definition](../../GLOSSARY.md). No ADR is
  necessary. The feed keeps no durable state and is simple to replace when the
  live-chat connection design arrives.
