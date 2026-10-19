# Patchmill

Patchmill coordinates agent-driven software work while preserving explicit
safety, policy, and human-control boundaries.

## Language

**Spec gate**: A required pause until a human merges the specification pull
request. Review approval alone does not unlock it. _Avoid_: Approval label

**Plan gate**: A required pause until a human merges the implementation-plan
pull request. Review approval alone does not unlock it. _Avoid_: Approval label

**Planning pull request**: A pull request for documents that must merge before
the next required stage. It does not complete the issue. _Avoid_: Implementation
PR

**Issue branch**: The implementation branch for one issue. Ungated planning
documents accompany its code. Required planning gates use separate branches.
_Avoid_: One branch for every stage

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

**Normalized run outcome**: The small coordinator-facing result of one Run
attempt — completed, no work, deferred, cancelled, or failed — produced from a
rich Run-once workflow result. _Avoid_: Pipeline status

**Pi session log**: A raw, potentially sensitive Pi execution transcript used as
evidence and as input when normalizing usage. It is not a coordinator policy or
audit source after ingestion. _Avoid_: Event ledger

**Budget window**: A daily or weekly period in the configured timezone. All
committed model usage that occurred in the period counts toward its selection
limits. _Avoid_: Billing period

**Budget wait**: Coordinator activity in which desired mode remains running but
Patchmill cannot select another Issue run because a Budget window has reached a
limit. _Avoid_: Pause, Drain

**Selection gate**: The pre-run check that desired mode, Budget windows, and
host-retry state allow one Run-once workflow to start. _Avoid_: Budget check,
throttle

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
