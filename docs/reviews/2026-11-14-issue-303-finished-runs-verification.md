# Finished Issue runs: implementation verification

## Scope

Issue #303 adds read-only finished and stopped Issue threads. The implementation
uses the current run format selected by #302. It does not restore retired logs,
add live issue updates, or expose nested agent transcripts.

The issue branch retains its specification, implementation plan, offline mockup,
and canonical Issue thread definition.

## Validation

- Baseline `npm test`: 1,223 passed, zero failed.
- Final implementation `npm test`: 1,238 passed, zero failed.
- `npm run check:types`: passed.
- `npm run lint`: passed, including formatting, ESLint, and Markdown lint.
- `CHROMIUM=chromium-browser npm run test:web`: passed.
- `CHROMIUM=chromium-browser node scripts/check-issue-thread-layout.mjs`: passed
  all 16 desktop/mobile, dark/light, and issue-state combinations.
- The browser verified keyboard tool disclosure, literal HTML, shortened output,
  stopped tools, final cost, empty bodies, active withholding, and no mutation
  requests.
- No npm dependency or skill-pack files changed. The Nix dependency rebuild rule
  did not apply.

The initial shared dependency link failed `npm ls` because its installed graph
did not match this worktree. A local `npm ci` restored the locked environment.
No manifest or lock file changed. The audit reported existing dependency
vulnerabilities. This issue does not update dependencies.

The new tests failed before their implementations. The browser first failed
because the real-thread placeholder contained no tool rows. Additional browser
assertions caught small token totals rounded to zero and unbounded tool panels.
The final page shows compact nonzero totals and scrollable expanded output.

## Repository source comparison

All five retained current-format repository issues were closed at inspection:
Issues #173, #301, #302, #334, and #350 were not eligible for #302's open-issue
board. The approved fallback therefore replayed a sanitized copy of stopped
issue #302 in a temporary repository. No production run started or changed.

Source attempt: `20261114-145313-5132` from this repository's issue #302 run
directory. The replay retains entry IDs, timestamps, phase metadata, tool names,
and usage. It replaces conversational text, tool input, and output with safe
placeholders. It does not publish private transcripts or absolute local paths.

The authenticated browser matched these independently counted source values:

| Observation                 |          Retained source |                            Browser |
| --------------------------- | -----------------------: | ---------------------------------: |
| Phase order                 | planning, implementation |           planning, implementation |
| Main-agent tool calls       |                      397 |                                397 |
| Cost, all retained attempts |              USD 23.8765 |                        USD 23.8765 |
| Input plus output tokens    |               92,504,277 | Compact total from the same report |

The comparison command was:

```bash
PATCHMILL_REPLAY_ISSUE=302 \
PATCHMILL_REPLAY_DIRECTORY=/path/to/patchmill/.patchmill/runs/issue-302 \
CAPTURE_ISSUE_THREADS=1 CHROMIUM=chromium-browser \
node scripts/check-issue-thread-layout.mjs
```

`readIssueCostReport()` supplied the source billing total. The web reader
verified usage completeness before it reused that arithmetic. Nested usage
contributes to billing without adding nested transcript rows.

Historical terminal progress and interactive planning tool results were not
retained for this attempt. The page states those gaps. An exact historical
terminal-output comparison is impossible. New run tests compare retained
formatter output with actual terminal output. Browser fixtures exercise that
history, phase headings, progress order, and shortened results.

## Visual evidence

The screenshots come from the running authenticated app and the real file
adapter. Fixture text deliberately contains HTML. The browser shows that text
without executing it. Evidence includes an expanded tool and collapsed prompt.

Each state has desktop/mobile evidence in both themes:

- `docs/screenshots/issue-thread-finished-{desktop,mobile}-{dark,light}.png`
- `docs/screenshots/issue-thread-blocked-{desktop,mobile}-{dark,light}.png`
- `docs/screenshots/issue-thread-empty-{desktop,mobile}-{dark,light}.png`
- `docs/screenshots/issue-thread-active-{desktop,mobile}-{dark,light}.png`
- `docs/screenshots/issue-thread-repository-replay-desktop-dark.png`

The 390px layouts have no horizontal page overflow. Native disclosure controls
supply keyboard behavior. Tool output panels scroll rather than expanding
without a height limit. Long static threads use browser content visibility.

## Rulings and limits

- Sample null defaults accompanied the required detail type change. Otherwise,
  intermediate commits could not pass type validation. Cost if wrong: minor
  sample fixture churn.
- Confined files, attempt history, and final usage use separate internal
  modules. Their failure modes differ, while the public detail interface stays
  small. Cost if wrong: limited extra file navigation.
- History-only recovery occurs only for a selected issue. Board requests never
  scan private logs. A history-only board cannot show a precise phase until a
  valid latest projection exists.
- Existing view-only controls remain. They do not start, stop, or change runs.
- The existing visual system takes precedence over generic style preferences.
  Native details supply keyboard support without redundant custom handlers.
  Snapshot disclosures retain local view state rather than URL state.

## Independent reviews

Whole-branch and frontend review receipts will be recorded here before the pull
request becomes ready. Product checks above describe the validated
implementation, not maintainer approval or merge authority.
