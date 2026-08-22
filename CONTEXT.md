# Patchmill

Patchmill coordinates agent-driven software work while preserving explicit
safety, policy, and human-control boundaries.

## Language

**Run-once workflow**: The atomic processing of one selected issue from claim
through its terminal or resumable outcome. _Avoid_: Run loop, coordinator

**Coordinator**: The long-lived Patchmill role that decides when a run-once
workflow may start and applies capacity, budget, and operator policy between
issue runs. _Avoid_: Runner, worker

**Event ledger**: The canonical durable ordered record of normalized Patchmill
lifecycle, control, usage, approval, failure, quarantine, and notification
facts. It is the source for coordinator policy and audit history, but excludes
raw Pi conversations and detailed workflow checkpoints. _Avoid_: Console log, Pi
session log, Run recovery state

**Ledger event**: An immutable, versioned, past-tense domain fact recorded in
the Event ledger. Corrections are later Ledger events rather than edits to
history. _Avoid_: State snapshot, Log line

**Ledger position**: The monotonic place at which a Ledger event committed in
one Event ledger. It defines local event order; timestamps do not. _Avoid_:
Timestamp, Event identity

**Issue run**: One logical issue-processing lifecycle, from initial selection
through any resumptions to a terminal outcome. _Avoid_: Run attempt

**Run attempt**: One process entry into the run-once workflow for an Issue run.
A later Run attempt may resume the same Issue run. _Avoid_: Issue run

**Run recovery state**: The durable current checkpoint needed to resume one
run-once workflow. It is authoritative for resume mechanics, not coordinator
policy or audit history. _Avoid_: Event ledger, Coordinator activity

**Pi session log**: A raw, potentially sensitive Pi execution transcript used as
evidence and as input when normalizing usage. It is not a coordinator policy or
audit source after ingestion. _Avoid_: Event ledger

**Budget window**: A daily or weekly period in the configured timezone. All
committed model usage that occurred in the period counts toward its selection
limits. _Avoid_: Billing period

**Budget wait**: Coordinator activity in which desired mode remains running but
Patchmill cannot select another Issue run because a Budget window has reached a
limit. _Avoid_: Pause, Drain

**Budget grant**: An audited, finite increase to one token or estimated-cost
limit for one Budget window. It does not remove or reset recorded usage.
_Avoid_: Budget reset, Ignore switch

**Operator control**: A maintainer instruction that changes coordinator intent,
such as pause, resume, drain, or shutdown. _Avoid_: Workflow action

**Desired mode**: The coordinator's durable operator intent, either running or
paused, independent of its current activity. _Avoid_: Activity state

**Coordinator activity**: The coordinator's observed current condition, such as
idle, executing, waiting, or faulted, reported separately from desired mode.
_Avoid_: Desired mode

**Pause**: An operator control that lets the active issue run finish and keeps
the coordinator alive without selecting more work. _Avoid_: Shutdown, drain

**Drain**: An operator control that lets the active issue run finish, persists a
paused desired mode, and then stops the coordinator cleanly. _Avoid_: Pause,
shutdown

**Quarantine**: A durable issue state that excludes repeatedly failing work from
selection until an operator intervenes. _Avoid_: Backoff, pause
