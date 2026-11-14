# Live Issue run progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill for inline, task-by-task execution. Steps use checkbox (`- [ ]`) syntax
> for tracking. This kernel run does not authorize per-task implementation
> delegation.

**Goal:** Stream an active Issue run's thread and header to its issue page with
ordered, replayable Server-Sent Events.

**Architecture:** Replace the unused board-revision `subscribe` with an
issue-selected subscription. A deep feed module owns polling, diffing, update
IDs, replay, and cleanup. The file adapter supplies a cheap fingerprint and a
one-issue projection. A thin route writes updates as SSE, and a pure browser
module applies them.

**Tech Stack:** Node.js TypeScript with `node:http` and `node:test`, plain
browser JavaScript with JSDoc, existing CSS, and Chromium for the browser check.
No new dependencies.

**Spec:**
[Live progress design](../specs/2026-11-14-issue-304-stream-live-progress-to-the-web-issue-page-design.md)

**Mockup input:**
[Full-page live issue mockup](../mockups/2026-11-14-issue-304-live-progress.html)

**Other inputs:** `AGENTS.md`, `GLOSSARY.md` (Issue update), the #303
specification, and `docs/mockups/web/run-once-workflow.md`.

**Inspected base:** `d8ffd5d248ef680c5cdcee876043a10efde4a157`.

## Global Constraints

- Add no npm dependencies, browser framework, or browser build step.
- Preserve authentication, Host and Origin checks, CSP, and static-file
  confinement. The stream route uses the same checks as other routes.
- The web server never starts runs, writes run files, or mutates host data.
- Read detailed logs only for a requested eligible issue. Board JSON keeps no
  detailed text.
- Treat all run text as text.
- Poll every 1,000 ms. Force a projection every 60,000 ms. Keep 1,000 updates in
  a log. Keep an idle hub for 300,000 ms. Write `: keep-alive` every 15,000 ms.
  End a stream that buffers more than 8 MiB. Send `retry: 3000`.
- Update IDs match `^[0-9a-f]{8}-[0-9]{1,15}$`.
- Do not change kernel or console writers. Live interactive transcripts belong
  to #305.
- Keep the board's 15,000 ms timer and sample mode.

## Review Focus

- A writer appends half a line when the poll reads: show nothing for that line
  and no warning, then show it complete. Task 2 tests this.
- The last tab closes and reopens within seconds: replay only the missed
  updates, and do no reads while no tab is open. Tasks 1 and 3 test this.
- The server restarts while a page is open: the old `Last-Event-ID` has another
  epoch, so the page gets one `reset`, not a broken thread. Task 1 tests this.
- `patchmill serve` stops while a stream is open: shutdown completes. Task 3
  tests this.
- A new attempt holds the lock before it writes progress: older attempts stay
  ended, and the page does not use their start time. Task 2 tests this.

## File structure and ownership

- `src/web/api-types.ts`: `IssueHeader`, `IssueUpdate`, and
  `IssueDetail.run.activeSince`.
- `src/web/run-data.ts`: the new `subscribe` contract. Remove `RunDataChange`.
- `src/web/issue-feed.ts`: hubs, polling, diff, IDs, log, replay, retention.
- `src/web/run-fingerprint.ts`: metadata-only fingerprint of one issue's run
  directory.
- `src/web/run-files.ts`: the `{ complete: true }` option for `lines()`.
- `src/web/file-issue-detail.ts`, `issue-history.ts`, `pi-thread.ts`: project
  the active attempt.
- `src/web/file-run-data.ts`: extract `projectIssue()` and connect the feed.
- `src/web/sample-data.ts`: `subscribe` with one `reset` or `unavailable`.
- `src/web/event-stream.ts`: the SSE route. `request.ts` and `server.ts` connect
  it and its stream registry.
- `web/live-issue.js`: pure update and elapsed functions.
- `web/controller.js`, `web/app.js`, `web/issue.js`, `web/styles/issue.css`: the
  subscription, connection state, elapsed ticker, scroll follow, and end
  announcement.
- `scripts/check-issue-thread-layout.mjs`: extend with the live state.
- `docs/reviews/2026-11-14-issue-304-live-progress-verification.md`: the browser
  check record.

`file-run-data.ts` and `run-once.ts` are already large. Keep new logic in the
new modules. Add no generic helpers or barrels.

## Task 1: Feed module and contract

**Files:**

- Modify: `src/web/api-types.ts`, `src/web/run-data.ts`
- Create: `src/web/issue-feed.ts`, `src/web/issue-feed.test.ts`

**Interfaces:**

- Produces: `type IssueHeader = Omit<IssueDetail, "thread">`; `type IssueUpdate`
  as in the spec; `IssueDetail.run.activeSince: string | null`;
  `RunDataSource.subscribe(selection: { issue: number; lastEventId: string | null }, listener: (update: IssueUpdate) => void): () => void`;
  `createIssueFeed(input: { fingerprint(issue: number): Promise<string>; project(issue: number): Promise<IssueResponse | null>; clock: { now(): number; every(ms: number, fn: () => void): () => void; after(ms: number, fn: () => void): () => void }; epoch(): string; warn(message: string): void }): Pick<RunDataSource, "subscribe">`.

- [ ] **Step 1: Write failing tests** in `issue-feed.test.ts` with a manual
      clock (an array of pending timers that the test advances), a mutable fake
      projection, and a fingerprint counter. Use an `epoch` function that
      returns `"0000000a"`, then `"0000000b"`, and so on.
  - `first subscriber receives a reset with the current projection`: the first
    update has `kind: "reset"`, `id: "0000000a-1"`, and the projected issue.
  - `appended entries arrive in order as one thread update`: append entries `c`
    and `d` after `a`, `b`, change the fingerprint, and advance 1,000 ms. Expect
    `{ kind: "thread", after: "b", entries: [c, d] }`.
  - `a changed earlier entry resends it and later entries`: change entry `b`'s
    tool state. Expect `{ after: "a", entries: [b', c, d] }`.
  - `thread change precedes header change from the same projection`.
  - `unchanged fingerprint does not project; unchanged projection sends nothing`.
  - `projection is forced after 60,000 ms with an unchanged fingerprint`.
  - `replay sends only updates after lastEventId`: subscriber A sees IDs 1–4.
    Subscriber B subscribes with `"0000000a-2"` and receives exactly IDs 3 and
    4, in order, with no `reset`.
  - `foreign epoch, malformed ID, and overflowed log produce reset`: produce
    1,001 updates and subscribe with ID 1.
  - `last unsubscribe stops polling`: after the unsubscribe, advance 10,000 ms.
    The fingerprint count does not change, and no timer from `every` remains.
    Repeat with an unsubscribe while a fingerprint promise is pending: when it
    resolves, no projection starts.
  - `idle hub replays within retention and resets after it`: unsubscribe, change
    the projection, and subscribe with the last ID after 1,000 ms. Expect one
    immediate projection and only the new update. Repeat after 300,001 ms and
    expect a `reset` with an ID that starts with `0000000b-`.
  - `one projection at a time`: hold a projection promise open across three
    ticks. Expect one `project` call.
  - `null projection sends unavailable once`.
  - `throwing listener does not stop others; failed projection warns and keeps state`.

- [ ] **Step 2: Run** `node --test src/web/issue-feed.test.ts`. Expected: FAIL,
      because the module does not exist.

- [ ] **Step 3: Implement** the types and `createIssueFeed()`. Compare header
      and entries with `JSON.stringify`. The thread update's `after` is the ID
      of the last entry in the longest common prefix, or null. Send a `header`
      update only when the header differs. Do not compare `syncedAt` for change
      detection, but include the latest value in each header and reset. Remove
      `RunDataChange` and update the compile errors in `file-run-data.ts`,
      `sample-data.ts`, and the tests that construct a source. Delete the
      `changes` assertions in `file-run-data.test.ts` and
      `file-issue-selection.test.ts`. Task 2 replaces their coverage.

- [ ] **Step 4: Run** `node --test src/web/issue-feed.test.ts` and
      `npm run check:types`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): add ordered issue update feed`.

## Task 2: Live file projection and file-backed subscription

**Files:**

- Create: `src/web/run-fingerprint.ts`, `src/web/file-live-feed.test.ts`
- Modify: `src/web/run-files.ts`, `src/web/pi-thread.ts`,
  `src/web/file-run-observations.ts`, `src/web/file-run-observations.test.ts`,
  `src/web/issue-history.ts`, `src/web/file-issue-detail.ts`,
  `src/web/file-run-data.ts`, `src/web/sample-data.ts`,
  `test-support/issue-thread-fixture.ts`, `src/web/file-issue-detail.test.ts`

**Interfaces:**

- Consumes: `createIssueFeed()` from Task 1.
- Produces:
  `issueFingerprint(input: { repoRoot: string; config: PatchmillConfig; issue: number; warn(message: string): void }): Promise<string>`;
  `RunFiles.lines(path: string, options?: { complete?: boolean })`;
  `projectPiThread` input `active?: boolean`; `readAttemptThread` input
  `active?: boolean`; `createFileRunDataSource` input `clock?` and `epoch?` with
  Node defaults.

- [ ] **Step 1: Write failing tests** in `file-live-feed.test.ts`. Use the
      existing fixture builders with a held issue lock, a manual clock, and real
      temporary files.
  - `active attempt streams appended progress and Pi entries in order`:
    subscribe, receive `reset` with `run.outcome: "active"` and a non-null
    `activeSince`. Append a history `progress` line, then an assistant
    `toolCall` entry. Advance 1,000 ms after each. Expect two `thread` updates
    in that order. The tool entry has `state: "running"` and `result: null`.
  - `tool result changes the tool in place`: append the matching `toolResult`.
    Expect a `thread` update whose first entry is the tool with
    `state: "completed"`.
  - `partial last line waits without a warning`: append half of a JSON line.
    Expect no thread update and no warning. Complete the line and expect the
    entry.
  - `active attempt has no ended-attempt notices`: the reset thread has no
    “Agent transcript not recorded” entry and no `error` entry.
  - `interactive active attempt shows the pending-transcript notice`: with
    `progress.interactive: true` and no session transcript, expect the entry
    with ID `RUN_ID:interactive-pending`.
  - `lock release sends final thread, then final header`: append a final
    progress line, write `result.json`, release the lock, and advance once.
    Expect a `thread` update with the progress line, then a `header` update with
    `run.outcome` `completed`, `activeSince: null`, a non-null `finalUsage`, and
    the final `summary.step`.
  - `no reads after last unsubscribe`: after the unsubscribe, the manual clock
    has no active `every` timer. Append files and advance 10,000 ms. The
    listener receives nothing.
  - `ineligible issue sends unavailable`: remove the issue from the fake host
    and advance 60,000 ms.
  - Extend `file-issue-detail.test.ts`: an ended attempt with a truncated tail
    still warns, and `active` is false by default.
  - Sample source: `subscribe({ issue: 298, lastEventId: null })` sends one
    `reset`, and issue 999999 sends `unavailable`.
  - `held lock without a new attempt keeps attempts ended`: one ended attempt,
    and a held lock with a later `startedAt`. Expect `run.outcome: "active"`,
    `activeSince: null`, and the ended attempt's tools still `stopped`. Then
    write the new attempt's `progress.json` and advance: expect a non-null
    `activeSince` that equals the new attempt's start.
  - Extend `file-run-observations.test.ts`: `activeRunId` is the latest
    unfinished attempt when the lock is held and the attempt started at or after
    the lock, and null in the newer-lock and no-lock cases.

- [ ] **Step 2: Run** `node --test src/web/file-live-feed.test.ts`. Expected:
      FAIL.

- [ ] **Step 3: Implement.**
  - `lines(path, { complete: true })` drops a final segment without a newline
    and does not warn.
  - `projectPiThread({ active })`: an unmatched tool call gets `running` and a
    null result.
  - `readAttemptThread({ active })`: use `complete: true` for history and
    session files. Skip the missing-transcript notice and the error block. Add
    the interactive notice when `record.progress?.interactive` is true and the
    latest session has no projected transcript entry.
  - `readIssueObservation()`: add `activeRunId: string | null` to
    `RunObservation` with the rule in the spec. It already reads the lock
    record.
  - `readIssueDetail()`: remove the live early return. Project every attempt,
    with `active: true` only for the attempt with ID `observation.activeRunId`.
    Set `run.activeSince` to that attempt's `startedAt`, otherwise null. While
    live, set `summary.elapsedSeconds` to the sum of the earlier ended attempts,
    0 when none, and null when one has no `finishedAt`. Keep `finalUsage: null`
    while live.
  - `issueFingerprint()`: build a string from the lock probe and the
    `size:mtimeMs` of the files the spec names. Use `runFiles` listings. Skip
    entries that are not regular files or directories.
  - `file-run-data.ts`: extract
    `projectIssue(issue: Issue, host: HostBoardData, documents: DocumentLinkReader, withDetail: boolean)`
    from the loop. `snapshot()` uses it. The feed's `project(number)` reads the
    host cache, finds the open issue, and returns an `IssueResponse` or null.
    Compute its `revision` like the selected snapshot.

- [ ] **Step 4: Run** `node --test src/web/*.test.ts`. Expected: PASS, including
      the existing #302 and #303 tests.

- [ ] **Step 5: Commit** `feat(web): project and watch active Issue runs`.

## Task 3: Server-Sent Events route

**Files:**

- Create: `src/web/event-stream.ts`, `src/web/server-events.test.ts`
- Modify: `src/web/request.ts`, `src/web/server.ts`,
  `test-support/web-fixture.ts`

**Interfaces:**

- Consumes: `RunDataSource.subscribe`, `IssueUpdate`.
- Produces: `issueEventsPath(path: string): string | null` (the raw number
  segment);
  `serveIssueEvents(input: { req: IncomingMessage; res: ServerResponse; method: string; rawNumber: string; source: RunDataSource; streams: Set<ServerResponse>; closing(): boolean; keepAliveMs: number }): Promise<void>`;
  `ServeOptions.keepAliveMs?: number` (default 15,000);
  `startWebFixture().events(path, headers)` returns a reader of parsed SSE
  frames and a `close()`.

- [ ] **Step 1: Write failing tests** with a fake source whose `subscribe`
      records calls and lets the test push updates.
  - `unauthenticated, invalid, and unknown issues are rejected`: 401 without the
    cookie, 400 for `/api/issues/0/events`, 404 JSON for an unknown issue, 405
    with `Allow: GET` for `HEAD`. No `subscribe` call occurs.
  - `stream sends headers, retry, and framed updates`: status 200, content type
    `text/event-stream; charset=utf-8`, the CSP and `no-store` headers, no
    `Content-Length`. The first frame is `retry: 3000`. A pushed update arrives
    as `id`, `event`, and one JSON `data` line.
  - `Last-Event-ID reconnect receives only missed entries`: use the real
    `createIssueFeed()` with a fake projection. Read updates 1–3, disconnect,
    add two entries, reconnect with `Last-Event-ID: <id 3>`. Expect exactly the
    two missed entries and no `reset`. Also expect that an invalid header is
    passed as null.
  - `client disconnect unsubscribes`: destroy the client socket. The unsubscribe
    function runs once.
  - `keep-alive comment on its interval`: start the fixture with
    `keepAliveMs: 20` and expect a `: keep-alive` frame.
  - `close ends open streams`: `serving.close()` resolves while a stream is
    open, and the client sees the end of the response.

- [ ] **Step 2: Run** `node --test src/web/server-events.test.ts`. Expected:
      FAIL.

- [ ] **Step 3: Implement** the route as the spec lists. `request.ts` checks
      `issueEventsPath()` after authentication and before the method check.
      `server.ts` owns the `streams` set. `close()` sets `closing`, ends each
      stream, and then closes the server. Check `res.writableLength` against 8
      MiB after each write.

- [ ] **Step 4: Run** `node --test src/web/*.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
      `feat(web): stream issue updates as server-sent events`.

## Task 4: Live issue page and browser check

**Files:**

- Create: `web/live-issue.js`, `src/web/browser-live.test.ts`,
  `docs/reviews/2026-11-14-issue-304-live-progress-verification.md`
- Modify: `web/controller.js`, `web/app.js`, `web/issue.js`,
  `web/view-state.js`, `web/styles/issue.css`,
  `scripts/check-issue-thread-layout.mjs`

**Interfaces:**

- Consumes: `IssueUpdate`, `IssueResponse`.
- Produces:
  `applyIssueUpdate(response: IssueResponse, update: IssueUpdate): IssueResponse`;
  `liveElapsedSeconds(detail: IssueDetail, nowMs: number): number | null`;
  `createPageController` option `events(url: string): EventSourceLike`, where
  `EventSourceLike` has `addEventListener`, `close()`, and `readyState`;
  `PageState.connection: "connecting" | "live" | "reconnecting" | null`.

- [ ] **Step 1: Write failing tests** in `browser-live.test.ts`.
  - `applyIssueUpdate`: `reset` replaces the response, `header` keeps the
    thread, `thread` splices after the ID, an unknown `after` replaces the
    thread, and `unavailable` returns the input.
  - `liveElapsedSeconds`: base 120 and `activeSince` 30 s before now gives 150.
    A future `activeSince` clamps to the base. A null base gives only the active
    time. A non-active run returns `summary.elapsedSeconds`.
  - Controller with a fake `events`: an active live issue opens
    `/api/issues/7/events`. A `header` with outcome `completed` closes it and
    starts exactly one `api.issue(7)` fetch, whose response becomes the page
    state. A navigation closes it. An `error` with `readyState` 2 reloads the
    issue once. An `error` with `readyState` 0 sets
    `connection: "reconnecting"`, and `open` sets `"live"`. A sample source and
    a finished run never open a stream.

- [ ] **Step 2: Run** `node --test src/web/browser-live.test.ts`. Expected:
      FAIL.

- [ ] **Step 3: Implement.**
  - `controller.js`: open after a successful live active issue load. Listen to
    `reset`, `header`, `thread`, and `unavailable`. Parse JSON, apply, and
    publish. Close on the end conditions in the spec.
  - `issue.js`: remove the active placeholder. Render the thread for active
    runs. Show the “Live” or “Reconnecting…” meta item with the existing live
    dot. Mark the elapsed item with `data-live-elapsed` and the base data that
    `liveElapsedSeconds` needs.
  - `view-state.js`: `restore(saved, { keepScroll: boolean })`. With
    `keepScroll`, do not call `scrollIntoView()` on the rail.
  - `app.js`: pass `events: (url) => new EventSource(url)`. Run a 1,000 ms
    interval that updates only `[data-live-elapsed]` text. For a render of the
    same issue, record `scrollY` and whether the window is within 120 px of the
    bottom. Restore with `keepScroll: true`. Then scroll to the bottom when it
    was near the bottom, else restore `scrollY`. Update a visually hidden
    `role="status"` element with “Run finished” or “Run stopped” once at the
    end.
  - `issue.css`: the connection item and the hidden status. The pulse respects
    `prefers-reduced-motion`.

- [ ] **Step 4: Run** `node --test src/web/browser-live.test.ts`,
      `npm run check:types`, and `npm run lint`. Expected: PASS.

- [ ] **Step 5: Extend the layout check.** Add a live state to
      `scripts/check-issue-thread-layout.mjs`: a fixture attempt with a held
      lock. The script appends a tool call after the page loads. It asserts that
      the tool appears within 5 s without a navigation, that the elapsed text
      changes, and that a lock release shows “Finished” and the cost. It also
      opens a tool, scrolls to the top, appends an entry, and asserts that
      `scrollY` stays the same and the tool stays open. Run it at desktop and
      390 px in both themes. Expected: PASS with no page overflow and no console
      errors.

- [ ] **Step 6: Real run check.** Run `patchmill setup-test-repo` for a test
      repository. Start `patchmill serve` and an unattended
      `patchmill run-once --issue N` there. Open the printed link. Record in the
      verification document: the issue, the time from a file append to its
      display for at least three tool calls and progress lines, the elapsed
      count, the end state with step and cost, and the longest projection time.
      Capture active and ended screenshots at desktop and 390 px in both themes
      with the visual-evidence and frontend-review skills. If a run on a test
      repository is not possible, stop and report it. Do not use a production
      issue.

- [ ] **Step 7: Run** `npm test`, `npm run check:types`, and `npm run lint`.
      Expected: PASS. No npm dependency changes, so the Nix build is not
      required.

- [ ] **Step 8: Commit**
      `feat(web): show live Issue run progress on the issue page`.

## Planner self-review

- **Spec coverage:** the feed rules map to Task 1. The active projection,
  fingerprint, and one-issue projection map to Task 2. The HTTP stream and
  shutdown map to Task 3. Page behavior, the browser check, and evidence map to
  Task 4.
- **Types:** `IssueUpdate`, `IssueHeader`, `activeSince`, and the `subscribe`
  signature are the same in all tasks.
- **Proportion:** the plan gives signatures and test assertions, not bodies.
