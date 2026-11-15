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

## First real run attempt

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
but no Pi transcript. No login or credential copying was attempted.

## Authorized real run retry

The maintainer approved reference to the existing Pi agent directory for this
check only. Set the disposable repository's `pi.agentDir` to the current
`PI_CODING_AGENT_DIR`. Kept `workflow.stateTracking: "local"`. No credential
file was read, printed, copied, or moved. No login was run. Deleted the previous
temporary agent directory at
`/tmp/patchmill-live-progress-test/.patchmill/pi-agent`.

Ran unattended `patchmill run-once --issue 1` and `patchmill serve --port 4298`
against the disposable repository. An authenticated Chromium page subscribed to
issue #1 before the measured appends. Run: `20261115-173730-5b10`.

### Measurement method

A temporary observer checked complete JSONL records every 50 ms, then checked
the corresponding rendered thread IDs through Chromium. Measurements start when
the observer first saw a complete appended record. They can underestimate
append-to-display time by up to 50 ms plus local file-read overhead. No fixture
records were appended to this real run.

A temporary Node module loader timed the actual `input.project(issue)` call in
the serving process. The loader and observer stayed outside the worktree. They
changed no production files or run data. Sixteen projections were measured; the
longest was **702.7 ms**, below the one-second poll interval. The median was
16.9 ms.

### Tool call display

| Complete append observed (UTC) | Tool       | Display latency |
| ------------------------------ | ---------- | --------------- |
| 15:40:03.538                   | read       | 945 ms          |
| 15:41:06.424                   | write      | 111 ms          |
| 15:41:29.637                   | write      | 955 ms          |
| 15:41:38.722                   | edit       | 826 ms          |
| 15:42:42.138                   | write      | 502 ms          |
| 15:42:46.905                   | list_peers | 740 ms          |
| 15:42:51.132                   | bash       | 513 ms          |
| 15:42:57.156                   | bash       | 466 ms          |

### Progress display

| Complete append observed (UTC) | Progress record                                                                      | Display latency |
| ------------------------------ | ------------------------------------------------------------------------------------ | --------------- |
| 15:43:18.532                   | `tokens: task 16.5k total 16.5k   time elapsed: 349s`                                | 123 ms          |
| 15:43:24.820                   | Final result, including `Final result: ! Stopped` and `16.5k tokens · elapsed 5m54s` | 852 ms          |

These are **two distinct progress appends**, not three. The second append
contains multiple displayed lines, but it is not a third independent latency
sample. The browser attached after the first two progress appends of the run.
The requested third distinct progress sample remains unmeasured.

The elapsed value counted from **1m 57s** to **5m 54s**. Without navigation, the
header changed to **Stopped**, step **Planning**, elapsed **5m 54s**, and cost
**$0.0000 · 398.8K tokens**. The reported zero cost comes from the provider's
recorded usage; it is not an estimated price. The page's navigation time origin
did not change. All eight measured tool appends and both progress appends
reached the page.

### Remaining blocker

Authentication succeeded, but the test run returned `needs-input`. Its planner
could not perform its required independent plan review. The exact reported
prerequisite was:

```text
BLOCKING PREREQUISITE: the required fresh-context canonical `reviewer` run
could not be performed. This planning session is itself a subagent child
(PI_SUBAGENT_CHILD=1) with no `subagent` tool exposed and no agent-mesh peers,
and the skill forbids replacing fresh review with planner self-review.
```

The planner pushed its documents on the disposable repository's issue branch. No
labels or comments were written. The temporary server was stopped, the browser
exited, and no test run process remained. The repository and clone remain for
maintainer cleanup.

The retry verifies real live tool display, two progress appends, elapsed time,
and stopped-run metadata. It does **not** establish a successful completed run
or a third progress sample. Per the maintainer's instruction for a failed run,
the handoff remains `needs-input`. No pull request was created.

## Visual evidence

The fixture captures are committed under `docs/screenshots/`:

- `issue-thread-active-{desktop,mobile}-{dark,light}.png`
- `issue-thread-live-ended-{desktop,mobile}-{dark,light}.png`

The fixture captures show synthetic, non-secret content. Two additional captures
show the actual retry:

- `issue-thread-real-active-desktop-light.png`
- `issue-thread-real-ended-desktop-light.png`

Independent code review found three Important issues: duplicated duration logic,
lock turnover absent from the fingerprint, and an incomplete terminal-transition
browser assertion. All three were accepted and repaired. The turnover regression
failed before the repair and passed after it. Duration calculation now reuses
the existing metadata function.

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
The retry resolved authentication through an approved existing-agent-directory
reference. Real-run acceptance remains incomplete because the test planner
lacked review fanout and only two new progress appends were measured. No ready
pull request is claimed.

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
