# Show real issues on the web board

- Issue: [#302](https://github.com/rochecompaan/patchmill/issues/302)
- Parent: [#300](https://github.com/rochecompaan/patchmill/issues/300)
- Prerequisite: #301 merged through #349.
- Status: Proposed for the Interactive Issue run approval dialog.

## Intent

The board shows the repository's open issues and their current workflow steps. A
maintainer can identify active runs, review work, and stopped work without
opening each issue. The board remains view only.

`patchmill serve` uses real data by default. `patchmill serve --sample` retains
the deterministic design fixtures. Real issue threads remain outside this slice.

## Inputs and resolved decisions

The existing #301 server supplies the API, browser files, and read-only
`RunDataSource`. Its
[specification](2026-11-13-issue-301-add-patchmill-serve-with-sample-data-design.md)
remains the authority for security and the visual system.

The original [mockup notes](../mockups/web/run-once-workflow.md) describe an
older kernel. The maintainer selected the **current workflow model**, not
compatibility with retired labels or file formats. This decision supersedes the
historical column inputs and admission-record description in those notes and
issue #302.

Current code establishes these facts:

- `LabelsConfig` contains `ready`, `inProgress`, `needsInfo`, `done`, and
  `unsuitable`. The config reader ignores five retired label roles.
- `RunSnapshot` reports `deriving`, `planning`, `implementation`, `gate-wait`,
  `review-wait`, `blocked`, and `ended`. Today it exists only in memory.
- Runs write `issue-N/RUN_ID/result.json` under `paths.runsDir`.
- An exclusive advisory lock on `issue-N/lock` establishes Run attempt
  ownership. Its saved PID is diagnostic data, not proof of ownership.
- Planning PR heads use `agent/issue-N--spec` and `agent/issue-N--plan`.
- Local workflow mode records roles under `.patchmill/state/status/N.jsonl`.
- The browser already polls the board every 15 seconds while visible.

This slice adds a small durable progress projection. It does not restore
`issue-N.json`, `planning-pr-v1`, admission records, or retired workflow roles.
The projection supplies observations only. It never controls phase selection,
approval, recovery, or issue ownership.

## Goals and boundaries

### Goals

- List open host issues through `Host.listOpenIssues()`.
- Map current workflow roles, run progress, and PR facts into seven columns.
- Show issue numbers, titles, labels, document links, PR links, and Live
  markers.
- Share one host cache across every browser and both API routes.
- Read local progress and lock ownership again on each board refresh.
- Preserve sample mode, authentication, safe DOM construction, and packaged
  assets.
- Show an explicit unavailable-thread message for real issues.

### Non-goals

- Real conversations, tool calls, session parsing, historical threads, or usage.
- Live chat, Waiting for reply, EventSource, or streaming updates.
- Starting, pausing, resuming, retrying, or stopping runs from the browser.
- Remote workers, new leases, a coordinator, or an Event ledger.
- Inferring native dependency blockers as board columns. This slice shows
  observed run errors, not a second issue-selection engine.
- Migrating or interpreting retired run files and labels.

### Constraints

- Add no npm dependencies, browser framework, or browser build step.
- Preserve the #301 Host, Origin, token, cookie, CSP, and static-confinement
  rules.
- The server and runs use the same repository directory and host for now.
- Honor `paths.runsDir`, `paths.specsDir`, `paths.plansDir`, and workflow mode.
- The server never calls workflow sync or any host mutation method.
- Missing run data must not remove an otherwise visible host issue.

## Approaches

| Approach                                                                  | Benefit                                                     | Cost or conflict                                                          | Decision |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| Project current run observations to disk and extend the existing provider | Uses current kernel concepts and preserves the web boundary | Needs a small observation writer and read-only lock probe                 | Selected |
| Read the historical run and admission formats                             | Resembles the original issue text                           | Current runs do not write them, and the maintainer rejected compatibility | Rejected |
| Parse session logs or connect the board directly to the console           | Avoids a progress projection                                | Exposes private data and couples this slice to threads or live chat       | Rejected |

Implementation details in this document are planning choices, not additional
maintainer instructions. The existing architecture leaves one suitable approach:
a read-only provider over current host facts and durable run observations.

## Durable observations and ownership

### Progress projection

Each successfully claimed, non-dry Run attempt writes `issue-N/progress.json`
under `paths.runsDir`. The record has `schemaVersion: 1` and these fields:

| Field                         | Value                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `issue`, `runId`, `startedAt` | Current Run attempt identity                                              |
| `updatedAt`                   | UTC time of this observation                                              |
| `state`, `phase`, `session`   | Current `RunSnapshot` values, with explicit null for an absent phase      |
| `interactive`                 | Whether the run has a HumanChannel                                        |
| `facts`                       | Nullable subset: stage, branch, base branch, spec path, plan path, and PR |
| `summary`                     | Nullable final summary                                                    |
| `outcome`                     | Nullable final status and workflow role                                   |

The facts subset excludes absolute worktree and run paths. The reader validates
identity, version, enums, positive issue numbers, timestamps, and relative
artifact paths. It does not trust a filename, a type assertion, or a PID alone.

The kernel awaits atomic writes at observation boundaries, including facts
changes and the final outcome. Each write uses a temporary sibling and rename.
Writes remain ordered under the existing issue lock. No asynchronous write can
overwrite a newer observation after the lock releases.

An observation error produces a short stderr warning. It must not change the run
outcome, replace the console observer, publish an issue comment, or skip lock
release. The in-memory console still receives its observations after a disk
error. The kernel does not read this projection to choose work.

The final record distinguishes completed work, a planning merge stop, and
stopped work that needs information. Completed work uses the done role. An ended
progress record requires a final outcome. The existing `result.json` remains
unchanged. Refused and claimed-elsewhere runs leave no new progress.

### Older current-model runs

If no valid progress record exists, the reader can use the newest valid
current-format `issue-N/RUN_ID/result.json`. Only generated Run attempt
directory names qualify. Console directories, sessions, prompts, and log files
do not.

A result supplies the outcome and the last session phase, not missing PR facts.
The reader selects the newest Run attempt by its validated identity and start
time. An older progress record must not mask a newer result. Records from
another issue never qualify.

An already-active process from before this change can show Live through its
lock. Without progress, its precise phase remains unknown. The board uses its
workflow role rather than inventing phase data. New attempts provide the
detailed columns.

### Live marker

Live means the current issue lock is held. A read-only, nonblocking shared-lock
probe detects the exclusive owner. The probe never creates, truncates, removes,
or replaces the lock file. It always closes its descriptor.

An unlocked file with a live PID does not count. A stale PID after process exit
does not count. A held lock counts even if its diagnostic JSON is damaged.
Permission and I/O errors produce a warning and no Live claim.

If lock diagnostics identify a newer attempt, the provider ignores older
progress for active-phase classification. Live is independent of column and can
appear in Planning review, Code review, or Blocked. It never means that chat is
connected.

## Host facts and workflow roles

### Roles

In label mode, match labels through the five configured role names. Preserve
label names in cards. Unrelated labels have no effect on classification.

In local mode, use the latest current-format local status for the role. Read the
status files without syncing or changing them. A missing status means untriaged.
Honor the existing repository-identity check for the local state directory. Host
labels remain visible, but do not override local workflow roles.

Any unsuitable role excludes the issue before column selection. In label mode,
this exclusion applies even if another workflow label is also present. For other
conflicting roles, the column precedence below applies.

Retired labels remain ordinary visible labels unless explicitly configured as
one of the five current roles. Do not give `blocked`, `spec-review`,
`spec-approved`, `plan-review`, or `plan-approved` an implicit workflow meaning.

### Pull requests

Add a bulk read-only `Host.listOpenPullRequests()` operation to both host
adapters. Use paginated host reads, not one PR query per issue. Preserve
existing `listPullRequests(branch)` behavior for the kernel.

Associate open PRs through exact current issue-branch names. Spec and plan heads
must equal their stable planning branch names. Other `isIssueBranch()` matches
are implementation heads. Issue #30 must not match issue #302.

Apply the kernel's head-repository identity boundary. Only PRs from the
repository Patchmill pushes to, into the configured base, advance a column.
Same-named heads from another fork do not qualify. Deduplicate links by PR
identity.

Validated persisted PR facts can provide historical links. Fresh host state wins
for open PR presence. A saved open PR does not keep a card in review after the
host no longer lists it. Merged or closed PRs do not establish a review column.
Do not claim an unknown final PR state from its absence alone.

### Document links

Cards link known spec and plan documents as well as spec, plan, and
implementation PRs. Real document links navigate to the host. They do not open a
sample drawer or add a filesystem endpoint.

Read artifact names from locally available remote-tracking Git trees for known
issue branches and the base. Reuse the current artifact naming rules. Prefer the
current issue branch, then the base. Resolve the selected ref to a commit and
construct an immutable host URL for the path. Use the correct GitHub or Forgejo
URL shape and repository, including a distinct push repository.

No Git fetch, checkout, worktree creation, or content mutation occurs. If a ref
or artifact is absent locally, omit that document link. Do not invent a date or
path from the current issue title. PR links remain available without local refs.

## Column and card projection

Use the existing wire IDs and visible names:

| Priority | Column / ID                   | Current-model evidence                                                |
| -------- | ----------------------------- | --------------------------------------------------------------------- |
| 1        | Triage / `triage`             | No workflow role, or needsInfo, with no later evidence                |
| 2        | Ready / `ready`               | ready role                                                            |
| 3        | Planning / `planning`         | inProgress role, or an active deriving/planning observation           |
| 4        | Planning review / `review`    | Open spec or plan PR into the base                                    |
| 5        | Implementing / `implementing` | Active implementation observation                                     |
| 6        | Code review / `code`          | done role, or an open implementation PR into the base                 |
| 7        | Blocked / `blocked`           | Current blocked observation, or latest stopped outcome with needsInfo |

Blocked always wins. Otherwise, choose the highest matching priority. Exclusion
for unsuitable happens first. A stopped planning merge wait stays in Planning
review while its PR remains open. A needsInfo role without a failed run stays in
Triage. Completed historical implementation sessions do not mean Implementing.

An inactive, unfinished observation does not keep an issue in an active phase.
This rule includes deriving, planning, implementation, and wait observations.
Without a final result, show Blocked with the reason “Run ended before recording
a result.” A later attempt replaces that evidence. A currently held lock with no
matching progress does not imply a crash.

Each card shows one issue only. Sort cards by ascending issue number within each
column. Show all seven columns, including empty columns. Preserve existing title
wrapping and horizontal board scrolling. Use role-neutral column descriptions
instead of hard-coded workflow label names.

Add an explicit `live: boolean` to `IssueSummary`. Do not infer it from
`status`. Add `documentLinks: readonly DocumentLink[]`, where each entry
contains `kind` (`spec` or `plan`) and `url`. Sample summaries supply the
equivalent defaults and retain their existing in-page artifact links.

Keep PR anchors and document anchors separate from the main issue anchor. Use
safe HTTP/HTTPS links and `rel="noopener noreferrer"`. Reject executable URLs.
Never expose issue bodies, raw run records, internal absolute paths, or private
logs in board JSON. Do not copy raw run summaries into blocked reasons. Use “The
run needs attention.” for observed blocked or stopped-needsInfo work. Keep the
explicit incomplete-run reason defined above.

Unknown values remain null or empty arrays. A real summary never uses `waiting`
or `paused` without current evidence. This slice does not create either state.
Local parsing errors affect the damaged issue's optional run data, not the whole
board. Report a short warning without copying private record contents.

## Cache and refresh contract

One provider instance belongs to the server, not to a request or browser. It
owns a shared cache for the open issues and open PRs. Both API routes use it.

- A cache period is exactly 60,000 milliseconds.
- Concurrent cold or expired requests share one in-flight host refresh.
- At most one `listOpenIssues()` invocation starts in each cache period.
- Open PR refreshes use the same period and do not fan out per issue.
- Failed refreshes also consume the period. Browser retries cannot bypass it.
- After a failed refresh, retain the last successful host data and its
  timestamp.
- Without any successful host data, return the existing generic API error.
- Set `syncedAt` only after a successful host refresh, not after a local file
  read.

Local progress, local roles, and lock probes run for each snapshot. Concurrent
snapshot requests can share in-flight local work, but a settled host cache must
not freeze local observations for a minute. Revision changes track projected
data, not the wall clock or a request counter. Snapshots are immutable.

Keep the existing 15,000-millisecond visible-tab polling and stale-response
guard. A hidden tab stops polling. Returning to it refreshes once before polling
resumes. The browser shows `synced N s ago`, using whole nonnegative seconds
since `syncedAt`. A lightweight clock updates this text without redrawing the
board. Sample mode continues to say `Sample data`, without a fake sync time.

An initial host failure shows the existing error and Retry UI. A later failure
leaves the last successful board available, with its increasingly old sync time.
Authentication loss stops requests and keeps the existing printed-link guidance.

## Command behavior

Accept `patchmill serve [--sample] [--host HOST] [--port PORT]`. Preserve
existing host and port validation. Reject duplicate flags and values supplied to
`--sample`.

Without `--sample`, load the repository config and create the selected host
adapter. Use the current directory as the repository root, consistent with
`run-once`. Resolve repository identity and public URLs through existing host
capabilities. Missing config or host metadata produces a short startup error,
not sample data.

With `--sample`, do not load config, run Git commands, or contact a host.
Samples still work from an unrelated directory. Print
`Patchmill sample data: URL` for samples and `Patchmill board: URL` for real
data. Update help and the README. The printed authenticated link, listener
defaults, and shutdown behavior remain.

## Page design and issue placeholder

Frontend design applies: real Live markers, synchronization text, links, and the
unavailable-thread state change browser-visible behavior. No layout redesign is
needed. Preserve the #301 typography, tokens, themes, dimensions, and focus
rules. The approved visual system overrides generic frontend-design style
preferences.

The palette remains night `#08090b`, panel `#121418`, brass `#c4a882`, green
`#39c96b`, and red `#ff4c4c` in the dark theme. The light theme retains its
darker accents. Product fonts remain the packaged Atkinson families.

```text
Patchmill | repository                  synced 12 s ago | theme | name
Triage | Ready | Planning | Planning review | Implementing | Code review | Blocked
#N title         Live        Spec / Plan / Spec PR / Plan PR / PR links

Board > #N title                                         header control
workflow rail | observed status | PR links

                       Thread not available yet
                  Real issue threads come in a later update.

message box or the existing terminal/finished view-only note
```

Real issue responses contain matching summary data and empty thread,
participant, and artifact-preview arrays. Final usage is null. The browser uses
`source: "live"` to show the placeholder instead of “No run yet.” It does not
reuse sample conversations. Keep existing header-control and terminal/finished
exceptions. Otherwise, retain the message box but disable submission with a
view-only explanation. Controls show “This comes with live chat. Nothing
changed.” They never send mutations.

The desktop board keeps columns at least 268px wide. The board scrolls inside
its region on mobile. Keep keyboard focus visible and respect reduced motion.
The sync text can retain the existing narrow-screen hiding rule. It must not
become an announcement every second to screen-reader users.

The companion uses representative fixture states, not a claim about current
GitHub status. It includes active review and active blocked cards to demonstrate
that Live does not select a column.

## Verification contract

Automated tests must prove behavior, not document wording or static config text.
Use temporary current-format run files and real child-process locks where
needed.

- Cover every column rule, each adjacent precedence pair, Blocked against every
  other column, and unsuitable against all competing evidence.
- Cover custom role names, retired labels, unrelated labels, and local workflow
  mode.
- Cover active, exited, and unlocked live-PID records, plus damaged lock
  diagnostics.
- Cover progress identity/version errors, newer attempts, absent files, atomic
  replacement, older result fallback, and observation-write errors.
- Cover open/merged/closed PR evidence, same-name fork heads, base mismatch,
  issue-number boundaries, pagination, and PR refresh without local refs.
- Cover safe document URLs, missing Git refs, title edits, and custom artifact
  paths.
- With a fake clock and deferred host responses, cover shared cold/expired cache
  requests, 59,999/60,000 boundaries, rejected refreshes, and stale timestamps.
- Prove local file and Live changes appear inside a warm host-cache period.
- Cover source selection, sample mode outside a repository, the live
  placeholder, link navigation, sync-age updates, and existing no-mutation
  behavior.

During implementation, inspect this repository's real board in a browser.
Compare its numbers, titles, and labels with
`gh issue list --state open --limit 1000`. Compare columns and Live markers with
current progress, results, and issue locks. Account explicitly for excluded
unsuitable issues and the host-cache timestamp. Do not start or change a
production run merely to obtain a screenshot.

Capture desktop and 390px evidence in both themes. Include the issue placeholder
and at least one Live card, using a temporary fixture repository if necessary.
Use the normal visual-evidence and frontend-review skills after implementation.
Run `npm test`, `npm run check:types`, `npm run lint`, and the existing sample
browser check. No dependency change is planned. If implementation changes npm
dependencies, rerun the Nix build as repository policy requires.

This planning stage validates documents and the offline companion only. Product
behavior and the full test suite belong to implementation.

## Companion artifacts

- `docs/mockups/2026-11-14-issue-302-real-board.html`:
  [Offline full-page board and issue placeholder](../mockups/2026-11-14-issue-302-real-board.html)
