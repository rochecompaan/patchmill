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

```
.patchmill/state/
  issues/sync.json        sync cursor
  issues/<n>.json         one issue with its comments and dependencies
  status/<n>.jsonl     status changes for issue <n>, appended only
```

`issues/` is a copy of upstream. It can be deleted and fully synced again.
`status/` is Patchmill's own record. Nothing can rebuild it, and Patchmill never
edits or deletes lines in it.

### Entities

```
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
 │ labels[], assignees[]   │               │ runId?                          │
 │ createdAt, updatedAt    │               │ summary?                        │
 └──┬───────────────┬──────┘               │ cost?                           │
    │ *             │ *                    │ warnings?[]                     │
 ┌──▼────────┐  ┌───▼────────────┐         │ questionUrl?                    │
 │ Comment   │  │ Dependency     │         └─────────────────────────────────┘
 │ id        │  │ repository     │
 │ author    │  │ number         │
 │ body      │  │ state          │
 │ createdAt │  └────────────────┘
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

The file is appended only, not overwritten, so `patchmill status --issue N` can
show the history that the issue timeline shows in label mode.

## Sync

A sync module reads upstream and writes `issues/`. It is used only in local
mode.

- **First sync:** if `issues/sync.json` is missing, fetch every issue in every
  state, all issue comments, and all dependencies. Write one file per issue and
  then the cursor.
- **Later syncs:** fetch issues and comments updated since `syncedUpTo`. Rewrite
  each changed issue's file in full.
- **Cursor:** set `syncedUpTo` to the start time of the sync request, not its
  end time, so changes made during a sync are fetched again next time. Write the
  cursor only after all issue files are written. A failed sync leaves the old
  cursor, so the next sync repeats the work.
- **Pull requests:** GitHub's issue list includes pull requests. Skip them.
- **When:** `triage` and `run-once` sync before selecting or reading issues. If
  sync fails, the command stops with the error and does nothing else.
  `patchmill status` reads local state without syncing and shows `syncedUpTo`.
- **Explicit issues:** `--issue N` also refreshes issue N directly after the
  sync, so a just-created issue is present even if the list call lags.

Measured cost on a private GitHub repository (482 issues and pull requests, 296
comments, two months old): the full sync took about 12 seconds and 11 API calls.
An incremental sync over 24 hours of changes (33 items, 7 comments) took 1.7
seconds. An incremental sync with no changes took 0.7 seconds.

Known gaps for the builder to settle:

- Incremental `since=` does not report deleted comments or deleted issues.
  Accept this for the first version. A full resync (delete `issues/`) recovers.
- It is unverified whether adding or removing a native dependency updates an
  issue's `updatedAt` on GitHub and on Forgejo. If it does not, refresh
  dependencies for all open issues on every sync. On GitHub this was one GraphQL
  query of about 3 pages (`blockedBy` on `repository.issues`).
- Forgejo needs the same calls through `tea` or its API. Gitea's issue list
  accepts `since`. Verify the comment endpoint does too.

## Workflow state interface

Add a kernel interface used by triage, run-once, review wait, release, and
status. Sketch:

```ts
type WorkflowState = {
  sync(options?: { issue?: number }): Promise<void>;
  issue(n: number): Promise<Issue>;
  status(n: number): Promise<StatusChange | undefined>;
  dependencies(n: number): Promise<IssueDependency[]>;
  triageCandidates(trusted: string[]): Promise<Issue[]>;
  runCandidates(): Promise<Issue[]>; // ready or inProgress, oldest first
  setStatus(n: number, change: StatusChange, question?: string): Promise<void>;
};
```

In label mode `setStatus` swaps labels and posts the kernel comment as today. In
local mode it posts `question` upstream if given, then appends the line.

The exact shape is the builder's.

`WorkflowState` is the only path for workflow status. Kernel code uses it for
every status change and for every read that depends on status or on the synced
issue copy. Kernel code no longer calls `host.setLabels`, `host.createLabel`, or
`host.commentIssue` directly. A factory picks the backend from
`workflow.stateTracking` once per command, the same way `createHost` picks the
provider from `host.provider`.

- **Label backend:** wraps today's calls with no behaviour change. `sync` does
  nothing. Reads go to the host as today.
- **Local backend:** reads from `issues/` and `status/`, appends status changes,
  and posts upstream only the questions described below.

These stay outside `WorkflowState` because they are not workflow status:

- Writes on `Host` in both modes: `addIssueDependency`, `updatePullRequestBody`
  (cost report), pull request creation by skills, and ticket creation.
- Label tools that work on labels directly: `patchmill labels setup`, the
  `doctor` label check, and the `patchmill-label` skill. They are label-mode
  tools. In local mode they refuse or skip, as described under Labels and
  doctor.

## Behaviour in local mode

### Triage

- Candidates: open issues with no status file, plus `needsInfo` issues with a
  reply. A reply is a comment created after the last line's `at` by a trusted
  author (`host.login` or `host.trustedAuthors`) that is not the comment at
  `questionUrl`. Today's rule ("latest comment is trusted and not a kernel
  comment") does not work here, because Patchmill's own question is posted as
  `host.login` without the kernel marker.
- `--issue N` triages issue N regardless of status, as today.
- Patchmill adds missing dependency links upstream as today.
- If the outcome is `needsInfo` and the triage comment is not empty, Patchmill
  posts it upstream without the kernel marker and records its URL as
  `questionUrl`. For `ready` and `unsuitable`, it posts nothing and keeps the
  comment as `summary`.
- It never calls `ensureLabels`.
- If the dependency write fails, append nothing and warn, as label mode skips
  the label today.
- Dry run syncs, calls Pi, and previews. It appends nothing and writes nothing
  upstream. It does update `issues/`, which is a copy of upstream.

_Builder's call taken here: dry run still syncs. Sync is a read of upstream and
the dry run should see current issues._

### Issue runs

- Selection uses `runCandidates`: `ready` or `inProgress` issues, oldest first,
  skipping issues with open or unreadable dependencies from the synced data.
  `--issue N` runs any open issue, as today.
- Claim appends `inProgress` with the run ID. The "claimed elsewhere" check
  becomes "issue is open in the synced copy". The per-issue lock already guards
  local concurrency.
- At each point where today's loop calls `host.viewIssue`, local mode refreshes
  that one issue from upstream into `issues/<n>.json` and reads it back. This
  keeps comments current during a run without a full sync.
- Wherever label mode releases or swaps labels, local mode appends the same
  status with the summary, cost, and warnings label mode would comment. This
  covers planning gate waits (`inProgress`), completion (`done`), stops, and
  review wait outcomes. The cost report still goes in the pull request body.
- Upstream, local mode posts only when a run stops with `needsInfo` because the
  worker returned `needs-input`. It posts the worker's summary as a question,
  without the kernel marker or status lines, and records `questionUrl`. Errors,
  failed verification, gate waits, and completion post nothing.
- Console guidance still goes to the worker. It is written to the run log, not
  posted.

### Release

`patchmill release --issue N` appends `ready` if the current status is
`inProgress`, otherwise prints "nothing to release".

### Labels and doctor

- `patchmill labels setup` exits with a message that local state mode does not
  use labels.
- The `patchmill-label` skill already reads `patchmill.config.json`. In local
  mode it tells the user that Patchmill does not use labels and changes nothing.
- `patchmill doctor` skips the labels check and instead checks that
  `.patchmill/state/` is writable and reports `syncedUpTo`.

### Status command

`patchmill status` lists issues with local workflow state, grouped by status,
with issue number, title, and the time of the last change. It also prints
`syncedUpTo`. Closed issues are hidden unless `--all` is passed.

`patchmill status --issue N` prints the issue's title, upstream state, current
status, and every status change in order with its run ID, summary, cost,
warnings, and question URL.

In label mode, `patchmill status` prints that it requires local state mode.

_Builder's call taken here: `status` reads local data only and does not sync, so
it is fast and works offline._

## Failure handling

_All of this section is the builder's call, settled here so the plan does not
guess._

- **Wrong repository.** Before syncing, compare `sync.json` `repository` with
  the host repository. If they differ, stop with an error that names both and
  tells the user to move `.patchmill/state/` aside. Do not sync or write.
- **Missing issue file.** If `sync.json` exists but `issues/<n>.json` is missing
  for an issue Patchmill needs, refresh that issue from upstream.
- **Corrupt issue file or cursor.** Treat it as missing. The `issues/` copy can
  always be fetched again. A corrupt `sync.json` triggers a full sync.
- **Corrupt status file.** Status files are never repaired or rewritten. If the
  last line has no trailing newline and does not parse, it is a write cut off by
  a crash: ignore it and warn with the file path. Any other line that does not
  parse stops the command with the file path and line number.
- **Question comment, then status change.** Post the upstream question first,
  then append the line with its `questionUrl`. If the append fails, report the
  error with the comment URL. The issue keeps its previous state, so a later
  triage or run may ask again. A duplicate question is accepted over a status
  change that points at nothing.
- **Refresh failure during a run.** Treat it as label mode treats a failed
  `viewIssue` today: the run attempt stops with `needsInfo` and the error as
  summary. Append `needsInfo` and post nothing.

## Constraints

- No new runtime dependency. JSON and JSONL files with the existing file
  utilities.
- Write issue files and the cursor atomically (write a temporary file, then
  rename). Append each status change with a single write.
- Label mode output, upstream writes, and tests stay unchanged.
- Skills keep their current rules. They already never change labels or post
  issue comments. Envelopes in local mode omit the "Labels" line or show
  upstream labels only, never workflow state.

## Left to the builder

- Module layout for the sync module, local backend, and status command.
- Exact `WorkflowState` interface and how `run-once.ts`, `triage.ts`,
  `publish.ts`, `review-wait.ts`, `interactive-loop.ts`, and `release` are
  changed to use it.
- Host additions needed for sync (listing all issues and comments since a time,
  bulk dependencies) for GitHub and Forgejo.
- Wording of question comments without the kernel marker.
- Status output layout.
