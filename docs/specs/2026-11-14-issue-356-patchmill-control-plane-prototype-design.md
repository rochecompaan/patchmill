# Patchmill control-plane prototype design

- **Status:** Approved design
- **Issue:** #356
- **Replaces:** the 2026-09-23 draft of this design, which targeted the workflow
  engine that the skills-first kernel (#329) removed.
- **Builds on:** the skills-first kernel
  ([design](2026-10-15-skills-first-kernel-design.md)), the per-issue lock
  ([design](2026-10-16-issue-lock-design.md)), Interactive Issue runs
  ([design](2026-10-14-issue-225-interactive-issue-runs-design.md)), and local
  issue state mode ([design](2026-11-07-local-issue-state-design.md), PR #344),
  `patchmill serve` and its web board (#349, #355), and merged-issue cleanup in
  every run mode (#351).
- **Prepares for:** the web page in #300 and its mockup notes in
  `docs/mockups/web/run-once-workflow.md`.

## Context

Patchmill advances one issue per `run-once` command. Several processes cannot
safely share a repository today:

- **Label mode** claims an issue by swapping `agent-ready` for `in-progress` and
  reading it back. The kernel design accepts a narrow race between two
  checkouts.
- **Local state mode** claims an issue by appending `inProgress` to a status
  file in one checkout. Other checkouts never see that file. Each checkout also
  keeps its own status history and its own copy of the issues, so a `needsInfo`
  stop in one checkout is unknown in another.

Label mode also blocks adoption. Teams do not want Patchmill to use their issue
tracker as its database. Local state mode answers that, and its design names the
next step: "a central database that tracks issue state".

The web page in #300 needs the same central place. Its board shows every issue
and which runs are live. Its issue page shows each run's thread and, later, lets
people start planning, chat with the agent, and pause and resume runs. Its
mockup notes say runs should connect to the central process, not the other way
round, and that choices made now must still work when runs and that process are
on different hosts.

This prototype adds that central place, the **control plane**, and runs it on
one machine. Its transport already works across hosts, so a later cluster
deployment can run the control plane in its own container. Several **runners**
share it. Each runner has its own checkout and asks the control plane for work.

## Decision

Add a third state-tracking mode, `"control-plane"`. In this mode:

- **The control plane** is one `patchmill serve` process with one SQLite
  database. It holds the only Patchmill copy of the repository's issues, the
  workflow status log, assignments, the triage lock, and run events. It serves
  the control-plane API to runners and CLI commands. It extends today's
  `patchmill serve`, which already serves the web board from #301 and #302.
- **The control plane downloads issues** from the repository on GitHub or
  Forgejo every three minutes, with a read-only token.
- **The control plane holds one triage lock per repository.** A runner that
  takes the lock runs today's triage loop in its own checkout, then releases the
  lock. A poll that finds changes makes triage due. Triage never holds back
  issue selection.
- **The control plane does issue selection.** A runner with nothing of its own
  left to run asks for its next issue. The control plane selects one, assigns it
  to that runner, and hands it over in one transaction.
- **Each runner** is a long-running `patchmill run` process with its own
  checkout and a stable name. It runs the unattended issues assigned to it by
  calling `runOneIssue` in process. It keeps only the files it needs to do the
  work: the checkout, worktrees, Pi session files, and run logs. None of these
  record an issue's state.
- **Interactive runs start in a terminal** with `run-once --interactive` under a
  runner's name. They share that runner's capacity.
- Every run attempt opens a **run connection** to the control plane. It sends
  numbered events and receives commands.
- Issue and status reads and writes go through a new `WorkflowState` backend
  that calls the control plane. Triage, runs, and `status` keep using the same
  interface, unchanged.
- Writes to the repository stay as limited as in local state mode: questions,
  pull requests, cost reports, tickets, and dependency links. No workflow labels
  and no status comments. Runs make these writes with the runner's own token.
  The control plane never writes to the repository.

The control plane never starts processes. Runners and terminals pull work.

## Goals

- No two runners hold an active assignment for the same issue.
- At most one triage runs per repository. A poll that finds changes makes triage
  due, and triage never holds back issue selection.
- A runner holds several assignments, unattended and interactive, up to a cap
  that the control plane enforces.
- An assignment stays with its runner through gate waits, `needsInfo` stops,
  review wait, pauses, failures, and restarts.
- An assignment completes only after its pull request merges and the runner has
  cleaned up its worktree.
- Only an operator releases unfinished work, with a recorded reason. The one
  exception: a runner hands back an issue that it finds closed or blocked before
  it has started any work on it.
- Runners, commands, and the web page see one copy of the issues and one status
  history per issue.
- Runners keep no issue copy and no workflow status.
- The control plane has what #300's view slices need: issues, run events for
  threads, live markers, and pause flags.
- Control-plane and runner restarts lose nothing and need no local receipts.
- Runners fail closed when the control plane cannot confirm ownership.
- Label mode and local state mode behave exactly as today.

## Non-goals

- Coordination in label mode or local state mode.
- Importing existing `.patchmill/state/` files into the control plane.
- Cross-repository dependencies. An issue whose dependency is in another
  repository is treated as blocked.
- Priority in issue selection. Selection is oldest first.
- Changes to the web page. #301 and #302 added `patchmill serve` and its board.
  #303 and #304 add run threads and live progress. In control-plane mode this
  prototype only gives the board a new data source.
- A control plane without a checkout. `serve` runs in a checkout of the
  repository, as it does today. See Deferred cluster design.
- **Start planning** from the web page, and interactive runs hosted by a runner
  process instead of a terminal. Both need a human channel over the run
  connection, which needs #305 (Pi RPC mode). #305's design adds them. See
  Related work.
- Delivering chat messages, **Stop reply**, or a mid-session pause to a running
  Pi session. The protocol names these commands. #305 and the live-chat slices
  of #300 deliver them.
- Unattended `run-once`. Runners own unattended runs in this mode.
- Per-runner cap overrides.
- Kubernetes, containers, Tilt, Harbor, or Playwright.
- High availability or replication.
- TLS. The cluster design adds it or ends it at a proxy or service mesh.
- Webhooks from the repository. The control plane polls.
- Heartbeats, leases, expiry, or automatic reassignment of assignments. Only the
  triage lock has a lease. See When a triage lock is lost.
- Distributed fencing between machines that reuse one runner name.
- Budget, notifications, or the Event ledger (#230–#238).

## Terminology

**Control plane:** The `patchmill serve` process and its database. It is the
single authority for the issue copy, assignments, workflow status, and run
events in control-plane mode. It does issue selection. It runs no workflows and
never writes to the repository.

**Runner:** A long-running `patchmill run` process with its own checkout and a
stable, unique name. It asks the control plane for issues and runs them. The
same name must always use the same checkout. A runner belongs to one repository.
Interactive runs started in a terminal in that checkout use the same runner
name. This term replaces **Coordinator** in `CONTEXT.md`.

**Runner capacity:** The maximum number of active assignments one runner name
may hold, unattended and interactive together.

**Issue selection:** Choosing which issue a runner works on next. The runner
asks when it has nothing of its own left to run. The control plane selects and
assigns the issue.

**Triage lock:** The right to run triage for the repository, held by one runner
or person at a time.

**Assignment:** A record that one runner owns one issue. Its lifecycle state is
`active`, `completed`, or `abandoned`. Its mode is `unattended` or
`interactive`. An active assignment can be paused.

**Run connection:** The link from one Run attempt to the control plane. It
carries numbered events from the run and commands to it. An open connection
marks the run as live on the web page. It never decides ownership.

**Run event:** One numbered record a run sends over its run connection, such as
a snapshot, an output line, a notice, or a chat message. Run events are what the
web page shows as a run's thread.

**Status change:** One workflow status record, as in local state mode: status,
time, and optional run ID, summary, cost, warnings, and question URL.

The implementation replaces Coordinator with Runner in `CONTEXT.md`, and adds
Control plane, Runner capacity, Triage lock, Issue selection, Assignment, Run
connection, and Run event. Issues #230–#238 use "Coordinator". Their designs
should read it as Runner.

## Architecture

```text
        repository on GitHub or Forgejo
          ^  read-only: issues,                ^  runner's token: git, pull
          |  comments, dependencies            |  requests, questions, facts
          |                                    |
  +-------+-----------------------+    +-------+-----------------------+
  | patchmill serve               |    | runner local-0                |
  | (control plane)               |    |  checkout, worktrees          |
  |  issue download, every 3 min  |    |  unattended lane (1 run)      |
  |  issue selection, triage lock |<---+  triage lane (1 triage)       |
  |  control-plane API  :4281     |    |  Pi sessions, run logs        |
  |  web page (#349)    :4280     |    +-------------------------------+
  |  run data: snapshot, subscribe|    | runner local-1                |
  |  SQLite: issues, status,      |<---+  ...                          |
  |   assignments, triage lock,   |    +-------------------------------+
  |   runs, run events            |    | run-once --interactive        |
  |  checkout (read-only)         |    |  (terminal, runner local-0)   |
  +-------------------------------+<---+                               |
                ^                      +-------------------------------+
                |  web token (#300)
             browsers
```

Seven modules carry the design:

1. **Control-plane store.** It owns every SQLite transaction, including issue
   selection and the triage lock. HTTP handlers validate input and call it.
2. **Issue download.** It keeps the issue copy current from the repository and
   marks triage due when a poll finds changes.
3. **Run data.** A new `RunDataSource`, the read-only `snapshot` and `subscribe`
   interface that the board already uses. It reads the store and stored run
   events instead of the host board cache and `.patchmill/runs/`. The web page
   reads only through it.
4. **Control-plane client** in the runner and CLI. It hides HTTP and returns
   typed results. Tests replace it with an in-memory fake.
5. **`ControlPlaneWorkflowState`,** the `WorkflowState` backend for this mode.
   See Workflow state backend.
6. **Run link** in the runner. It opens one run connection per Run attempt,
   numbers and resends events, and turns commands into calls on the run.
7. **State-tracking modes.** One object per mode answers every mode-dependent
   question that commands ask: which `WorkflowState` backend to create, whether
   `release`, `labels setup`, plain `run-once`, and `run` are allowed, and which
   `doctor` checks apply. Commands ask this object instead of comparing
   `workflow.stateTracking` strings. The implementation first moves today's six
   `stateTracking === "local"` checks in `doctor`, `release`, `labels`,
   `run-once`, and the workflow factory onto it, then adds the control-plane
   mode.

## Configuration

Runner side, in `patchmill.config.json`:

```json
{
  "workflow": { "stateTracking": "control-plane" },
  "controlPlane": { "url": "http://127.0.0.1:4281" }
}
```

- `workflow.stateTracking` accepts `"labels"`, `"local"`, or `"control-plane"`.
- `controlPlane.url` is optional and defaults to the value above. It is rejected
  in other modes. `PATCHMILL_CONTROL_PLANE_URL` overrides it, so a container can
  point at a cluster service without changing the committed file.
- The runner name is not in `patchmill.config.json`, because every checkout
  shares that committed file. `patchmill run` and `run-once --interactive` take
  `--runner <name>` or `PATCHMILL_RUNNER`. A missing name is an error.
- The control-plane token is never in `patchmill.config.json`. See Transport and
  access.
- Triage keeps reading `host.trustedAuthors` and `host.login` from the runner's
  own `patchmill.config.json`, as today. The control plane does not need them.

Control-plane side: `patchmill serve` runs in a checkout whose
`patchmill.config.json` sets `workflow.stateTracking` to `"control-plane"`, and
then starts the control plane beside the web board. It adds these options:

- `--api-host <host>` and `--api-port <port>` set the control-plane API address.
  The default is `127.0.0.1:4281`. The existing `--host` and `--port` still set
  the web page address.
- `--db <path>` sets the database file. The default is
  `~/.local/state/patchmill/control-plane.db`.
- `--poll-interval <duration>` sets how often issues are downloaded. The default
  is three minutes.
- `--max-assignments-per-runner <n>` sets runner capacity. The default is 3. A
  runner cannot raise its own cap.
- The repository token comes from the provider's usual place, such as `GH_TOKEN`
  for `github-gh`, as for today's `serve`. A read-only token is enough.
- `--sample` is refused in control-plane mode.

## Transport and access

The control plane listens in two places:

- **Control-plane API** on HTTP, `127.0.0.1:4281` by default. Runners and CLI
  commands use it.
- **Web page** on HTTP, as `serve` provides it today: `127.0.0.1:4280` by
  default, the `PATCHMILL_SERVE_TOKEN` or a random token exchanged for an
  `HttpOnly`, `SameSite=Strict` cookie, and `Host` and `Origin` checks. Web
  handlers call the store and run data in process. They never call the
  control-plane API.

The two listeners use separate ports and separate tokens. People use the web
token. Processes use the control-plane token. A cluster can then expose the web
port to people and the control-plane port only to runner pods.

Control-plane access rules:

- **Every request needs the token,** including requests from loopback. The
  client sends `Authorization: Bearer <token>`. The control plane compares it in
  constant time and answers 401 without detail when it is missing or wrong.
  `/health` needs no token and returns no data, so container probes work.
- **Where the token comes from:** `PATCHMILL_CONTROL_PLANE_TOKEN`, or else the
  token file `~/.local/state/patchmill/control-plane.token`. On first start,
  `serve` creates the file with mode `0600` and a random 256-bit token. Clients
  read the same environment variable or file. In a cluster, the control plane
  and the runners get the variable from one Kubernetes Secret.
- **Listen address:** `--api-host` accepts any address, so the control plane can
  run in a container. A non-loopback address prints a warning that traffic is
  not encrypted. The prototype adds no TLS.
- **Request limits:** request bodies have a size limit, and event batches have a
  count limit. Requests over either get 413.
- **The token grants full control-plane access.** Per-runner credentials are
  deferred. A runner with the token can act as any runner.

Both listeners use `node:http` and add no npm dependency.

## Repository identity

One control plane serves one repository: the one its checkout belongs to. It is
named by a key:

```text
<provider>:<host>/<owner>/<repo>    e.g. github-gh:github.com/rochecompaan/patchmill
```

The control plane lowercases host, owner, and repository.

The control plane and every runner build the key the same way: from
`host.provider`, the `origin` remote's host name, and `Host.repository()`. Every
runner request carries the runner's key. A key that does not match the control
plane's is a conflict, so a runner in the wrong checkout cannot take work.

The control plane uses today's `Host` adapters from its checkout, as `serve`
does now, and only their read operations. It never writes to the checkout.

## Issue copy

The control plane keeps the only Patchmill copy of the repository's issues in
SQLite. It reuses the download rules of local state mode's sync module: a full
download first, then incremental downloads of changed issues and comments, and
the same handling of a damaged copy.

- **Every poll** downloads changed issues and comments, and the dependency links
  of every open issue whose status is `ready`. Dependency changes do not always
  change an issue's update time, so those links are downloaded each time.
- **The poll interval** is three minutes by default and configurable.
- **On request,** `WorkflowState.sync(n)` asks the control plane to download one
  issue now. Triage and runs use this as they use sync today.
- **A failed download** keeps the last good copy and is logged.

The copy can be up to one poll interval old. Issue selection works from it as it
is. A run that finds its newly assigned issue closed or blocked hands it back.
See Handing back an issue.

Each poll also downloads open pull requests, because the board shows them. In
control-plane mode the board reads this copy instead of the host board cache
from #355, so the repository is not read twice.

A run still reads git and the repository directly to derive its phase, as the
kernel requires. Those reads are fresh facts, not stored state. The issue copy
only decides what to select and what to show.

## Control-plane storage

The control plane uses `node:sqlite`. No other process opens the database file.

Tables:

- **`issues`, `comments`, `dependencies`:** the issue copy, with the time of the
  last successful download.
- **`assignments`:** UUID, issue number, runner, state, mode, paused flag,
  created, updated, completed, and abandoned timestamps, who abandoned it, and
  the reason.
- **`status_changes`:** an autoincrement ID that orders changes, issue number,
  the write ID, and the status change fields. Rows are only ever inserted.
- **`triage_lock`:** at most one row: the lock ID, the holder's name, the time
  it was taken, and the time its lease ends. It also keeps the due flag, set by
  polls and cleared when the lock is taken.
- **`runs`:** run ID, assignment ID, runner, issue, mode, origin (`runner` or
  `terminal`), started and ended timestamps, the time its command stream last
  closed, and the highest stored event number. This table is for display. It
  never decides ownership.
- **`run_events`:** run ID, event number, kind, time, and JSON body. Rows are
  only ever inserted.
- **`schema_version`.**

Constraints:

- A partial unique index allows one `active` assignment per issue.
- The triage lock table allows one holder.
- A unique key on run ID and event number makes event resends harmless.
- Runner capacity is checked inside every transaction that creates an
  assignment.

### Issue revision

Every issue the control plane returns carries an opaque `revision`: the ID of
the issue's latest status change, or a fixed value for an issue with none. Any
status change gives a new revision, so a writer that read the issue before
`needsInfo → ready → needsInfo` holds a stale revision even though the status
name is the same. Status writes must carry the revision. Only the control-plane
backend sees it. See Workflow state backend.

### Transactions

Every write uses `BEGIN IMMEDIATE`. The control plane enables WAL mode, a
bounded busy timeout, and full synchronization. Startup applies known forward
migrations and rejects an unknown schema version or a database made for another
repository. One control-plane process owns one database. No transaction waits on
the network.

## Assignment lifecycle

```text
            complete (PR merged, worktree cleaned)
  active ----------------------------------------> completed
   |  ^
   |  | pause / resume (flag, stays active)
   |  v
   | abandon with reason (operator, or the runner before it starts work)
   v
  abandoned
```

- Completed and abandoned are final for that record. A later assignment after
  abandonment creates a new record.
- A completed assignment is a tombstone. Issue selection skips that issue even
  if the issue copy still lists it as ready.
- Every active assignment counts toward runner capacity, whatever its mode,
  pause flag, or the issue's status. Worktrees, development environments, and
  review backlog are the resources the cap protects. A waiting interactive run
  uses no model tokens, but it holds a worktree.
- Pause is a flag, not a state. A paused assignment keeps its owner and its
  place.
- Mode can change from `unattended` to `interactive` when a terminal run takes
  over its own runner's assignment (see Terminal interactive runs). It never
  changes back.

Assignment state and workflow status are separate:

| Workflow status | Assignment | Meaning for an unattended assignment            |
| --------------- | ---------- | ----------------------------------------------- |
| `inProgress`    | active     | Run it. This includes gate waits.               |
| `ready`         | active     | Resume it, for example after a human answered.  |
| `needsInfo`     | active     | Wait for a reply and its triage.                |
| `done`          | active     | Review wait. Check for the merge.               |
| `done`          | completed  | Merged and cleaned up.                          |
| any             | abandoned  | Released by an operator. The runner ignores it. |

The runner never starts a run for a paused assignment, and never runs an
interactive assignment. Interactive assignments run only from a terminal.

## Triage

Triage decides whether each issue is `ready`, `needsInfo`, or `unsuitable`. In
control-plane mode, runners run today's triage loop. The control plane only
makes sure that one triage runs at a time and that it runs after changes.

### Why one triage at a time

Two triage runs at once can make a mess in two ways:

- **The same issue twice.** Both post questions, record different outcomes, and
  add duplicate dependency links.
- **Different issues at once.** Each run cannot see the other's decisions.
  Triage of #10 can decide it is blocked by #11 while triage of #11 decides the
  opposite, which creates a dependency loop that never runs. Related issues can
  also be judged inconsistently.

Today's `patchmill triage` already triages issues one after another in one
process. The triage lock keeps that order across every runner and every person.

### The triage lock

`POST /v1/triage/lock` carries the caller's name and a lock ID. The caller
creates a new random lock ID for each triage run and reuses it only to retry
that request. The name is for display. It returns one of:

- `held`: the caller now holds the lock under its lock ID. Taking it clears the
  due flag. A retry with the same lock ID returns `held` again.
- `busy`, with the holder's name and since when. This includes a second triage
  run under the same name, because its lock ID differs.
- `none`: triage is not due. A person's `patchmill triage` skips this check.

A lock whose lease has ended counts as free.

`POST /v1/triage/lock/renew` with the lock ID extends the lease by 10 minutes.
It is a conflict when that lock ID no longer holds the lock.

`POST /v1/triage/lock/release` with the lock ID and `finished` releases it.
`finished` is true only when `runTriage` returned without being cancelled. Today
it also returns normally after cancellation, with candidates left untouched. A
release with `finished` false sets the due flag again, so the issues that triage
did not reach are triaged next time. An operator can release the lock with
`--force` and a required reason, which is logged and also sets the due flag.

### When triage runs

Triage is part of the poll:

- The control plane sets the due flag when it starts, and after each poll that
  downloads a new or changed issue or comment.
- After each poll interval, a runner whose triage lane is free asks for the
  lock. The first to ask while triage is due gets it.
- A poll during a triage run sets the flag again, so the next request after the
  run gets the lock and sees the new changes.

A new issue or a reply therefore waits up to about one poll interval, plus any
triage run in progress, before it is triaged.

Triage and issue selection are independent. Runners get ready issues while
triage is due or running.

### Running triage

The runner that holds the lock calls today's `runTriage` in its checkout, with
its own config, Pi agent directory, model credentials, and repository token, and
a `ControlPlaneWorkflowState` made for this triage run. Today's code then does
what it does now:

- It reads the open issues from the control plane and picks candidates with
  `selectTriageCandidates`: untriaged issues, and `needsInfo` issues with a
  newer reply from a trusted author.
- It triages each candidate in turn, posts questions, creates dependency links,
  and records status.
- A failed or timed-out Pi session skips that issue. It is tried again the next
  time triage is due.

One addition: before it creates a `blockedBy` link, triage follows the blocker's
dependency links in the repository and rejects the link if it would close a
loop. Only one triage runs at a time, and it reads the repository directly, so
it sees every link that earlier triage runs created. A loop that a person
creates in the repository meanwhile is not prevented.

While triage runs, the runner renews the lock every minute. `runTriage` also
gains an optional check that it calls before each write to the repository or to
issue status: before posting a question, creating a dependency link, or
recording a status. In control-plane mode the check renews the lock. If the
renewal is refused, the check throws, and triage stops without making that
write.

When `runTriage` returns and its `AbortSignal` has not fired, the runner
releases the lock with `finished` true. When it throws or was cancelled, the
runner releases it with `finished` false. Triage does not count toward runner
capacity and leaves no worktree.

A status write from triage can conflict with a run. For example, triage read a
`needsInfo` issue just before its runner resumed it. The control plane refuses
the stale write, and triage warns and moves on, as it does today when a status
write fails.

### When a triage lock is lost

A lock held by a runner that dies blocks triage, but not issue selection. It
ends when the first of these happens:

- its lease ends, 10 minutes after the last renewal; or
- an operator runs `patchmill control-plane triage release --reason <text>`.

Either way the control plane sets the due flag again and logs it, so the issues
that triage did not reach are triaged by the next runner that asks. A restarted
runner does not know its old lock ID, so it waits for the lease like any other
runner.

The lease is safe for triage, though assignments have none, because triage
leaves no worktree, runs for minutes rather than days, and runs again the next
time it is due. A runner that stalls past its lease and then wakes up fails its
next renewal before it writes. The worst case is one write in flight as the
lease ends, such as a duplicate question comment.

### Triage by a person

`patchmill triage [--issue N]` in control-plane mode takes the lock under the
operator's name and a new lock ID, renews it as a runner does, runs `runTriage`
as today, and releases the lock. If the lock is held, it reports who holds it
and exits.

## Issue selection

Issue selection replaces `selectRunIssue` in control-plane mode. It is shared
between runner and control plane:

- **The runner decides when to ask.** It asks only when its unattended lane is
  free and none of its own assignments is ready to run. It finishes what it
  started before it takes more.
- **The control plane decides what to hand out.** It selects one issue and
  assigns it in the same transaction, so two runners can never get the same
  issue.

### The rule

When a runner or terminal asks, the control plane, in one transaction:

1. Refuses with `at-capacity` if the runner holds the maximum active
   assignments.
2. Takes the oldest open issue in its copy, by creation time, that:
   - has status `ready`;
   - has no active or completed assignment; and
   - has no open dependency, no dependency in another repository, and no
     dependency it could not read.
3. Creates the assignment in the requested mode and appends an `inProgress`
   status change.
4. Returns `none` if nothing qualifies.

Selection makes no network calls, so runners asking at once never wait on each
other's downloads.

Pending triage does not hold back selection. Selection hands out issues that
triage has already marked `ready`.

`inProgress` issues are never selected. In this mode every `inProgress` issue
already belongs to a runner, which resumes it itself. Selection has no priority
order in this prototype.

### Handing back an issue

The issue copy can be up to one poll interval old, so a newly assigned issue may
have closed or gained an open dependency since. `runOneIssue` already checks
both before it takes the per-issue lock or creates a worktree, and returns
`refused` or `no-work`.

When that happens and the runner has no worktree and no branch for the issue,
the runner hands the assignment back with the reason from `runOneIssue`. The
control plane first downloads the issue again, outside any transaction. Then, in
one transaction, it stores the fresh copy, abandons the assignment, and appends
`ready` with the reason, as an operator abandonment does. Selection therefore
never sees the issue unowned with its old copy. If the download fails, the
hand-back fails, the assignment stays with the runner, and the runner tries
again after backoff.

When the runner already has a worktree or branch, for example because a blocker
reopened while it was resuming its own work, it keeps the assignment and tries
again after backoff. This matches today's rule for blocked resumed issues.

### A person names the issue

`run-once --interactive --issue N` asks for issue N by name. The control plane
checks that the issue is open, is not owned by another runner, has no completed
assignment, and is not blocked. It refuses with the list of blockers if it is
blocked. This matches the rule for `--issue` today. See Terminal interactive
runs.

## Control-plane protocol

JSON over HTTP on the control-plane listener. Every route except `/health` needs
the bearer token. Routes start with `/v1`. Every request carries the runner's
repository key.

Requests that create work carry no request ID. A lost response is safe without
one:

- A lost next-issue response leaves an assignment that the runner sees in its
  next list of its own assignments, and runs as its own work.
- A lost claim response is followed by a retry, which returns the assignment the
  runner already owns.
- A lost triage lock response leaves the lock with the caller. The retry carries
  the same lock ID and returns `held`.
- A lost next-issue response to a terminal leaves an interactive assignment. The
  next `run-once --interactive` without `--issue` resumes it before it asks for
  another. See Terminal interactive runs.

### Next issue

`POST /v1/assignments/next`

```json
{
  "repository": "github-gh:github.com/rochecompaan/patchmill",
  "runner": "local-0",
  "mode": "unattended"
}
```

`mode` is the mode the caller will run the issue in: `unattended` from a runner,
`interactive` from a terminal. The assignment is created in that mode, so the
assignment always matches how the issue runs.

Results: `assigned` (with the assignment and the issue), `none`, or
`at-capacity`.

### Claim a named issue

`POST /v1/assignments/claim` with repository, runner, and one issue number. It
serves `run-once --interactive --issue N` in a terminal. The caller must hold
the per-issue lock in its checkout. See Terminal interactive runs.

- No active assignment for the issue: checks it as described under A person
  names the issue, then creates an `interactive` assignment for the runner,
  within capacity, and appends `inProgress`.
- Active, owned by this runner, and paused: `paused`. It must be resumed first.
- Active, owned by this runner, and not paused: switches it to `interactive` if
  it is not already, and returns it.
- Owned by another runner: conflict that names the runner.
- Completed: conflict.

Results: `claimed`, `paused`, `at-capacity`, `blocked` with the blockers, or a
conflict.

### List assignments

`GET /v1/assignments?runner=<name>&state=active` lists one runner's active
assignments with their mode, pause flag, the issue's status, and whether a run
for each is live. Without `runner` it lists all of them, for operators. Results
are ordered by runner and creation time.

### Complete

`POST /v1/assignments/{id}/complete` with the runner name.

- Active and owned: becomes `completed`.
- Already completed by the same runner: success without change.
- Owned by another runner, or abandoned: conflict.
- Unknown: not found.

### Abandon

`POST /v1/assignments/{id}/abandon` with the requester's name and a required,
non-blank reason. Operators use it, and runners use it to hand back an issue.

- Active: becomes `abandoned` and appends a `ready` status change whose summary
  is the reason. A live run for it receives a `stop` command. Issue selection
  may then hand the issue to another runner, which resumes from the pushed
  branch and pull request.
- Already abandoned: returns the stored record. The reason never changes.
- Completed: conflict.
- A runner may abandon only its own assignment.

The control plane changes nothing in the repository and nothing in any runner's
checkout. Cleaning up the old runner's worktree after an operator abandonment is
the operator's job.

### Pause and resume

`POST /v1/assignments/{id}/pause` and `POST /v1/assignments/{id}/resume`, each
with the requester's name. In this prototype only the `control-plane pause` and
`resume` commands call them. Today's web page is view-only. The web slice that
adds **Pause** and **Resume** calls the same store operations in process.

- Pause sets the flag and sends a `pause` command to a live run for the
  assignment. Resume clears the flag and sends `resume`.
- Both are idempotent. Both are conflicts on a completed or abandoned
  assignment.

What a run does with the command is under Run connection.

### Triage lock

`POST /v1/triage/lock`, `POST /v1/triage/lock/renew`, and
`POST /v1/triage/lock/release`, as described under The triage lock.

### Issues

`GET /v1/issues` returns the open issues with their current status,
`statusSince`, `revision`, comments, and every `questionUrl` recorded for them.
The backend uses the URLs to mark `fromPatchmill` comments, as local state mode
does.

`GET /v1/issues/{n}` returns one issue, open or closed, in the same shape.

`POST /v1/issues/{n}/sync` downloads one issue now and returns it.

### Status

`GET /v1/status/{n}` returns the full status history for one issue, for
`patchmill status --issue N`.

`POST /v1/status/{n}`

```json
{
  "repository": "github-gh:github.com/rochecompaan/patchmill",
  "ifRevision": "1842",
  "writeId": "5b0d…",
  "runner": "local-0",
  "change": { "status": "ready", "summary": "…", "questionUrl": "…" }
}
```

- `ifRevision` is required. If the issue has changed since that revision, the
  control plane returns a conflict and writes nothing. This stops a stale triage
  result and a run from overwriting each other.
- `writeId` is required. The backend creates a new random one for each
  `setStatus` call and reuses it only to retry that call. If the issue's latest
  change already has this write ID, the control plane returns success with that
  change's revision instead of a conflict. So a retry after a lost response
  succeeds once, and a stale write still conflicts.
- If `runner` is present and another runner holds the active assignment, the
  control plane returns a conflict. Triage sends no runner.
- The control plane sets the time of the change and returns the new revision.

### Health and errors

`GET /health` succeeds after migration and a successful query, and returns 503
when the database cannot serve requests. It reports nothing about the issue
download.

Errors use one JSON shape with a stable code and a short message, and never a
stack trace. Status codes: 400 invalid input, 401 missing or wrong token, 404
unknown issue, assignment, or run, 409 ownership, lifecycle, repository, lock,
or revision conflict, 413 request too large, 500 unexpected, 502 a required
repository download failed, and 503 database unavailable.

## Workflow state backend

`ControlPlaneWorkflowState` implements today's `WorkflowState` interface with
the control-plane client and the runner's `Host`. It uses the `Host` only to
post questions, because the control plane only reads the repository. The
interface, its callers, and the label and local state backends do not change.
The backend keeps nothing on disk.

- `openIssues()` and `issue(n)` read from the control plane. The backend
  remembers the revision of each issue it reads.
- `setStatus(n, update)` sends the remembered revision as `ifRevision`, and
  remembers the new revision that comes back. If it has never read issue `n`, it
  reads it first. A conflict rejects, as a failed status write does today.
- `sync(n)` asks the control plane to download issue `n` now. `sync()` with no
  issue does nothing, because the control plane polls on its own.
- Questions are posted through the runner's `Host` before the status is
  recorded, with the question URL, as in local state mode. In triage, the
  pre-write check runs before `setStatus`, so it covers both writes.
- In a Run attempt, a transport error or a 503 from the control plane is retried
  with capped backoff until the control plane answers or the run's `AbortSignal`
  fires. Conflicts and other errors are not retried. So during an outage a run
  waits at its next read or write, and never turns the outage into a `needsInfo`
  stop. Status retries reuse their write ID.
- In triage, the backend does not retry. A failed read or write fails at once,
  triage warns and moves on as it does today, and the issue is triaged again
  next time. So a write can never wait past the triage lease.

Each Run attempt and each triage run gets its own backend instance, so two runs
in one runner process never share remembered revisions. Every write path today
reads the issue through the same instance first. `runOneIssue` reads it at
start, so the review wait's `done` write after a restart still carries a
revision.

## Run connection

Every Run attempt in control-plane mode opens one run connection. That covers a
runner's unattended runs and terminal `run-once --interactive` runs. Run
connections exist so the web page can show runs and send them commands. They
never decide ownership or whether a run may start.

### Opening

`POST /v1/runs` registers the run with its run ID, assignment ID, runner, issue,
mode, and origin. The assignment must be active and owned by the runner. The
response gives the highest event number the control plane has stored for this
run ID, which is zero for a new run. Registering the same run ID again, as a run
does after a control-plane restart, is allowed.

### Events

`POST /v1/runs/{runId}/events` sends a batch of numbered events. Numbers start
at 1 and have no gaps. The control plane stores new events, ignores numbers it
already has, and rejects a gap. It returns the highest stored number. The run
keeps unsent events in memory and resends from that number after a reconnect.

Event kinds in version 1:

| Kind       | Body                                                        | Sent by the prototype |
| ---------- | ----------------------------------------------------------- | --------------------- |
| `snapshot` | The `RunSnapshot` from the kernel's `observe` hook.         | Yes                   |
| `output`   | One line the run prints, with `stdout` or `stderr`.         | Yes                   |
| `notice`   | A human-channel notice, wait, or stop line.                 | Yes                   |
| `ended`    | The `RunOnceOutcome` status and summary.                    | Yes                   |
| `message`  | A chat message, with the author name or `agent`.            | Interactive runs      |
| `tool`     | One tool call: name, short arguments, result, and duration. | No. Needs #305.       |
| `command`  | A command the run received and applied, with who sent it.   | Yes                   |

Events are evidence for people. Like run logs, they never decide a phase,
ownership, or status. Text in them can be as sensitive as a Pi session log. Only
holders of the control-plane token and token holders on the web page can read
them.

### Commands and liveness

`GET /v1/runs/{runId}/commands` is a server-sent event stream that the run keeps
open. The control plane pushes commands on it. The run is live while this stream
is open. When it closes, the control plane records the time, and the web page
shows the run as not live. A closed stream changes no assignment.

Command kinds in version 1:

| Command      | What the run does in the prototype                                         |
| ------------ | -------------------------------------------------------------------------- |
| `pause`      | Finishes the current Pi session, starts no next one, and ends the attempt. |
| `resume`     | Nothing in a run. The runner or a person restarts the assignment.          |
| `stop`       | Aborts the attempt through `runOneIssue`'s `AbortSignal`.                  |
| `message`    | Rejected until #305 delivers it.                                           |
| `stop-reply` | Rejected until #305 delivers it.                                           |

A rejected command is recorded as an event, so the web page can say why it did
nothing. #305 later lets `pause` interrupt a session and `resume` continue the
same Pi session, as #300 describes. Only the inside of the run link changes.

### Ending

`POST /v1/runs/{runId}/end` records the end time after the `ended` event. A run
that dies without ending shows as not live, with no end time.

### Run data for the web page

Today `serve` builds its `RunDataSource` with `createFileRunDataSource`. It
reads issues and pull requests through the host board cache, status from labels
or local state, run state from `.patchmill/runs/`, and document links from git.
In control-plane mode, `serve` builds a control-plane `RunDataSource` instead:

- `snapshot()` returns the board's view: open issues and pull requests from the
  issue copy, status from the status log, document links from git as today, and
  active assignments with runner, mode, pause flag, liveness, and the latest
  `snapshot` event of their live or most recent run.
- `subscribe()` notifies the board of a new revision after a poll, a status
  change, or a new event, as the file source does today. #303 and #304 extend it
  to stream one run's events, starting after a given event number.

Label and local state modes keep `createFileRunDataSource` unchanged.

## Runner

`patchmill run --runner <name>` runs two lanes in one process:

- **Unattended lane:** at most one unattended Run attempt at a time.
- **Triage lane:** at most one triage run at a time, while it holds the triage
  lock. It does not count toward capacity.

Terminal interactive runs under the same runner name share its capacity but run
in their own processes.

### Loop

The runner repeats these steps:

1. **Triage.** If the triage lane is free and a poll interval has passed since
   it last asked, ask for the triage lock. On `held`, start triage in the triage
   lane and continue without waiting for it.
2. **List** its active assignments, with each issue's status, from the control
   plane.
3. **Check for completion.** For each of its assignments, in either mode, that
   no run in this process is working on and whose issue is `done`, or is closed,
   or is `inProgress` with no run: take the per-issue lock without waiting, and
   skip the assignment if another process holds it. Then collect facts. If the
   pull request merged, clean up and complete as described under Cleanup and
   completion. If the issue is `done` and the pull request no longer proves
   completion, record `needsInfo` as the review wait does today. Otherwise keep
   waiting. This also completes interactive assignments whose console exited
   before the merge, and issues whose `done` status write failed.
4. **Run its own work first.** When the unattended lane is free, pick the oldest
   unpaused unattended assignment whose issue is `ready` or `inProgress` and not
   in backoff. Start it as described under Starting a run.
5. **Ask for the next issue** with mode `unattended`, only when the lane is
   still free and none of its own assignments is ready to run. Start the
   assigned issue as described under Starting a run.
6. **Wait** with jittered backoff, or until a lane frees up.

The runner never reads the repository's issue list. Every issue it runs came
from the control plane.

### Starting a run

1. Take the per-issue lock in its checkout. If another process holds it, skip
   the issue until the next pass.
2. While holding the lock, confirm with the control plane that the assignment is
   still active, owned, unattended, and not paused. If the control plane is
   unavailable, release the lock and do not start.
3. Call `runOneIssue` with the lock it holds. `runOneIssue` gains an option to
   use a lock its caller already holds instead of taking its own.

A terminal takes the same lock before it claims an issue. So a terminal can
never switch an assignment to interactive while an unattended run for it is
still running in that checkout, even if that run has lost its connection to the
control plane. One runner name always uses one checkout, so the lock covers
every attempt for that name.

### Ownership and failure rules

- A run already in progress keeps its Pi session running during a control-plane
  outage. Its next read or status write waits until the control plane is back,
  as described under Workflow state backend. Its events wait in memory and are
  resent after reconnect. A stop during the wait aborts the run, and the next
  attempt repeats the work from the world's facts.
- An ownership or repository conflict stops the runner for operator action. It
  is not retried.
- `runOneIssue` returning `claimed-elsewhere` for an assigned issue is an
  invariant error. The runner stops and keeps the assignment. `refused` and
  `no-work` follow Handing back an issue.
- An assignment whose issue closed without a merged pull request, after work
  started, stays active. The runner reports it once per start and waits for an
  operator to abandon it.
- A stop never abandons or completes an assignment. `SIGINT` and `SIGTERM` abort
  every run in the process through its `AbortSignal`, as `runOneIssue` supports
  today, then exit.

### Cleanup and completion

Since #351, `cleanupMergedIssue` runs in every mode. A run calls it after a
`done` stop, and `runOneIssue` sweeps merged issues before it selects one. Both
discard its `CleanupResult` of `cleaned`, `kept`, or `skipped`. A sweep can
therefore clean an assigned issue before the runner checks it.

`cleanupMergedIssue` returns `skipped` both when the merge is not confirmed and
when nothing is left to remove. A receipt cannot tell the two apart, because it
is written before the removals. So `cleanupMergedIssue` changes to return
`cleaned` when it confirms the merge and finds no worktree or branch left for
the issue. Its other callers ignore the result, so they do not change.

The runner completes an assignment only when a cleanup call under the per-issue
lock returns `cleaned`. A `kept` or `skipped` result keeps the assignment, which
keeps holding capacity, and is retried with backoff. The runner reports the
result's warnings in its log and as a `notice` event.

Interactive runs complete their assignment the same way when their review wait
confirms the merge. If the console exits first, the runner's completion check
does it.

### Restarts and lost responses

No local receipt is needed. The kernel derives each phase from git and the
repository, and the control plane holds every assignment, status change, and
stored event.

- **Runner restart:** step 2 returns the runner's assignments, and the loop
  resumes them. A triage lock it held ends with its lease. A missing worktree is
  created from the pushed branch or the base branch, as `runOneIssue` does
  today. A new Run attempt has a new run ID and a new run connection.
- **Control-plane restart:** the database keeps everything. Runs reconnect with
  capped backoff, reopen their command streams, and resend unstored events. The
  issue download resumes from its last successful time.
- **Lost responses:** see Control-plane protocol. Completion and abandonment are
  idempotent, so their retries succeed.

### Backoff

Separate configurable delays apply to no work, own waits, control-plane errors,
and run reconnects. Each delay has jitter and a cap. Each assignment has its own
next-check time, kept in memory. Tests inject the clock, sleep, and random
source.

## Terminal interactive runs

`patchmill run-once --interactive [--issue N] --runner <name>` works in
control-plane mode:

1. **With `--issue N`,** it takes the per-issue lock for N, then calls `claim`.
   A paused assignment is refused until it is resumed. **Without it,** it
   resumes this runner's oldest unpaused interactive assignment whose per-issue
   lock is free. Only when there is none does it ask for the next issue with
   mode `interactive`. Either way it holds the per-issue lock, then confirms
   that the assignment is active, owned, interactive, and not paused, before it
   runs.
2. It opens a run connection with origin `terminal` and runs the Interactive
   Issue run with the existing console, passing the lock it holds.
3. The console's human channel also sends `message` and `notice` events, so the
   web page can show the thread. People type in the terminal. The web page shows
   "running in a terminal" and no message box, as #300 specifies.
4. `control-plane pause` reaches the run as a `pause` command. The console shows
   it and ends the attempt at the next session boundary. The assignment stays
   interactive and paused. Running the command again after Resume reopens the
   Console session, as a restart does today.
5. When the console exits without a merge, the assignment stays active and
   interactive. The runner process never runs it. Running the command again
   resumes it.

Plain `run-once` without `--interactive` refuses in control-plane mode and
points to `patchmill run`.

## Commands in control-plane mode

```text
patchmill serve [--host HOST] [--port PORT] [--api-host HOST] [--api-port PORT]
                [--db <path>] [--poll-interval <duration>]
                [--max-assignments-per-runner <n>]
patchmill run --runner <name>
patchmill run-once --interactive [--issue N] --runner <name>
patchmill control-plane list
patchmill control-plane abandon --assignment <id> --reason <text>
patchmill control-plane pause --assignment <id>
patchmill control-plane resume --assignment <id>
patchmill control-plane triage release --reason <text>
```

- In control-plane mode, `serve` defaults the database to
  `~/.local/state/patchmill/control-plane.db`, the API listener to
  `127.0.0.1:4281`, the poll interval to three minutes, and runner capacity
  to 3. It creates the token file when no token is set. It refuses to start when
  it cannot bind either address, open the database, or read the repository. The
  control-plane options are refused in other modes, where `serve` behaves as
  today.
- `run` and the `control-plane` commands require control-plane mode.
- `control-plane` commands send the operator's OS user name as the requester.

Existing commands, as answered by the control-plane mode object:

| Command                  | Control-plane mode behaviour                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `triage`                 | Takes the triage lock, runs as today, and releases it.                |
| `status`                 | Reads issues and status history from the control plane.               |
| `release`                | Refuses and points to `control-plane abandon`.                        |
| `run-once`               | Refuses and points to `patchmill run`.                                |
| `run-once --interactive` | Works, as described under Terminal interactive runs.                  |
| `labels setup`           | Refuses, as in local state mode.                                      |
| `doctor`                 | Checks control-plane health and the token, and skips the label check. |

Label mode and local state mode keep their current commands and behaviour.

## Observability

The control plane and the runner write structured log lines. Each line carries
the operation and, where they apply, the assignment ID, issue, runner, mode, run
ID, result, and status. Logs keep validation errors, conflicts, database errors,
repository download errors, and transport errors apart. They never contain
tokens, request headers, or event bodies. The control plane logs its start,
schema version, database path, repository key, and listen address. It logs each
poll's result, every triage lock change, and every change after commit.

## Testing

This feature changes coordination, persistence, concurrency, and error handling,
so automated tests pass the Testing Value Gate.

**Control-plane store and issue selection**, against temporary SQLite databases:

- Two runners asking at once get different issues. Tests assert committed rows,
  not only responses, and release both calls together from a barrier.
- A runner at capacity gets `at-capacity` for both next issue and claim.
  Interactive and unattended assignments count together.
- Selection takes the oldest ready issue, and skips issues with an assignment, a
  completed assignment, an open dependency, a dependency in another repository,
  or an unreadable dependency.
- `inProgress` issues are never selected.
- The assignment's mode is the requested mode.
- A claim checks the named issue like `--issue` today, switches its own runner's
  unattended assignment to interactive, returns an assignment the runner already
  owns, and refuses another runner's assignment.
- Abandonment appends `ready`, sends `stop`, and lets selection hand the issue
  to another runner. A runner can abandon only its own assignment. Abandonment
  by a runner downloads the issue again.
- Pause and resume are idempotent and leave ownership unchanged.
- A request with another repository's key is a conflict.
- Status writes with a stale revision, including after
  `needsInfo → ready → needsInfo`, or from a non-owning runner, fail without
  change.
- Two callers asking for the triage lock at once: one gets `held`, the other
  `busy`. Without the due flag, a runner gets `none`. A poll with changes sets
  the flag, and taking the lock clears it.
- A lock whose lease has ended can be taken by another caller, and the due flag
  is set again. Renewal or release with an old lock ID is a conflict. Renewal
  extends the lease, using an injected clock.
- Event batches store new numbers, ignore repeats, and reject gaps.
- Everything survives closing and reopening the database.

**Issue download**, with a fake repository: the first full download, incremental
downloads, dependency links for ready issues on every poll, setting the triage
due flag only when something changed, keeping the last good copy after a failed
poll, and the configurable interval with an injected clock.

**Protocol:** results, input validation, idempotent complete, abandon, pause,
and resume, required reasons, conflicts, not found, listing with liveness,
health without a token, the error shape, and request limits. Missing and wrong
tokens get 401 on every other route, from loopback too. The token file is
created with mode `0600`, and the environment variable takes precedence over it.

**Run link and run data:** a run resends unstored events after a control-plane
restart; liveness follows the command stream; `subscribe` reports a new revision
after a poll, a status change, or a new event; rejected commands are recorded.

**`ControlPlaneWorkflowState`**, against a fake client: issues, current status,
`statusSince`, `fromPatchmill` from question URLs, a question posted through the
`Host` before its status, `sync(n)`, a no-op `sync()`, the remembered revision
sent with each write, a read before a write to an unread issue, conflict
reporting, separate instances not sharing revisions, waiting through an outage
until the control plane answers or the signal aborts in a Run attempt, failing
at once in triage, a retried write after a lost response succeeding with its
write ID, and no files written in the checkout. The triage reply rule tests run
against this backend too.

**State-tracking modes:** each mode's answers for backend, allowed commands, and
`doctor` checks. Existing command tests stay unchanged.

**Runner**, with a fake client, fake repository, fake Pi, and a fake human
channel:

- It runs at most one triage run beside its other work, gets new issues while
  triage runs, and releases the lock when triage ends, throws, or is cancelled,
  with `finished` set to match. Cancelling midway through a batch releases it
  unfinished.
- It renews the lock while triage runs. A refused renewal stops triage before
  its next write to the repository or to status.
- Its completion checks run before it asks for the next issue. They cover
  interactive assignments whose console exited, closed issues, and issues whose
  `done` write failed, and skip issues whose lock another process holds.
- It asks for the next issue only when none of its own assignments is ready to
  run.
- It takes the per-issue lock before it confirms an assignment, and skips an
  issue whose lock another process holds.
- A newly assigned issue that `runOneIssue` refuses as closed or blocked, with
  no worktree or branch, is abandoned with the reason. With a worktree, it is
  kept and retried after backoff.
- A merge leads to cleanup and then completion. A failed cleanup keeps the
  assignment.
- `needsInfo`, `done`, paused, and interactive assignments still count toward
  capacity.
- Only one unattended run is active at a time. Interactive and paused
  assignments never start.
- `pause` ends an unattended attempt at the next session boundary. `stop` aborts
  it.
- A control-plane outage prevents a new run. A run in progress waits at its next
  read after a session, then continues with the same outcome once the control
  plane is back.
- Restart resumes its assignments with no local file.
- Conflicts and invariant errors stop the loop and keep assignments.
- Shutdown never abandons or completes.
- Backoff uses the injected clock and random source.

**Triage on the runner**, with a fake client and fake Pi: a `blockedBy` link
that closes a dependency loop is rejected before anything is posted; a stale
status write is reported and skipped; a failed session leaves the issue for the
next due triage.

**Completion:** `cleanupMergedIssue` returns `cleaned` when the merge is
confirmed and nothing is left, for example after a sweep, and `skipped` when the
merge is not confirmed. An assignment completes only after `cleaned`.

**Terminal interactive runs:** claim under the per-issue lock, next issue with
mode `interactive`, resuming its own interactive assignment before asking for a
new one, refusal while an unattended run holds the lock, refusal of a paused
assignment, events from the console's human channel, pause handling, and refusal
when another runner owns the issue or the issue is blocked.

**Mode regressions:** label and local state mode tests stay unchanged. New tests
prove those modes never create a control-plane client, and that plain `run-once`
and `release` refuse in control-plane mode.

**Smoke test:** `npm run smoke:control-plane` starts a control plane and two
runners in two temporary checkouts with a fake repository and fake Pi, no real
GitHub or Forgejo, and no provider. It proves:

1. Both runners ask at once and get different issues.
2. A runner stops getting new issues at capacity.
3. An issue that closes after the last poll is handed back by the runner it was
   assigned to, and not handed out again.
4. One runner restarts and resumes its assignments.
5. The control plane restarts. Every assignment, status change, and event is
   unchanged, and live runs resend what they missed.
6. A `needsInfo` stop keeps its assignment. A reply and triage make it `ready`,
   and the same runner resumes it before it asks for new work.
7. A merged pull request leads to cleanup, completion, and a freed place.
8. An abandoned assignment is handed to the other runner and resumed there.
9. A scripted terminal interactive run in one runner's checkout claims an issue,
   its events reach the control plane, and the issue shows as live until the run
   ends.
10. A paused assignment holds its place and is not restarted until resumed.
11. Neither runner's checkout contains `.patchmill/state/`.
12. With ready and untriaged issues waiting, both runners ask for work. Exactly
    one triages at a time, both get ready issues meanwhile, and the newly
    triaged issues are handed out after.
13. A new issue, and a reply to a question, found by a poll are triaged.
14. A runner killed during triage blocks triage, but not new issues, until its
    lease ends. The other runner then takes the lock and triages the rest. The
    smoke test shortens the lease.

## Verification

```sh
devenv shell -- npm test
devenv shell -- npm run lint
devenv shell -- npm run build
devenv shell -- npm run smoke:control-plane
nix build
```

`node:sqlite` is built into Node and adds no npm dependency. Node 22 prints an
experimental warning when it loads. Node 24, which devenv already uses, does
not. The implementation raises `engines.node` in `package.json` to `>=24` and
updates any Node 22 references in docs and CI. Because `package.json` changes,
verification includes the Nix build.

## Alternatives considered

**Build on label mode.** This was the earlier draft's basis. It keeps the
tracker as Patchmill's database, which blocks adoption, and it splits truth
between labels and the control plane. Rejected.

**Each runner keeps its own issue copy.** An earlier revision of this design did
this, so the control plane would never read the repository. Every runner then
downloaded the same issues, the copies could disagree, and the web board would
need a third copy. Rejected. The control plane downloads issues once with a
read-only token.

**Runners select issues and send a ranked list.** Once the control plane holds
the issues, the list is a wasted round trip, and selection rules would live in
every runner. Rejected.

**The control plane also chooses among a runner's own assignments.** One "what
next" call would cover both. It would make the control plane decide when a
runner resumes its own work, which the runner already knows. Rejected.

**Assignments only, with status in each checkout.** The control plane would stay
small, but each checkout would keep its own status history, so a stop in one
would be invisible to the others. Rejected.

**A Unix socket for the control-plane API.** A socket cannot reach a control
plane in another container or pod, so the cluster deployment would need a second
transport. Rejected. HTTP with a bearer token works the same on one machine and
in a cluster.

**Separate control-plane and web processes.** Each would need its own store or a
link between them, and runs would need two connections. Rejected in favour of
one `patchmill serve` process with two listeners.

**The control plane reads run files.** Today's board (#355) works this way. It
works only with one checkout on the same host. Rejected for control-plane mode.
Runs send events over their run connection instead.

**Liveness from leases or heartbeats.** These would let liveness decide
ownership. Rejected. An open command stream marks a run as live for display
only.

**Open runs that decide whether an attempt may start,** with a reclaim step for
dead runs. The per-issue lock in the runner's checkout already proves whether an
attempt is running, and assignment ownership already keeps other runners out.
Rejected. Runs are display data.

**Start requests and runner-hosted interactive runs now.** Until #305, no runner
can host an interactive run, so only fakes could exercise them. Rejected for the
prototype. #305's design adds them.

**Separate runners for interactive and unattended runs.** Simple to reason
about, but interactive runners would sit idle most of the time. Rejected. One
cap covers both.

**Wrap the `run-once` CLI.** An outer script could get an issue and run
`run-once --issue N`. It could not read typed outcomes, check review waits, or
clean up after merges without parsing output. Rejected. The runner calls
`runOneIssue` in process.

**One assignment per runner.** Simple, but a runner would sit idle for as long
as its pull request waits for review. Rejected in favour of runner capacity.

**Shared Postgres.** Each runner would need database credentials and its own
copy of the transaction logic. Rejected. Postgres can later sit behind the same
control-plane interface.

**Kubernetes claim objects.** These tie ownership rules to Kubernetes and do not
help on one machine. Rejected.

**Leases and expiry for assignments.** These free work when a runner dies, but
can hand out an issue while the first runner still has a worktree and a live
process. Rejected. Only an operator abandons work, except for the hand-back
before work starts.

**Download the chosen issue again during selection.** This catches a closed or
blocked issue before it is handed out, but it puts network calls inside
selection and makes runners wait for each other. Rejected. The run already
checks at start and hands the issue back.

**Request IDs with stored results.** These make every retry return the first
answer. The runner already lists its own assignments on every pass, and a claim
of an issue it owns returns it, so a lost response heals itself. Rejected.

**Status revisions in the `WorkflowState` interface.** Every backend and caller
would pass revisions, and label mode cannot check them reliably. Rejected. The
control-plane backend keeps revisions to itself.

**Triage on every runner at once.** Faster, but two runs can triage the same
issue, or create dependency loops between issues they cannot see. Rejected. One
triage lock per repository.

**The control plane picks each issue to triage and records each result.** It
would need the trusted-author list, a failure counter, a task table, and a
finish step, and it would repeat the candidate rule that today's triage already
has. Rejected. A lock around today's triage loop gives the same one-at-a-time
guarantee.

**The control plane runs triage itself.** The control plane would need a
checkout, model credentials, a write token, and Pi, and a slow triage would
share a process with the web page. Rejected. Runners run every Pi session.

**Hold back issue selection while triage is pending.** Runners would sit idle
with ready issues waiting whenever new issues arrived. Rejected. Triage runs
beside selection.

**Separate triage triggers, such as a completed assignment.** New issues and
replies only arrive through the repository, which the poll already reads.
Rejected. Triage is part of the poll.

## Risks and tradeoffs

- **Triage is slow on a large backlog.** On the first start in an old
  repository, untriaged issues are triaged one at a time. Issues already `ready`
  are handed out meanwhile.
- **A lost triage lock delays triage.** If the runner holding it dies, triage
  waits up to 10 minutes for the lease to end. Issue selection continues.
- **A write as the triage lease ends.** A stalled runner can make one write just
  as its lease ends, such as a duplicate question comment.
- **A failing issue is retried each time triage is due.** Today's triage skips a
  failed session and tries again on the next run. With triage due after every
  changing poll, a broken issue can cost one Pi session per change.
- **One process.** A web page fault can take down the control plane. When it is
  down, runners get no new issues and start no new runs, and runs in progress
  cannot record status. SQLite, idempotent operations, and event resends make
  restarts safe.
- **A repository token in the control plane.** It is read-only, and runners
  already hold write tokens. It still widens where a token lives.
- **Stale issue copy.** Between polls, the copy can be up to three minutes old.
  Selection may hand out an issue that has just closed or become blocked. The
  run hands it back, which costs one round trip. The board can show old data for
  that long.
- **API use.** Every poll downloads dependency links for each ready issue. A
  large backlog of ready issues costs one call each per poll. The interval is
  configurable.
- **Capacity held by waiting work.** Issues waiting for answers, review, or a
  person at a console hold places. A runner full of them does nothing until
  humans act or an operator abandons. The cap is the price of bounded resources.
- **No Start planning on the web page yet.** People start interactive runs in a
  terminal until #305.
- **Pause ends the attempt in the prototype.** Resuming starts a new Pi session
  from the world's facts, not the same session, until #305.
- **Closed issues.** An issue closed without a merge after work started holds
  its place until an operator abandons it.
- **Event volume and sensitivity.** Run events grow without limit and can hold
  sensitive text. The prototype keeps them all. A retention rule is deferred.
- **Same runner name on two machines.** Both would act as one runner. Local
  locks protect only one checkout. Fencing is deferred.
- **One shared token, no TLS.** Anyone with the token can act as any runner, and
  traffic off loopback is readable on the network. This is acceptable on one
  machine. A cluster needs TLS and a NetworkPolicy, and may need per-runner
  credentials.
- **Completed tombstones.** A completed issue cannot be selected again.
  Reprocessing would need a new rule.
- **No path from local state mode.** Switching starts with an empty status
  history. This matches the kernel's no-upgrade stance.

## Delivery

Each sub-issue of #356 delivers the sections it names and may not change this
design. #364 would let their runs use this spec directly.

| Issue | Delivers                                                              | After      |
| ----- | --------------------------------------------------------------------- | ---------- |
| #357  | Mode object, `cleaned` result, caller-held lock, pre-write check      | —          |
| #358  | Store, issue copy, issue and status routes, backend, board data       | #357       |
| #359  | Leased triage lock and `patchmill triage` in control-plane mode       | #358       |
| #360  | Assignments, issue selection, and the `patchmill run` unattended lane | #358       |
| #361  | The runner's triage lane                                              | #359, #360 |
| #362  | Terminal interactive runs                                             | #360       |
| #363  | Run connections and live run data                                     | #360       |

## Related work

- **#300 and #301–#304, web page.** #301 and #302 added `patchmill serve` and
  its board. #303 and #304 read runs through the run data module, which in
  control-plane mode reads stored run events. #300's decisions stand. Its mockup
  notes predate the kernel and local state mode, so their board columns, labels,
  and admission records need updating separately.
- **#305, Pi RPC mode.** It lets a runner host interactive runs, delivers chat,
  **Stop reply**, and in-session pause, and adds `tool` events. Its design adds
  **Start planning**: a table of pending start requests that people create on
  the web page, and a way for a runner that can host interactive runs to ask for
  them. Nothing in this prototype blocks that. Assignments already carry a mode,
  next issue already takes a requested mode, and run connections already carry
  commands.
- **#233, clone-local SQLite Event ledger.** The control plane's status log and
  run events overlap with the Event ledger. This prototype does not decide
  whether the ledger moves into the control plane. Append-only rows keep that
  option open.
- **#236, continuous coordinator core.** `patchmill run` here is a first runner
  without budget or quarantine. #236 should build on it, not beside it.
- **#237 and #238.** Pause and resume here are per assignment. Runner-wide
  operator controls and retries belong in the runner loop or issue selection
  later.

## Deferred cluster design

A later design must settle, before any cluster deployment: generation fencing,
TLS or a service mesh, per-runner credentials, NetworkPolicies that limit the
control-plane port to runner pods, control-plane availability and database
placement, whether the control plane can run without a checkout, event
retention, per-runner capacity overrides, runner replacement and scale-down, and
the container, image, and browser tooling.

## Decisions

- The first version builds on local state mode, not label mode.
- `workflow.stateTracking: "control-plane"` selects it. `controlPlane.url` is
  the only new config key. One object per state-tracking mode answers every
  mode-dependent question in the CLI.
- **Runner** replaces Coordinator, clone, and worker slot. **Control plane**
  names the `patchmill serve` process.
- One `patchmill serve` process, running in a checkout as today, owns the
  database. It serves the control-plane API over HTTP with a bearer token, and
  the existing web page on a second port with its existing token rules.
- The control plane holds the only issue copy, downloads it every three minutes
  by default with a read-only token, and serves one repository.
- Runners keep no issue copy and no workflow status, only their checkout,
  worktrees, Pi session files, and run logs.
- Triage runs on runners under one triage lock per repository. The runner that
  holds it runs today's triage loop and releases it. A poll that finds changes
  makes triage due. Triage never holds back issue selection.
- The triage lock has a 10-minute lease, renewed every minute and before each
  write. Assignments have no lease.
- Issue selection is shared. A runner asks for its next issue only when none of
  its own assignments is ready to run. The control plane selects and assigns it
  in one transaction, with no network calls.
- Selection takes the oldest ready issue with no open, unreadable, or
  cross-repository dependency. It has no priority order. A runner hands back a
  new issue that it finds closed or blocked before any work starts.
- A named issue is checked as `--issue` is today.
- Interactive runs start only in a terminal in this prototype. Start requests
  and runner-hosted interactive runs move to #305's design.
- The per-issue lock, held across the ownership check and the run, decides
  whether an attempt may start. Run connections are for display and commands
  only.
- Status writes carry an issue revision, which only the control-plane backend
  sees. `WorkflowState` and the other backends do not change.
- Requests carry no request IDs. The runner's own assignment list heals lost
  responses.
- An assignment stays with its runner until merge and cleanup, or abandonment.
  Pause keeps it.
- A runner name holds unattended and interactive assignments together, up to a
  cap with a default of 3. The runner runs one unattended run at a time.
- Completion requires a merged pull request and a `cleaned` result from
  `cleanupMergedIssue`, which #351 already provides.
- Patchmill requires Node 24 or later.
- Existing local state files are not imported.
- Assignments never expire.
- Plain `run-once` and `release` refuse in control-plane mode.
