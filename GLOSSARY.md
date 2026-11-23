# Patchmill

Patchmill coordinates agent-driven software work while preserving explicit
safety, policy, and human-control boundaries.

## Language

**Spec gate**: A required pause until a human merges the specification pull
request, or approves it without a PR in an Interactive Issue run, which puts the
document on the pushed implementation branch. Review approval alone does not
unlock it. _Avoid_: Approval label

**Plan gate**: A required pause until a human merges the implementation-plan
pull request, or approves it without a PR in an Interactive Issue run, which
puts the document on the pushed implementation branch. Review approval alone
does not unlock it. _Avoid_: Approval label

**Planning review**: A fresh reviewer's adversarial assessment of the planning
documents in its scope, against the issue, the existing codebase, and each
other. Its scope is a specification, a plan, or both. It supplies evidence, not
human approval of a Spec gate or Plan gate. _Avoid_: Builder check, Planner
self-review

**Plan review**: A Planning review whose scope includes an implementation plan.
_Avoid_: Plan gate, Planner self-review

**Review boundary**: A point where planning documents leave the planner: a Spec
gate, a Plan gate, an interactive submission, or the start of implementation.
Each document that crosses one needs a current Planning review. _Avoid_: Review
gate

**Sub-issue**: An issue whose host records a parent issue in the same
repository: a native sub-issue on GitHub, or a leading `Part of #N` body line on
Forgejo and Gitea. _Avoid_: Child issue, slice

**Parent spec**: The newest specification of a Sub-issue's parent on the base
branch. It is the approved design that the Sub-issue's own spec extends and
never changes. _Avoid_: Inherited spec, shared spec

**Planning visualization**: A visual explanation of the concepts, relationships,
or execution order in a specification or implementation plan. It explains the
reasoning rather than depicting the proposed user interface. _Avoid_: UI mockup,
Implementation screenshot

**Planning pull request**: A pull request for documents that must merge before
the next required stage. It does not complete the issue. _Avoid_: Implementation
PR

**Issue branch**: The implementation branch for one issue. Ungated planning
documents and documents approved without a PR in an Interactive Issue run
accompany its code. Required planning gates otherwise use separate branches.
_Avoid_: One branch for every stage

**Issue document**: A spec, plan, mockup, or Planning visualization of one
issue, read from a committed Git ref of its Issue branch or of the base branch.
The web API calls its entry an `Artifact`. _Avoid_: Issue file, attachment

**Planning branch**: The branch that holds a required gate's planning documents
and is the head of its Planning pull request when one opens. Its name carries
the issue number, a title slug that is fixed when the issue's first Planning
branch is created, and its stage. _Avoid_: Spec worktree, gate branch

**Run-once workflow**: The atomic processing of one selected issue from claim
through its terminal or resumable outcome. _Avoid_: Run loop, Runner

**Runner**: The long-lived `patchmill run` process of one clone. It decides when
a Run-once workflow may start and applies capacity, budget, and operator policy
between issue runs. _Avoid_: Coordinator, worker

**Runner shell**: The part of a Runner that owns its lifetime: the Lifetime
lock, stop signals, the loop, and backoff. It sees only Pass results. _Avoid_:
Run loop

**Triage gate**: The part of a Runner that decides when triage may run. _Avoid_:
Triage schedule

**Work source**: The part of a Runner that does one pass of unattended work and
reports a Pass result. _Avoid_: Work queue

**Pass result**: What one Work source pass tells the Runner shell to do next:
continue, back off, or stop for operator action. _Avoid_: Normalized run
outcome, Run-once outcome

**Lifetime lock**: A lock that a Runner holds for its whole life, so that one
clone and its worktrees have at most one Runner. _Avoid_: Issue lock, Console
session lock

**Event ledger**: The canonical durable ordered record of normalized Patchmill
lifecycle, control, usage, approval, failure, quarantine, and notification
facts. It is the source for runner policy and audit history, but excludes raw Pi
conversations and detailed workflow checkpoints. _Avoid_: Console log, Pi
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

**Interactive Issue run**: An Issue run that takes human input through a console
instead of issue comments. It uses the same Run-once workflow.

**Issue thread**: The chronological view of an Issue run's main-agent messages,
tool calls, and progress. Dividers distinguish its Run attempts and workflow
steps. _Avoid_: Event ledger, Subagent transcript

**Issue update**: One ordered change to an issue page's header or Issue thread
that the web server sends to a live subscriber. It is not durable, and its ID
orders updates only inside one server process. _Avoid_: Ledger event, Thread
event

**Console session**: The Pi session that holds the maintainer's conversation for
one or more Interactive Issue runs. It never decides a phase.

**Console agent**: The agent in the Console session. It plans with the
maintainer, calls Patchmill tools, and makes the pull request changes that the
maintainer asks for during a Review wait. After a run ends, it explains a stop
and resolves the problem when the maintainer agrees. It never chooses a phase.

**Web session**: One Pi RPC process, started by `patchmill serve`, that drives a
Run attempt of an Interactive Issue run from the issue's web page. Every browser
on that page shares it. Pausing the Web session stops the process. The run state
and Console session remain, so a later Web session or terminal console can
continue the Issue run. _Avoid_: Web chat, browser session

**Console session lock**: A lock that the terminal console or a Web session
holds for its whole life, so only one process writes an issue's Console session.
_Avoid_: Issue lock

**Session hub**: The part of `patchmill serve` that holds at most one Web
session per issue, its input queue and its open question. _Avoid_: Session
manager

**Presence**: The names of the people who have an issue page open in one
`patchmill serve` process, taken from the open event streams of that issue. Each
name counts once. A name is a label, not an identity. Presence is not stored,
and a presence update is not an Issue update. _Avoid_: Viewers, online users

**Typing signal**: A short-lived note from a browser that a named person types
in the issue page composer. It ends when the message is sent, after a few
seconds without a new signal, or when the person leaves the page. _Avoid_:
Typing event

**Review wait**: The part of an Interactive Issue run after the implementation
pull request is verified and labeled `agent-done`, and before it is merged.

**Result block**: The final fenced `json` block, with `status` and `summary`,
that ends the last message of a phase session. It gives the phase result.
Without it, only repository facts can show that implementation is done.
Interactive planning ends with a submission instead. _Avoid_: Result JSON, final
answer

**Result reminder**: The one message that Patchmill sends in the same
conversation when a phase session ends normally without a Result block. It is
not sent after a crash, a timeout, or an abort. _Avoid_: Retry, re-run

**Normalized run outcome**: The small runner-facing result of one Run attempt —
completed, no work, deferred, cancelled, or failed — produced from a rich
Run-once workflow result. _Avoid_: Pipeline status

**Pi session log**: A raw, potentially sensitive Pi execution transcript used as
evidence and as input when normalizing usage. It is not a runner policy or audit
source after ingestion. _Avoid_: Event ledger

**Command timeout**: The time limit that Patchmill gives one agent `bash` call
in an Issue run session or in a subagent session that it starts. A call without
a timeout gets the configured default, and a longer request gets the configured
cap. When it fires, Pi stops that command, and the agent continues. _Avoid_:
Session timeout, stall stop

**Budget window**: A daily or weekly period in the configured timezone. All
committed model usage that occurred in the period counts toward its selection
limits. _Avoid_: Billing period

**Budget wait**: Runner activity in which desired mode remains running but
Patchmill cannot select another Issue run because a Budget window has reached a
limit. _Avoid_: Pause, Drain

**Selection gate**: The pre-run check that desired mode, Budget windows, and
host-retry state allow one Run-once workflow to start. _Avoid_: Budget check,
throttle

**Operator control**: A maintainer instruction that changes runner intent, such
as pause, resume, drain, or shutdown. _Avoid_: Workflow action

**Desired mode**: The runner's durable operator intent, either running or
paused, independent of its current activity. _Avoid_: Activity state

**Runner activity**: The runner's observed current condition, such as idle,
executing, waiting, or faulted, reported separately from desired mode. _Avoid_:
Desired mode

**Drain**: An operator control that lets the active issue run finish, persists a
paused desired mode, and then stops the runner cleanly. _Avoid_: Pause, shutdown

**Quarantine**: A durable issue state that excludes repeatedly failing work from
selection until an operator intervenes. _Avoid_: Backoff, pause
