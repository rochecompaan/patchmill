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
were 917, 979, 982, and 971 ms. The elapsed text counted up. An expanded tool
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
calculation now reuses the existing metadata function.

## Review receipts

- Whole-branch review at `687997e`: three Important findings, all accepted and
  repaired in `c944e7f`. No deferred Minor findings.
- Frontend review at `c944e7f`: keyboard focus loss and mobile rail scroll
  reset. Both accepted and repaired in `949d558`. A browser regression failed
  before the focus repair and passed after it. It checks Enter across a live
  update.
- Normal production-code repair review of `c944e7f..949d558`: no blockers.
- Screenshot capture repair at `709322b`: force virtualized rows to paint for
  full-page evidence only. Production rendering does not change.
- Fresh frontend confirmation at `709322b`: **pass**, no findings. The reviewer
  inspected all eight refreshed screenshots.

The last full suite reports 1,253 passing tests. Type checks and lint also pass.
The real-run acceptance check remains blocked by missing provider credentials.
No credential configuration was used or copied. No ready pull request is
claimed.

### Rulings

`RunObservation.activeRunId` is optional to retain existing fake-adapter
compatibility. Production always supplies it. The cost if wrong is that a test
adapter can omit ownership evidence.

The reviewers set aside interactive transcripts (explicitly deferred to #305),
provider authentication (operator decision), and unrelated whole-branch behavior
in the scoped repair review. These boundaries stand. The cost if wrong is a
missed behavior outside the approved scope. Duplicate or identity-less controls
are not present among the affected live-page controls; stable identity
restoration covers current controls. The cost if wrong is lost focus on a future
control.

### Human Reviewer Callouts (Non-Blocking)

- `RunDataSource.subscribe` changes its exported signature.
- Adds an authenticated, read-only SSE endpoint.
- No dependency changes, migrations or irreversible operations.
