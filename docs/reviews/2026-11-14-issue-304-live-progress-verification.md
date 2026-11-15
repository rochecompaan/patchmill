# Live Issue run progress verification

## Automated checks

- Baseline `npm test`: 1,240 tests passed.
- Implementation `npm test`: 1,253 tests passed.
- `npm run check:types`: passed.
- `npm run lint`: passed.
- `CAPTURE_ISSUE_THREADS=1 node scripts/check-issue-thread-layout.mjs`: passed.
  The check uses real file-backed snapshots, authenticated SSE, and Chromium. It
  covers desktop and 390px layouts in both themes.

The fixture check appended tool calls after the page loaded. Display latencies
were 984, 982, 985, and 987 ms. The elapsed text counted up. An expanded tool
stayed open, and a reader away from the bottom kept the same scroll position.
The repaired end-transition check subscribes to the active issue before lock
release. Without navigation, it observed Finished, the Planning step, $0.5000,
and a frozen elapsed value. No script exceptions or HTML execution occurred. The
check only sent GET requests.

## Real run blocker

Created `rochecompaan/patchmill-live-progress-test` with
`patchmill setup-test-repo`. Cloned and initialized it in
`/tmp/patchmill-live-progress-test`. Used `workflow.stateTracking: "local"` to
avoid all host label and comment writes, as directed by the supervisor.

Attempted an unattended `patchmill run-once --issue 10 --plan-only` with the
implementation CLI. Started `patchmill serve --port 4298` against that
repository. The run stopped before its first agent turn. Its `session-1.log`
says:

```text
No API key found for the selected model.

Use /login to log into a provider via OAuth or API key.
```

The run ID is `20261115-165602-56ee`. It wrote progress and a stopped result,
but no Pi transcript. Thus the real-run browser acceptance check is **blocked**,
not passed. No provider authentication or credential copying was attempted.
Projection duration during a real run is not available.

## Visual evidence

The fixture captures are committed under `docs/screenshots/`:

- `issue-thread-active-{desktop,mobile}-{dark,light}.png`
- `issue-thread-live-ended-{desktop,mobile}-{dark,light}.png`

They show synthetic, non-secret content. They are not evidence of a real agent
run. Independent code review found three Important issues: duplicated duration
logic, lock turnover absent from the fingerprint, and an incomplete
terminal-transition browser assertion. All three were accepted and repaired. The
turnover regression failed before the repair and passed after it. Duration
calculation now reuses the existing metadata function. Frontend review is
pending.
