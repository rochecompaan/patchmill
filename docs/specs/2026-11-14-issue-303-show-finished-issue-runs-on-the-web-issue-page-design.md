# Show finished Issue runs on the web issue page

- Issue: [#303](https://github.com/rochecompaan/patchmill/issues/303)
- Parent: [#300](https://github.com/rochecompaan/patchmill/issues/300)
- Prerequisite: #302 closed. Inspected base:
  `7dbac5292d49753be55e73189b66bfa1ba548192`.
- Status: Proposed for the Interactive Issue run approval dialog.

## Intent

A maintainer can inspect a finished or stopped Issue run without opening local
files. The issue page shows its recorded work, terminal progress, links, elapsed
time, and final cost. It remains view only.

An Issue run can contain several Run attempts. The Issue thread shows all
retained current-format attempts, oldest first. A stopped attempt can resume
later. Stopped does not mean that the logical Issue run cannot continue.

## Existing decisions and source evidence

The
[#302 specification](2026-11-14-issue-302-show-real-issues-on-the-web-board-design.md)
explicitly selects the current workflow and rejects retired run formats. That
decision also applies here. The filenames in the original #303 description
predate that decision. Do not restore `issue-N.json`, `run-*.jsonl`,
`run-*-pi-sessions/`, or `runCostReport` compatibility.

Current sources establish these facts:

- `src/web/run-data.ts` defines the two-operation `RunDataSource` interface.
  `apiResponse()` uses it for both authenticated GET routes.
- `createFileRunDataSource()` currently supplies empty issue details.
  `createHostBoardCache()` shares open-issue and open-PR reads for 60 seconds.
- `readIssueObservation()` reads `issue-N/progress.json`, current-format
  `RUN_ID/result.json`, and issue-lock ownership. `projectBoardIssue()` owns
  board classification. Its blocked reason deliberately excludes private text.
- `runOneIssue()` writes `result.json` with attempt identity, start/end times,
  outcome, and ordered phase sessions. It writes Pi logs beneath
  `RUN_ID/sessions/SESSION_NUMBER/`.
- `formatRunStart()`, `formatPhaseStart()`, `formatPhaseComplete()`, and
  `formatRunResult()` produce terminal progress. Those lines are not currently
  retained as a structured history. `pi.log` contains agent output, not that
  complete terminal history.
- `recordPlanningUsage()` retains only assistant entries from interactive
  planning. Tool calls survive, but tool results and human messages do not.
  `createWorkerLauncher()` copies the main implementation transcript into its
  numbered session directory. That worker is the main implementation agent, even
  though the console launches it through pi-subagents.
- `readIssueCostReport()` totals retained current-format attempts, including
  subagent usage, with Pi-entry deduplication. Its report is not a saved
  `runCostReport` field. Missing or damaged usage makes the report unavailable.
- `web/issue.js` hides real threads behind a placeholder. `web/thread.js`
  already shows safe messages, tools, steps, progress, and errors.
  `web/controller.js` polls only the board, not the issue page.

`GLOSSARY.md` remains the canonical single-context vocabulary. There are no
ADRs, context maps, or legacy context documents in this checkout.

## Goals, exclusions, and constraints

### Goals

- Show the issue number, host title, observed step, start/end times, elapsed
  time, PR links, spec/plan links, and ended-run cost.
- Show main-agent messages, tool calls, terminal progress, and step/attempt
  dividers in chronological order.
- Keep Patchmill prompts collapsed. The first expanded conversational content is
  the agent's work, not its execution envelope.
- Show blocker questions or the last recorded error for stopped work.
- For an issue without a run, show its host body as plain text and an empty
  Issue thread.
- Skip damaged log lines without losing subsequent valid entries or the page.
- Keep available older current-format runs useful without inventing lost data.

### Non-goals

- Live issue refresh, streaming, EventSource, live cost, or active transcripts.
- Chat or run-control mutations.
- Subagent transcripts, thinking content, attachments, or raw filesystem URLs.
- Closed-issue discovery, an archive view, or changes to board eligibility. A
  finished Issue run can belong to an open host issue.
- Historical-format migration, an Event ledger, or workflow recovery changes.
- New artifact previews. Existing immutable host document links remain links.

### Global constraints

- Add no npm dependencies, browser framework, or browser build step.
- Preserve authentication, Host/Origin checks, CSP, and static-file confinement.
- Honor `paths.runsDir`, `paths.specsDir`, `paths.plansDir`, and workflow mode.
- The web server never starts runs, syncs workflow state, fetches Git refs, or
  mutates host data.
- Read detailed logs only for the requested eligible issue, never for a board
  request or an unknown issue number.
- Treat issue bodies, messages, prompts, tool input/output, and errors as text.
- Do not expose detailed text or issue bodies in board JSON.
- Keep sample mode functional and preserve board polling at 15,000 milliseconds.

## Approaches

| Approach                                                                      | Benefit                                               | Cost                                                         | Decision |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | -------- |
| Extend the file adapter with on-demand details and small diagnostic additions | Preserves the existing seam and supports current runs | Future runs must retain missing observations                 | Selected |
| Read only files that exist today                                              | No writer change                                      | Cannot recover terminal progress or interactive tool results | Rejected |
| Restore legacy formats or connect the browser to the console                  | Resembles older issue wording                         | Contradicts #302 or introduces live transport                | Rejected |

This is one cohesive feature, not a new execution architecture. The planner
selects the first approach. Existing approved requirements determine the visual
system and read-only interface. Human approval occurs through the submission
dialog, not a separate chat question.

## Module ownership and seams

The architecture changes because the file adapter gains an on-demand detail
interface and run writers retain additional diagnostics. Domain modeling and
codebase design therefore apply.

The external seam remains `RunDataSource`:

```typescript
snapshot(selection?: { issue: number }): Promise<RunDataSnapshot>;
subscribe(listener: (change: RunDataChange) => void): () => void;
```

An omitted selection requests board data only. The file adapter supplies an
empty `details` map. A selection requests that issue's detail plus the same
board summaries. The sample adapter can continue to return its complete fixed
snapshot. `apiResponse()` passes the validated number on the issue route.

`src/web/file-issue-detail.ts` owns the deep detail module. Its internal files
handle confined discovery and Pi projection. A shared `file-run-records.ts`
reader supplies validated attempt metadata to the existing observation module
and the detail module. It does not read transcripts for board requests. Callers
supply the existing issue, summary, run observation, configured repository root,
and warning callback. Callers never discover paths, join tool results, sort
attempts, or calculate cost. Removing this module puts that complexity back into
its callers.

The file adapter and sample adapter are real alternatives at the existing seam.
The host and command-runner dependencies remain injected. Filesystem behavior
uses temporary real directories in tests, not a new filesystem abstraction. Pure
parsing needs no adapter. No speculative live-transport seam is added. This
depth gives the route and browser leverage. Keeping discovery, validation, and
projection behind one interface preserves locality.

Board and detail requests share the host cache, not the same incorrectly keyed
pending detail promise. Coalesce concurrent work only for an identical
selection. The board revision hashes public summaries. The issue revision also
hashes its selected detail. `subscribe()` reports board-revision changes only in
this slice. A request or clock tick alone never changes either revision. Freeze
completed snapshots. Unknown or excluded issues remain 404 and trigger no
transcript reads. Host failures keep the existing cache/error behavior.

## Retained diagnostic history

For future successfully claimed attempts, add `issue-N/RUN_ID/history.jsonl`.
This diagnostic history is not the Event ledger and never controls execution,
approval, recovery, or issue ownership.

Each record has `schemaVersion: 1`, `issue`, `runId`, a monotonically increasing
`sequence`, and UTC `at`. Its discriminated payload is one of:

- `snapshot`: the validated `RunProgress` projection, including safe fact paths.
- `session`: the session number, phase, and workspace stage at launch.
- `progress`: the text and stdout/stderr stream of a terminal progress message.

Retain the exact formatted output from the four console formatters named
previously. Strip terminal control sequences only in the web projection. Record
one progress event per formatter output, including multiline final output. Do
not duplicate a step heading as both a progress line and a step row. The reader
uses session records for step rows and skips the matching `formatPhaseStart()`
progress entry.

Await ordered append operations under the existing issue lock. Complete pending
writes before lock release. Retain `progress.json` as the atomic latest
projection. Add an optional `progress` field to `result.json` with the ended
`RunProgress` projection. Preserve all existing result fields. This small
metadata copy retains each attempt's final paths and PR without a log scan.
History and projection writes fail independently. A history error emits a short
warning but never changes execution, observer delivery, result publication, or
lock release. No refused or claimed-elsewhere attempt creates a history.

Extend `recordPlanningUsage()` to retain the launch-local `user`, `assistant`,
and `toolResult` entries in `console-planning.jsonl`. Preserve original Pi IDs
and usage fields so existing cost readers remain correct. Remove thinking and
nontext attachment payloads from these copies. Mark the exact injected prompt
entry with `patchmillPrompt: true`. `PlanningConversation.run()` supplies its
actual envelope or feedback string for that comparison. Keep the current
zero-usage fallback when no assistant replies. Recorder failure must not turn an
accepted planning result into a failed run.

Print-mode and implementation sessions already retain their main Pi logs. Their
first non-inherited user entry is the injected execution prompt and appears
collapsed. Later human messages remain expanded. No broad scan of
`issue-N/console/` is permitted: that session can contain unrelated runs.

## Discovery, ordering, and degradation

Only generated attempt directory names matching `^\d{8}-\d{6}-[a-f0-9]{4}$`
qualify. Validate each result's issue, run ID, timestamps, outcome, and ordered
session metadata. Read only positive numeric session directories. Read immediate
main-session JSONL files for the thread, not recursive `forks`, `subagents`, or
artifact directories.

All detail reads remain within the configured run root. Reject symlinks and
nonregular files at each discovered level. Never trust paths from records as
read targets. A saved `parentSession` path is metadata, not permission to read
another transcript. Before the existing recursive cost reader runs, validate its
attempt/session tree against the same confinement rules. Extend
`readIssueCostReport()` with an optional third argument,
`selection?: { runIds: readonly string[] }`. The web reader supplies only its
validated attempts. Existing kernel callers retain their default behavior.

The latest valid attempt determines the header. Include an unfinished attempt
when its current progress or history establishes its identity. With no held
issue lock, it is incomplete rather than active. A newer active attempt hides
all transcripts and cost on the issue page in this slice. Show “Run active. Live
progress comes in a later update.” Keep its board observation intact.

Sort attempts by validated start time, then run ID. Group entries by attempt and
numeric session order. Within a session, merge progress and transcript entries
by timestamp. Preserve journal sequence, Pi file order, and content block order
as stable tie-breakers. Keep untimed valid Pi messages in their file order at
that session's start. Never invent a date for them.

Forked main transcripts can copy ancestor entries. Exclude entries earlier than
that session's launch observation, or its valid Pi session-header creation time
when the observation is absent. Deduplicate identical retained Pi entries by ID
and content. Do not drop distinct entries that merely reuse an ID. Tool result
matching stays within its main session and uses `toolCallId`, not name.

Skip blank, invalid JSON, truncated, unknown, and wrong-shaped lines
individually. Continue with later valid lines. Ignore unsupported records and
content blocks. Use a streaming line reader. Skip lines over 16 MiB with a
generic warning. Do not include damaged contents or private paths in warnings.

For older current-format runs without history, derive phase dividers from
`result.sessions`, use retained messages, and show “Terminal progress was not
recorded for this attempt.” Assistant-only planning copies remain readable. A
tool without a retained result says “Output not recorded.” Missing sessions
produce “Agent transcript not recorded for this attempt.” Missing metadata never
becomes a fabricated step, cost, or successful result.

## Detail contract and projection

Extend `IssueDetail` with these fields. Sample details supply null defaults.

```typescript
body: string | null;
run: {
  startedAt: string;
  finishedAt: string | null;
  outcome: "completed" | "stopped" | "incomplete" | "active";
} | null;
```

The host issue supplies `body` only when no run exists. An empty body stays an
empty string. A valid attempt without session files still counts as a run. Start
time is the earliest retained attempt start. End time is the latest attempt's
finish. Elapsed time sums known attempt durations, excluding gaps between
attempts. Unknown durations make elapsed time null, not a false zero.

Enrich `IssueSummary.step` and `elapsedSeconds` consistently for both routes,
without changing board classification or copying private errors into summaries.
Use the latest recorded phase/stage for the step. Keep missing values null.
Header PRs include validated historical final projections from results,
deduplicated with current host PRs. Fresh host state wins. Preserve #302's rule
that a saved open PR absent from the host list does not qualify. Older results
without final projections cannot supply missing PR or document facts. Preserve
head-repository and base-branch validation from #302. Spec/plan links keep
`createDocumentLinkReader()` and its immutable host URLs. No raw local paths
become navigable links.

Reuse existing thread variants. Use a neutral `divider` for “Run attempt N” and
`step` for each session launch. Add one `prompt` variant with `id`, `at`, and
`text`, rendered as native collapsed details labelled “Patchmill prompt”. Agent
and human text use plain paragraph/code blocks, not an HTML or Markdown
renderer. Preserve newlines. Thinking is never projected.

Each tool call becomes one `tool` event at its call position. Join a later
result onto that event. Preserve arguments as JSON. Project text content only
from tool output. A stopped attempt's unmatched tool is `stopped`, not
permanently `running`. An explicit error result is `failed`. Limit result text
to 8,000 Unicode characters plus “Output shortened.” Input remains available in
the opened details. Images and other unsupported output show a text notice. Do
not expand nested subagent output into additional messages or tool rows.

For stopped-needsInfo or incomplete attempts, show an error block with the
latest recorded outcome summary. This summary contains the blocker questions or
last error in today's kernel. Use the existing incomplete-run explanation when
no specific summary exists. Detailed error text belongs only to the requested
authenticated issue response.

## Ended-run cost

When no attempt is active, use `readIssueCostReport()` for `finalUsage`. The
header labels it “Cost, all retained attempts” because the logical Issue run can
span several attempts. Sum input and output tokens from its report. Show USD to
four decimal places, consistent with the PR report.

The existing cost module remains the arithmetic authority. Subagent billing can
contribute to cost without exposing subagent transcripts. If any required usage
is missing or damaged, show “Cost not recorded”. Do not show a partial total as
complete or substitute zero. The final progress block retains each attempt's
terminal cost, so it can differ from the all-attempt header total. No active run
exposes final cost.

## Page design

Frontend design applies because the issue page gains visible history and
expand/collapse interactions. Preserve the approved #301/#302 visual system, not
generic frontend-design preferences. There is no board redesign.

The dark palette remains night `#08090b`, panel `#121418`, brass `#c4a882`,
green `#39c96b`, and red `#ff4c4c`. Keep the existing light-theme accents.
Product typography remains the packaged Atkinson families. The self-contained
mockup uses installed-font fallbacks without external requests.

```text
Patchmill | rochecompaan/patchmill                         theme | name
Board > #N Host issue title
workflow rail
Stopped / Finished | step | start / end | elapsed | PR links
Spec | Plan                            Cost, all retained attempts

  Run attempt 1
  01 planning
  > Patchmill prompt                         [collapsed]
  agent   I inspected the existing module.
  > read(path=...)                           [tool details]
  tokens: task ... total ... time elapsed ...
  Run attempt 2
  01 implementation
  agent   The change is ready.
  [blocker questions or last error when stopped]

View only. Messages come with live chat. / existing terminal or finished note
```

Keep one compact tool-call summary line. Its argument preview truncates
visually, while opened details show wrapped or horizontally scrollable JSON.
Native `details` elements provide keyboard operation and exposed state. Preserve
expansion by event ID through the existing view-state behavior. Use semantic
headings, labelled thread sections, visible focus, and both themes. At 390px,
stack metadata and allow code-block scrolling without page overflow. Do not
animate history or announce static rows as live updates.

No-run pages show the body above an empty thread and “No run yet”. They never
show the old unavailable-thread placeholder or sample messages. Active pages
show the explicit future-live message instead of a partial transcript. Existing
view-only control and composer behavior remains.

## Verification

Apply the Testing Value Gate: new tests cover observable file projection, record
retention, request isolation, corruption, security, and rendering. Do not add
tests that assert planning-document text or static mockup structure.

Fixture cases cover several attempts, blocked questions, missing Pi logs,
assistant-only planning copies, missing history, incomplete and active attempts,
HTML text, damaged middle/tail lines, oversized lines, reordered tool results,
unknown records, inherited entries, duplicate IDs, symlinks, and absent costs.
Assert complete values through the detail module, source interface, HTTP routes,
and browser rendering. Board JSON must not contain private text. Concurrent
requests for different issues must not exchange details.

During implementation, inspect a finished or stopped current-format Issue run
from this repository in the authenticated browser. Select an eligible open issue
with retained results, or replay a sanitized copy of a real stopped run in a
temporary repository if all eligible files disappear. Record which source was
used. Compare phase order, tool-call counts, shortened output, attempt progress,
and cost with retained files and terminal output. Explain unavailable historical
fields. Do not start or mutate a production run to obtain evidence.

Capture desktop and 390px screenshots in both themes, including an expanded
tool, collapsed prompt, blocked state, and no-run body. Use the installed
visual-evidence and frontend-review skills after implementation validation. Run
`npm test`, `npm run check:types`, `npm run lint`, and the sample browser check.
If npm dependencies change, rerun the Nix build.

Planning validates the documents and offline mockup only. Product tests and
screenshots belong to implementation.

## Companion artifacts

- `docs/mockups/2026-11-14-issue-303-finished-runs.html`:
  [Offline full-page issue states](../mockups/2026-11-14-issue-303-finished-runs.html)
- `GLOSSARY.md`: [Canonical Issue thread definition](../../GLOSSARY.md). No new
  context or ADR is necessary. Diagnostic projection is reversible and does not
  establish a new policy or persistence authority.
