# Local issue state design

## Intent

Some teams will not adopt Patchmill because it uses their issue tracker as its
database. It creates workflow labels, swaps them as issues move, and posts
status comments. These teams accept Patchmill acting like a team member who
comments to ask questions, opens pull requests, and creates tickets. They do not
accept it storing its own workflow state upstream.

This design adds a **local state mode**. Patchmill keeps its workflow state on
disk in the repository checkout. It syncs issue data from the upstream tracker
so triage and runs see current issues. Upstream writes are limited to what a
person would do.

The local store is also the first step toward shared state. The expected future
is a central database that tracks issue state. It is not merging local stores
from several machines. Design for a clean import into such a database, and add
nothing more for it.

## Goals

- A user chooses local state mode explicitly in `patchmill.config.json`.
- In local state mode, Patchmill never creates, adds, or removes labels, and
  never posts status comments.
- Patchmill still posts comments that ask a human a question to unblock work,
  opens pull requests, adds cost reports to pull request bodies, creates
  tickets, and adds native dependency links ("Blocked by" on GitHub, "Depends
  on" on Forgejo).
- Patchmill syncs all issues from upstream on first use, then only issues that
  changed since the previous sync.
- Triage and issue runs sync before they read issue state.
- `patchmill status` shows local workflow state for all issues, and the full
  status history for one issue.

## Non-goals

- Removing label mode. Label mode stays the default and behaves as it does
  today. A later refactor may remove it.
- Handling several runners on different machines. Local state mode serves one
  user on one machine. The existing per-issue lock still prevents two local run
  attempts on the same issue.
- Reacting to upstream changes made after triage. Triage and runs use whatever
  the synced copy holds when they start. Later changes are seen on the next
  triage.
- Shared or central state. No replica IDs, merge rules, or per-record repository
  fields.
- Migrating between modes. Switching modes starts from empty local state, or
  ignores local state when switching back. No label import or export.

## Anti-goals

These make the feature a failure even if it works:

- Any workflow label or status comment appears upstream in local state mode.
- Label mode changes behaviour for existing users.
- Triage or a run acts on issue data that was not synced at the start of that
  command.

## Configuration

Add one key:

```json
{ "workflow": { "stateTracking": "labels" } }
```

- `"labels"` (default): today's behaviour.
- `"local"`: local state mode.

The config reader rejects any other value. In local mode the `labels.*` keys are
accepted and ignored.

_Builder's call taken here: key name and location. `workflow` already holds
run-behaviour settings._

## Approaches considered

**A. Fake labels behind the `Host` interface.** Wrap the host so `setLabels` and
`createLabel` write to a local file, and reads merge local labels back into
issues. Drop status comments by matching the kernel comment marker. Smallest
change, but labels remain the state vocabulary, status changes lose their
summary and run details, comment filtering relies on string matching, and
`patchmill status` has little to show.

**B. A workflow-state interface with two backends (chosen).** The kernel calls
one interface for status changes and state queries. A label backend wraps
today's label and comment calls. A local backend appends status changes to a
file per issue. A separate sync module keeps local issue data current.

**C. Build the Event ledger first.** Implement the roadmap's Phase I ledger and
make local mode one of its projections. This is the long-term design, but it
adds usage, budget, and coordinator scope this feature does not need.

The user chose B. Label mode keeps working unchanged behind the interface, and
local mode stores the same five statuses as dated lines that can later be
imported into a central database.

## Storage

All local state lives under `.patchmill/state/` in the repository root. One
directory belongs to one repository, so records do not repeat the repository.
Add `.patchmill/state/` to `.gitignore` in this repository and to the ignore
entries `patchmill init` manages.

```text
.patchmill/state/
  issues/.lock            cache lock
  issues/sync.json        sync cursor
  issues/<n>.json         one issue with its comments
  status/<n>.jsonl     status changes for issue <n>, appended only
```

`issues/` is a copy of upstream. It can be deleted and fully synced again.
`status/` is Patchmill's own record. Nothing can rebuild it, and Patchmill never
edits or deletes lines in it.

### Entities

```text
 ┌─────────────────────────┐
 │ SyncCursor              │  issues/sync.json
 │ repository   owner/repo │
 │ fullSyncAt   timestamp  │
 │ syncedUpTo   timestamp  │  next incremental sync asks for changes since this
 └─────────────────────────┘
 ┌─────────────────────────┐ 1          *  ┌─────────────────────────────────┐
 │ IssueSnapshot           │◄──────────────┤ StatusChange                    │
 │ number             PK   │               │ at           timestamp          │
 │ title, body, url        │               │ status       ready|inProgress|  │
 │ state  open|closed      │               │              needsInfo|done|    │
 │ author                  │               │              unsuitable         │
 │ labels[]                │               │ runId?                          │
 │ createdAt               │               │ summary?                        │
 └──┬──────────────────────┘               │ cost?                           │
    │ *                                    │ warnings?[]                     │
 ┌──▼────────┐                             │ questionUrl?                    │
 │ Comment   │                             └─────────────────────────────────┘
 │ id, url   │
 │ author    │
 │ body      │
 │ createdAt │
 │ updatedAt │
 └───────────┘
```

`SyncCursor` stores `repository` (`owner/repo`). It is the one place the
repository is recorded. See Failure handling.

`IssueSnapshot` labels and assignees are upstream data for display and for
skills. Patchmill never derives workflow state from them in local mode.

### Status changes

Each line of `status/<n>.jsonl` is one `StatusChange`. It stands for one label
change in label mode, plus the content of the comment that label mode would post
with it. The five statuses are the five configured labels:

| Status       | Label mode         |
| ------------ | ------------------ |
| `ready`      | `agent-ready`      |
| `inProgress` | `in-progress`      |
| `needsInfo`  | `needs-info`       |
| `done`       | `agent-done`       |
| `unsuitable` | `agent-unsuitable` |

- An issue with no file is untriaged, like an issue with no workflow label.
- The current status is the last line. Nothing is replayed or derived beyond
  that.
- Patchmill appends a line wherever label mode changes labels today. A label
  swap is one line with the new status.
- `summary`, `cost`, and `warnings` hold what label mode puts in its kernel
  comment, such as the triage comment, the stop summary, or the gate wait
  message.
- `questionUrl` is set when Patchmill posted a question upstream with this
  change. The reply rule uses it to skip Patchmill's own comment.
- Console guidance is not a status change. It goes to the run log in
  `.patchmill/runs/` with the rest of the run's evidence.

A record is complete when it ends with a newline. Complete records are never
changed, so `patchmill status --issue N` can show the history that the issue
timeline shows in label mode. Bytes after the last newline are a write cut off
by a crash. Reads ignore them, and the next append discards them before it
writes. Each append holds a short lock on the status file, so the discard and
the write cannot interleave with another append.

## Sync

A sync module reads upstream and writes `issues/`. It is used only in local
mode. Each sync holds an exclusive lock on `issues/.lock` from the repository
check through writing the cursor and removing damaged copies. A standalone issue
refresh takes the same lock. Concurrent commands on one machine therefore update
the cache one at a time.

- **First sync:** if `issues/sync.json` is missing or unreadable, fetch every
  issue in every state and all issue comments. Write one file per issue and then
  the cursor.
- **Later syncs:** fetch issues and comments updated since `syncedUpTo`. Replace
  the issue fields of each changed issue and add or replace its changed comments
  by comment URL.
- **Cursor:** set `syncedUpTo` to the start time of the sync request, not its
  end time, so changes made during a sync are fetched again next time. Ask for
  changes since five minutes before `syncedUpTo`, so a local clock that runs
  ahead of the host does not skip changes. Fetching a change twice is harmless.
  Write the cursor only after all issue files are written. A failed sync leaves
  the old cursor, so the next sync repeats the work.
- **Damaged copies:** before a later sync, look for issue files that do not
  parse or have invalid fields, including an issue number that differs from the
  file name. An unchanged issue never appears in an incremental response, so a
  damaged copy would hide it from selection. If any file is damaged, run a full
  sync instead, which rewrites every issue file. Then remove damaged files for
  issues the host did not return, with a warning. The cursor moves only after
  this succeeds. If it fails, the command stops, so no work is selected from an
  incomplete copy. Status files are never touched.
- **Pull requests:** GitHub's issue list includes pull requests. Skip them.
- **Dependencies are not synced.** Triage and run selection read them from the
  host for each issue they consider, as label mode does today. This avoids
  relying on dependency changes updating an issue's `updatedAt`, which is
  unverified, and keeps the first sync to a few list calls.
- **When:** `triage` and `run-once` sync before selecting or reading issues. If
  sync fails, the command stops with the error and does nothing else.
  `patchmill status` reads local state without syncing and shows `syncedUpTo`.
  It reads blockers of ready and in-progress issues live from the tracker.
- **Explicit issues:** `--issue N` also refreshes issue N directly after the
  sync, so a just-created issue is present even if the list call lags.

Measured cost on a private GitHub repository (482 issues and pull requests, 296
comments, two months old): the full sync took about 12 seconds and 11 API calls.
An incremental sync over 24 hours of changes (33 items, 7 comments) took 1.7
seconds. An incremental sync with no changes took 0.7 seconds.

Known gaps for the builder to settle:

- Incremental `since=` does not report deleted comments or deleted issues.
  Accept this for the first version. Deleting `issues/` forces a full resync,
  which recovers.
- Forgejo needs the same calls through `tea` or its API. Gitea's issue list
  accepts `since`. Verify the comment endpoint does too.

## Workflow state interface

`WorkflowState` stores and reads workflow status. It knows nothing about triage
or runs. Triage and runs own every policy: which issues are candidates, what
counts as a reply, which status an outcome sets, and when a question is asked.

```ts
type TrackedIssue = Issue & {
  status: WorkflowStatus | "untriaged";
  /** When the status was set. Local mode only; labels carry no timestamp. */
  statusSince?: string;
  comments: (IssueComment & { fromPatchmill: boolean })[];
};

type StatusUpdate = {
  status: WorkflowStatus;
  runId?: string;
  summary?: string;
  cost?: string;
  warnings?: string[];
  /** Text to ask a human before recording the status. */
  question?: string;
};

interface WorkflowState {
  sync(issue?: number): Promise<void>;
  openIssues(): Promise<TrackedIssue[]>;
  issue(n: number): Promise<TrackedIssue>;
  /**
   * Rejects when the status was not recorded. Resolves to warnings about
   * optional comments that failed after the status was recorded. When question
   * is set, posting is required before recording; a posting failure rejects
   * and leaves the status unchanged.
   */
  setStatus(n: number, update: StatusUpdate): Promise<string[]>;
}
```

`openIssues` may return issues without comments, as `listOpenIssues` does today.
Callers that need comments read the issue with `issue(n)`.

`WorkflowState` is the only path for workflow status. Kernel code uses it for
every status change and every issue read. Kernel code no longer calls
`host.setLabels`, `host.createLabel`, `host.listOpenIssues`, `host.viewIssue`,
or `host.commentIssue` directly. A factory picks the backend from
`workflow.stateTracking` once per command, the same way `createHost` picks the
provider from `host.provider`. Triage and run dependencies require an explicit
`WorkflowState`; they never select a backend themselves.

The backends answer only storage questions:

| Question        | Label backend                                              | Local backend                                           |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| `sync`          | Does nothing                                               | Syncs `issues/`                                         |
| `status`        | The workflow label on the issue, or `untriaged`            | The last status line, or `untriaged`                    |
| `statusSince`   | Not set                                                    | The last line's `at`                                    |
| `fromPatchmill` | The comment contains the kernel marker                     | The comment's URL is a `questionUrl` in the status file |
| `setStatus`     | Ensures labels exist, swaps labels, posts a kernel comment | Posts non-blank `question` text, then appends a line    |

The label backend's swap adds the new status's label and removes the other four
workflow labels, so an issue carries exactly one. It posts a kernel comment
whenever the update has a summary:

```text
<KERNEL_COMMENT>

Issue #<n>: <label>

<summary>

<cost>

<warnings, one per paragraph>
```

Empty parts are left out.

### Write failures

Write failures use ordinary error handling. `setStatus` rejects when the status
was not recorded, and each caller handles that as it handles a failed label
write today:

- Triage warns and skips the issue. It does not count it as applied. Warnings
  that `setStatus` resolves to are printed, and the issue counts as applied.
- `release` prints the error and exits 1.
- A run stop records the error as a publication error. The run still writes its
  result and summary and exits 1, as it does for publication errors today.

Questions and comments:

- **With `question`, the question is required.** Both backends post it before
  they change the status. If posting fails, `setStatus` rejects and the status
  is unchanged, so a later triage or run asks again. If the question was posted
  but the status write fails, the error includes the comment URL.
- **Without `question`, the label backend's kernel comment is optional.** The
  label backend swaps labels first. A failed swap rejects, and no comment is
  posted. A failed comment after a successful swap is returned as a warning.
- The local backend posts nothing without `question` or when it is only
  whitespace, so it returns no warnings. It posts non-blank question text
  exactly as given and keeps the full summary in the status line.

`host.commentIssue` returns the new comment's URL. The local backend records it
as `questionUrl`. Other callers ignore it.

### Shared rules

Triage owns the reply rule, and it is the same in both modes. A `needsInfo`
issue has a reply when its latest comment is by a trusted author (`host.login`
or `host.trustedAuthors`), is not `fromPatchmill`, and, when `statusSince` is
set, was created after it. Label mode does not need `statusSince`, because a
kernel comment always follows a status change there. Local mode does, because
most status changes post nothing, so an old trusted comment could otherwise look
like a reply.

Console guidance is not workflow status. In both modes it goes to the worker and
to the run log in `.patchmill/runs/`. It is no longer posted as an issue
comment.

These stay outside `WorkflowState` because they are not workflow status:

- Writes on `Host` in both modes: `addIssueDependency`, `updatePullRequestBody`
  (cost report), pull request creation by skills, and ticket creation.
- Label tools that work on labels directly: `patchmill labels setup`, the
  `doctor` label check, and the `patchmill-label` skill. They are label-mode
  tools. In local mode they refuse or skip, as described under Labels and
  doctor.

## Behaviour in local mode

### Triage

- Candidates: open `untriaged` issues, plus `needsInfo` issues with a reply,
  using the shared reply rule.
- `--issue N` triages issue N regardless of status, as today.
- Patchmill adds missing dependency links upstream as today.
- Triage sets the outcome status with the comment as `summary`, and with
  `question: comment` for a `needsInfo` outcome with a non-empty comment. In
  local mode that posts the question without the kernel marker and records
  `questionUrl`. For `ready` and `unsuitable`, nothing is posted.
- If the dependency write fails, append nothing and warn, as label mode skips
  the label today.
- Dry run syncs, calls Pi, and previews. It appends nothing and writes nothing
  upstream. It does update `issues/`, which is a copy of upstream.

_Builder's call taken here: dry run still syncs. Sync is a read of upstream and
the dry run should see current issues._

### Issue runs

- Selection filters `openIssues` to `ready` or `inProgress`, oldest first,
  skipping issues with open or unreadable dependencies read from the host, as
  today. `--issue N` runs any open issue, as today.
- Claim sets `inProgress` with the run ID, then reads the issue back. The run
  continues only if the issue is open and `inProgress`; otherwise it was claimed
  elsewhere. The per-issue lock already guards local concurrency.
- In local mode, `issue(n)` refreshes that one issue from upstream into
  `issues/<n>.json` and reads it back. This keeps comments current during a run
  without a full sync.
- Planning gate waits, completion, stops, and review wait outcomes each set the
  status with the summary, cost, and warnings. The cost report still goes in the
  pull request body.
- A run sets `question` to the worker's summary only when it stops with
  `needsInfo` because the worker returned `needs-input`, no maintainer is at the
  console, and the session neither aborted nor timed out. In a console run the
  maintainer already sees the worker's question. So in local mode, errors,
  failed verification, gate waits, and completion post nothing.

### Release

`patchmill release --issue N` sets `ready` if the current status is
`inProgress`, otherwise prints "nothing to release". It works the same in both
modes.

### Labels and doctor

- `patchmill labels setup` exits with a message that local state mode does not
  use labels.
- The `patchmill-label` skill already reads `patchmill.config.json`. In local
  mode it tells the user that Patchmill does not use labels and changes nothing.
- `patchmill doctor` skips the labels check and instead checks that
  `.patchmill/state/` is writable and reports `syncedUpTo`.

### Status command

`patchmill status` lists issues with local workflow state under In Progress,
Needs Info, Ready, Done, and Unsuitable headings with counts. Each row has
aligned issue number, title, and last-change date columns. Blank lines separate
groups. It first prints the last sync time. Dates use local time, for example
`8 Nov 2026, 16:46`. Terminals use colored headings and dim dates unless
`NO_COLOR` is set. Closed issues are hidden unless `--all` is passed.

Blockers of shown open ready and in-progress issues are read live from the
tracker by default, after checking the local state's repository. Up to eight
lookups run at once. Only open dependencies appear, below the issue title;
dependencies in other repositories include their owner and repository. A failed
lookup prints a warning and `Blockers unknown` for that issue. A repository
check failure prints one warning, marks all candidates' blockers unknown, and
skips dependency lookups. These failures do not hide local rows or fail the
command.

`patchmill status --issue N` prints the issue's title, upstream state, current
status, and every status change in order with its run ID, summary, cost,
warnings, and question URL. Blank lines separate changes, and multi-line
summaries align under the summary text. Any open issue's blockers are read live
in this view, regardless of status.

In label mode, `patchmill status` prints that it requires local state mode.

_User decision: `status` does not sync, but reads blockers live by default. The
list needs no network when no shown open issue is ready or in progress._

## Failure handling

_All of this section is the builder's call, settled here so the plan does not
guess._

- **Wrong repository.** Before syncing, compare `sync.json` `repository` with
  the host repository. If they differ, stop with an error that names both and
  tells the user to move `.patchmill/state/` aside. Do not sync or write.
- **Missing issue file.** If `sync.json` exists but `issues/<n>.json` is missing
  for an issue Patchmill needs, refresh that issue from upstream.
- **Corrupt issue file or cursor.** Reads check JSON syntax and record fields.
  Cursor fields must be non-empty strings. Issue fields must have the expected
  types, an open or closed state, and a positive safe issue number matching the
  file name. Reads treat invalid records as missing. The next sync is a full
  sync, which rebuilds `issues/` before any work is selected (see Damaged copies
  under Sync).
- **Corrupt status file.** Complete records are never repaired or rewritten. If
  the last line has no trailing newline, it is a write cut off by a crash: reads
  ignore it and warn with the file path, and the next append discards it. Any
  complete line that does not parse or has invalid fields stops the command with
  the file path and line number. Status must be one of the five workflow
  statuses; the timestamp and optional text fields must be strings, and warnings
  must be a string array.
- **Question comment, then status change.** Post the upstream question first,
  then append the line with its `questionUrl`. If posting fails, the status is
  unchanged and the command reports the failure. If the append fails, report the
  error with the comment URL. In both cases the issue keeps its previous status,
  so a later triage or run may ask again. A duplicate question is accepted over
  a status change that points at nothing, or a status that waits for an answer
  to a question nobody received.
- **Status write failure.** The command reports it as an error, as described
  under Write failures. Nothing retries it.
- **Refresh failure during a run.** Treat it as label mode treats a failed
  `viewIssue` today: the run attempt stops with `needsInfo` and the error as
  summary. Append `needsInfo` and post nothing.

## Constraints

- No new runtime dependency. JSON and JSONL files with the existing file
  utilities.
- Write issue files and the cursor atomically (write a temporary file, then
  rename). Append each status change with a single write, under a short lock on
  the status file.
- Label mode stays the default and keeps working. It changes in four ways:
  - One label swap rule: every status change leaves exactly one workflow label,
    so `triage --issue N` on an in-progress issue now removes `in-progress`.
  - Triage comments use the shared kernel comment format, which adds the
    `Issue #N: <label>` line.
  - Console guidance is no longer posted as an issue comment.
  - On failure paths only: a failed label swap no longer posts the stop comment;
    a question is posted before the labels change, so a failed question leaves
    the labels as they were; and a failed triage comment after a successful swap
    now counts the issue as triaged, with a warning.
- Skills keep their current rules. They already never change labels or post
  issue comments. Envelopes in local mode omit the "Labels" line or show
  upstream labels only, never workflow state.

## Left to the builder

- Module layout for the sync module, local backend, and status command.
- How `run-once.ts`, `triage.ts`, `publish.ts`, `review-wait.ts`,
  `interactive-loop.ts`, and `release` are changed to use it.
- Host additions needed for sync (listing all issues and all comments since a
  time), and `commentIssue` returning the new comment's URL, for GitHub and
  Forgejo.
- Local mode posts only the question text without the kernel marker and keeps
  the full stop summary locally.
- Status output layout.
