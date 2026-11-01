# Interactive Issue runs

- **Issue:** #225
- **Status:** Proposed design, revised for the skills-first kernel
- **Scope:** A first version of interactive Issue runs, started from an existing
  issue, in one terminal
- **Builds on:**
  [A skills-first Patchmill kernel](2026-10-15-skills-first-kernel-design.md)
  and [Planning merge gates](2026-10-19-planning-merge-gates-design.md)

## Why

Today a Patchmill Issue run talks to the maintainer only through the issue. Two
things follow from that.

1. **Spec and plan work is one-way.** The planning agent writes the spec and
   plan on its own. The maintainer cannot work them out with the agent the way
   they would in a normal Pi session.
2. **A blocked run is slow to unblock.** The agent puts its questions in its
   summary, and the kernel posts them as an issue comment, applies `needs-info`,
   and exits. The maintainer comments, adds `agent-ready`, and starts a new Run
   attempt. The new attempt derives the phase again and starts a fresh Pi
   session. This is slow, and the maintainer gets no sign that the agent
   understood the answer until they see what it does next.

Plain Pi does not solve this. It gives a conversation but not the workflow. In
plain Pi the maintainer must tell the agent each next step. They also lose
Patchmill's claim and labels, its planning gates, the planning and
implementation skills, the reviewer agent, and the kernel's check of each
outcome against git and the host.

An **interactive Issue run** combines the two. Patchmill keeps running its
workflow, and the maintainer takes part in a Pi conversation with the agent.

## What success looks like

The main case, in the maintainer's words: "me and the agent collaborate on the
spec and/or plan and it feeds straight into implementation and landing using the
configured Patchmill skills."

A maintainer runs one command on an existing issue. They work out the spec and
plan with the agent in a Pi chat. When they agree, the agent commits, pushes,
and opens any planning pull request, as the planning skill already requires, and
Patchmill checks the result. If a planning gate is on, they keep talking while
the planning pull request is reviewed. When the maintainer says it is merged,
the agent tells Patchmill to go on. Patchmill then runs implementation in the
background in the same process. The Issue run stays active until the
implementation pull request is merged. Throughout, the same conversation stays
open. The maintainer can ask the agent where things stand, and the agent
investigates and answers at once. When the Issue run ends, the chat stays open
for more instructions, including another issue.

## Goals

1. Run spec and plan work as a conversation between the maintainer and the
   agent, then go straight into implementation and landing in the same process.
   This is the most important goal.
2. Keep one agent conversation from spec to landing, like a single Pi session.
   The agent remembers the spec discussion when it explains later work.
3. Let the maintainer ask about progress at any time and get an answer at once,
   even while a worker is busy. The agent can also make changes, like any coding
   agent.
4. When a worker gets blocked, bring its questions to the console and keep the
   Run attempt going. Once the maintainer confirms the answer, continue the same
   phase. Do not exit and wait for a relabel.
5. If the console crashes or is killed, the same command resumes the Issue run
   from git and the host, and reopens the conversation.
6. Keep the Issue run active until the implementation pull request is merged.
   Then keep the console open, so the maintainer can give more instructions or
   start another Issue run.
7. Optional, and the first thing to cut: open an issue that a non-interactive
   run stopped with `needs-info`, and sort it out in the console.

## Non-goals

- Starting an interactive run from a rough idea. The issue must already exist.
- Detaching from a run and reattaching later, or attaching from a second
  terminal. This can be added later as a separate feature.
- A Patchmill-owned terminal screen with several panes.
- Changing how the spec gate and plan gate work.
- Changing how non-interactive runs behave.
- Steering a busy worker in the middle of an approved plan. The maintainer
  expects this to be rare. The design must not prevent it later, but the first
  version does not need to support it well.
- Live subagent or task tracking in Patchmill code. The kernel removed subagent
  progress correlation and the todo contract on purpose. The console agent can
  read logs and `pi-subagents` controls instead.

## Anti-goals

These would make the work a failure even if it ran:

- **Two copies of the workflow.** Interactive and non-interactive runs must use
  one Run-once workflow, `runOneIssue`. They may differ only where the workflow
  needs a human: the console in one case, issue comments and labels in the
  other. If interactive runs got their own phase rules, envelope, skills, or
  verification, the copies would drift.
- **The agent decides the next step.** The console agent must not pick phases or
  drive the workflow by calling `patchmill` commands in sequence. The agent may
  tell Patchmill to go on once the maintainer says a human step is done, such as
  a merge. Patchmill derives what happens next from git and the host, as it does
  now.
- **A second state machine.** Interactive runs must not persist workflow state.
  The kernel design rules this out: "If a change needs persisted workflow state,
  it is the wrong change." Every decision comes from facts that Patchmill
  derives again from git and the host. Pi session files may give an agent its
  conversation back. They never decide a phase, a wait, or an outcome.
- **A block ends the Run attempt.** If a blocked worker in an interactive run
  still posts its questions, applies `needs-info`, and exits, goal 4 is not met.
  This is true even if the agent starts a new attempt automatically.

## Decisions made by the maintainer

| Topic                          | Decision                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starting point                 | An interactive run starts from an existing issue.                                                                                                                                                                                         |
| Who answers questions          | Non-interactive runs keep using issue comments, whether or not the maintainer is around. Interactive runs use the console.                                                                                                                |
| Process lifetime               | The console and the Issue run share one process, like a non-interactive run today. Killing the console stops the worker too.                                                                                                              |
| Resume                         | If the console crashes or is killed, running the same command resumes the Issue run and the conversation. This builds on the kernel's resume, which derives the phase from git and the host.                                              |
| Being away                     | The maintainer may leave the terminal. The session waits, however long it takes.                                                                                                                                                          |
| One agent                      | One conversation from spec to landing, like a single Pi session.                                                                                                                                                                          |
| Answering questions            | The console agent investigates and answers at once. It is not blocked by the work.                                                                                                                                                        |
| Background work                | Apart from spec and plan, Patchmill runs phases in the background so the console stays free.                                                                                                                                              |
| Agent edits                    | The console agent can make changes, like a normal coding agent.                                                                                                                                                                           |
| Planning gates                 | Unchanged. If a gate is on, its planning pull request is still opened. The console stays open for discussion, but the next stage cannot start until that pull request is merged. If no gate is on, the run continues in the same session. |
| Moving past a merge            | The maintainer tells the agent when a pull request is merged. The agent then calls a Patchmill tool to go on. This applies to planning pull requests and the implementation pull request.                                                 |
| End of an Issue run            | The Issue run does not end before the implementation pull request is merged. Until then, it stays active, reports progress, and answers questions.                                                                                        |
| After an Issue run             | The console does not exit when an Issue run ends. The maintainer can give more instructions or start another Issue run from the chat.                                                                                                     |
| Console interface              | The Patchmill extension gives the agent a set of tools for the workflow.                                                                                                                                                                  |
| Spec changes during a block    | The maintainer's confirmation in the console counts as approval, the same way an issue comment does now. No new pull request has to be merged before the worker continues.                                                                |
| Priority                       | Going straight from spec and plan to implementation comes first. Unblocking a stuck worker comes second. Opening a `needs-info` run from a non-interactive attempt is the first thing to cut if scope grows.                              |
| How the console is built       | Patchmill opens Pi's own chat screen with a Patchmill extension. Patchmill does not build its own terminal screen.                                                                                                                        |
| Slash commands and live status | Welcome, but not core.                                                                                                                                                                                                                    |

## Decisions this revision needs confirmed

The first draft assumed the old engine's Run recovery state. The kernel has
none. These points replace that state with derived facts. Each one changes or
adds to an earlier answer, so the maintainer should confirm them one by one.

| #   | Decision                                                                                                                                                                                                                                                                | Why                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Planning runs inside the Console session. Implementation runs as a background `pi-subagents` worker with forked context, so it starts with the whole conversation. The Patchmill extension starts it, not the console agent. Non-interactive runs keep `pi -p`.         | Goal 2 needs one conversation, and goal 3 needs a free console. Facts, not memory, still decide the next step, so the kernel's reason for fresh sessions still holds. |
| D2  | On restart, Patchmill reopens the Console session file so the conversation comes back. The kernel never reads it to decide anything.                                                                                                                                    | The kernel says session files are "outputs, never inputs". This reads that rule as "never decision inputs".                                                           |
| D3  | A block's confirmed guidance is posted to the issue as a kernel comment before the worker continues. This replaces the first draft's call that console confirmations stay off the issue.                                                                                | Without saved state, the issue is the only place where the guidance survives a crash. The envelope already carries issue comments.                                    |
| D4  | A blocked worker continues through `pi-subagents` `resume`, with the guidance as its message. If the process dies first, the next attempt starts a fresh worker, and that worker reads the guidance from the issue.                                                     | This keeps the worker's context while the process lives, and it needs no saved state when the process dies.                                                           |
| D5  | In an interactive run, an open, ready implementation pull request that closes the issue is a wait, not a reason to start another implementation session. A non-interactive rerun keeps deriving `implementation` there, as it does now.                                 | Goal 6 needs a wait that a restart can see again. This fact comes from the host, so no state is needed.                                                               |
| D6  | An interactive Run attempt holds the issue lock and `in-progress` until the Issue run ends. Patchmill publishes the one kernel stop (label and comment) only then. A clean quit publishes the stop for the current facts, the same way a non-interactive attempt would. | The kernel posts exactly one comment per stop. Waits inside an interactive attempt are not stops.                                                                     |
| D7  | The worker never outlives the console. On a clean exit, the extension stops it with `pi-subagents` `stop`. After a hard kill, the restart stops any worker still running in the reopened Console session, and waits for it to exit, before it derives a phase.          | `pi-subagents` background runs keep going when the launching process dies. Without this rule, two workers could write to one worktree.                                |

## How the kernel shapes this design

The kernel design and the planning merge gates design set these rules. This
design keeps all of them.

- `runOneIssue` (`src/kernel/run-once.ts`) claims the issue, takes the issue
  lock, and runs a loop. Each step derives facts (`src/kernel/facts.ts`), picks
  a phase or a stop (`src/kernel/phase.ts`), runs one Pi session, and checks the
  outcome against git and the host (`src/kernel/verify.ts`).
- There are two phases, `planning` and `implementation`. Planning has a stage:
  `spec`, `plan`, or `implementation`. Required gates use the branches
  `agent/issue-N--spec` and `agent/issue-N--plan`. Only a merged planning pull
  request opens a gate.
- The agent owns git, the branch, and the pull request. The kernel owns labels
  and the one comment per stop.
- The prompt is one envelope (`src/kernel/run-envelope.md`). The result is a
  final JSON block with `status` (`done`, `needs-input`, or `failed`) and
  `summary`.
- No workflow state is saved. A rerun derives the phase again. `result.json`,
  `pi.log`, and session files are written for people and never read to decide.

## How it works

### Starting a run

The maintainer runs:

```sh
patchmill run-once --issue 142 --interactive
```

_My call:_ this is a flag on `run-once`, not a new command, because it is the
same Run-once workflow. `--interactive` requires `--issue`, which names the
first Issue run of the console session. If later issues in the same session make
the name `run-once` confusing, a separate `patchmill console` command can be
added. It must call the same workflow.

Patchmill opens Pi's interactive chat in the same process, using the Pi SDK
(`InteractiveMode` with `createAgentSessionRuntime`, both exported by
`@earendil-works/pi-coding-agent` 1.4.0). The session loads a Patchmill
extension, `pi-subagents`, and the Patchmill skills. It runs with the same agent
directory as background phases (`pi.agentDir`). The start tool then calls
`runOneIssue` for the issue. Selection, the claim, and the lock work as they do
now.

`runOneIssue` takes one new, optional dependency: a human channel. Without it,
the workflow behaves exactly as it does today. With it, the workflow hands two
things to the console instead of handling them itself:

1. **Planning sessions.** The envelope goes to the Console session instead of a
   `pi -p` child.
2. **Implementation sessions.** The envelope goes to a `pi-subagents` worker
   instead of a `pi -p` child.
3. **Stops that wait for a human.** The workflow waits in the process instead of
   publishing the stop and returning.

Everything else stays shared: facts, phase rules, the envelope, skills, result
parsing, verification, the time limit, labels, and the final comment. Only the
launcher differs. The existing `output` dependency already carries every line
the workflow prints, so the console sends it to the chat or a status widget
instead of the terminal.

### Patchmill tools in the console

The Patchmill extension gives the console agent a small set of tools. The agent
uses them to act for the maintainer. Each tool hands control to kernel code.
None of them lets the agent choose a phase.

| Tool                         | What it does                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start an Issue run           | Starts `runOneIssue` for an issue. The command uses it for the first issue. The agent uses it for later issues, after the maintainer confirms, because it claims the issue on the host. |
| Submit the planning result   | Hands Patchmill the result contract (`status` and `summary`) after the maintainer confirms. See the next section.                                                                       |
| Continue the Issue run       | Used when the maintainer says a pull request is merged. Patchmill derives the facts again and follows them. If the pull request is still open, the tool says so and changes nothing.    |
| Confirm guidance for a block | Slice 2. See "When a worker is blocked".                                                                                                                                                |
| Read run status              | Read-only. See "Asking about progress".                                                                                                                                                 |

_My call:_ the continue tool asks for no extra confirmation. Patchmill checks
the merge on the host itself, so a mistaken call does no harm.

_My call:_ a console session runs one Issue run at a time. Running several in
parallel is a later feature.

### Planning in the conversation

When the derived phase is `planning`, Patchmill runs it inside the Console
session instead of in a `pi -p` process (D1):

1. Patchmill renders the same envelope, with the same facts, the
   `patchmill-planning` skill, and the issue boundary. It sends the envelope to
   the Console session as a new message. Only the parts about reaching a human
   change: one envelope line says a maintainer is present, so the agent asks
   them in the chat instead of returning `needs-input`. It returns its result
   through the submit tool instead of a final JSON block. _My call:_ these are
   template switches in the one envelope file, not a second envelope.
2. The agent and the maintainer work out the spec, or the plan. The agent writes
   it at the exact Spec or Plan path in the worktree the envelope names, as the
   skill already requires.
3. When the maintainer agrees, the agent commits and pushes. If the Gate fact
   requires it, the agent opens the planning pull request with `Refs #N`. The
   agent then calls the submit tool with `status` and `summary`. _My call:_ the
   tool asks the maintainer to confirm before Patchmill accepts the result. The
   maintainer's yes is then an explicit, recorded action rather than something
   the agent read into the chat.
4. Patchmill checks the outcome with `verifyOutcome`, as it does after a print
   mode session. _My call:_ if the check fails, Patchmill does not stop the
   attempt. It returns the reasons to the agent in the chat, for example "No
   planning pull request exists for the branch." The agent fixes the problem and
   submits again in the same Run attempt. A non-interactive run would stop with
   `needs-info` here. That is a human step, so the console takes it.
5. Patchmill derives the facts again. If a gate holds the run, it waits (see
   "Waiting for a merge"). If not, it moves straight on, either to the plan or
   to implementation.

### Waiting for a merge

There are two waits. Both come from facts, so a restart finds them again.

- **A planning gate.** Today `derivePhase` returns a stop with `inProgress` when
  a planning pull request is open, and the attempt ends. In an interactive run
  the attempt waits there instead. The issue keeps `in-progress`, and the
  process keeps the lock.
- **The implementation pull request.** Today a verified implementation stops
  with `agent-done`, and the attempt ends. In an interactive run the attempt
  waits there instead (D5, D6).

During either wait, the maintainer and the agent can keep talking. When the
maintainer says the pull request is merged, the agent calls the continue tool.
Patchmill fetches and derives the facts again:

| Derived result                                   | What the continue tool does                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Planning pull request still open                 | Reports the gate comment that `planningGateComment` builds now. Changes nothing.              |
| Planning pull request merged                     | Goes on in the same Run attempt with the next derived phase.                                  |
| Implementation pull request still open and ready | Reports that it is not merged. Changes nothing.                                               |
| Implementation pull request merged               | Ends the Issue run: publishes the merged stop (`agent-done` and one comment) and releases it. |
| Any `needsInfo` stop, such as a closed PR        | Shows the reason in the chat. See "Stops that need a human".                                  |

_My call:_ while the implementation pull request waits and no worker is active,
the console agent may push review fixes to the issue branch, like a normal
coding agent. The kernel never deletes worktrees, so the issue worktree is still
there. The pull request stays the same pull request, because its identity is the
head branch, not a commit.

### Implementation in the background

In an interactive run, the Patchmill extension starts `implementation` through
the `pi-subagents` in-process RPC (`subagents:rpc:v1:request`) with `spawn`
(D1):

- The task is the same envelope, with the `patchmill-implementation` skill.
- The context is `fork`, so the worker starts with the Console session's
  conversation, including the spec and plan discussion. The envelope and the
  spec and plan files still define the work.
- The working directory is the issue worktree. The time limit is
  `pi.timeoutMinutes`.
- Patchmill waits for the run's completion event, reads the worker's final
  output with `parseAgentResult`, and checks it with `verifyOutcome`, as it does
  for `pi -p`.

The console agent never calls the `subagent` tool to start a phase. That would
let the agent pick the next step. It may still use subagents for its own
research or review, like any coding agent. The worker runs in the background, so
the console agent is free to answer.

The implementation skill may start its own reviewer subagent. `pi-subagents`
allows two levels by default (console, worker, worker's child), so that fits.
The worker's agent definition must list `subagent` among its tools.

Non-interactive runs keep the `pi -p` child under `supervisePi`. They have no
parent Pi session to start a subagent from.

Patchmill reports progress to the chat: phase starts, phase completion with
usage, pull request links, and the outcome. These are the lines that
`formatPhaseStart`, `formatPhaseComplete`, and `formatRunResult` already build.
_My call:_ use Pi extension messages and a status widget for them, not raw
terminal output, because Pi owns the terminal.

### Asking about progress

The status tool returns one snapshot of the current Issue run, built in memory
by the running workflow: issue, derived facts (branch, worktree, spec, plan,
pull request, stage), current phase, session number, elapsed time, the worker's
`pi-subagents` run ID and state, usage and cost so far, and the paths of the run
directory and the worker's session file. It is read-only. The agent can also
read files and logs and run commands, like any coding agent.

_My call, following the issue's recommendation:_ the extension gets this
information through one in-process interface that returns a snapshot and a
stream of run events. It does not read run directories on its own. The interface
keeps nothing on disk, so it is not workflow state. A later web view or reattach
feature can use the same interface.

The snapshot has no task number. The kernel does not track tasks. For more
detail, the agent can read the worker's transcript and children through the
`pi-subagents` `status` RPC, and the maintainer can open its fleet view.

### Stops that need a human

Every `needsInfo` stop in the kernel means "a human must look". Examples are a
worker that returns `needs-input` or `failed`, a session with no result or a
timeout, a check that fails, a closed planning pull request, a pull request into
the wrong base, and several issue branches.

- **Planning checks** go back to the agent in the chat, as described above
  (slice 1).
- **A blocked implementation worker** stays in the Run attempt (slice 2). See
  the next section.
- **All other stops** in the first version show their reason in the chat, and
  the agent explains them. Patchmill then publishes the stop as it does now
  (`needs-info` and one comment) and ends the Issue run. The console stays open.
  Rerunning the command, or the start tool, starts a new attempt that derives
  the phase again.

### When a worker is blocked

Today a worker that returns `needs-input` ends the attempt. `verifyOutcome`
returns a stop with `needsInfo`. Patchmill posts the summary as the kernel
comment, applies `needs-info`, and exits. The worker has already committed and
pushed, as the envelope requires.

In an interactive run (slice 2):

1. Patchmill does not publish the stop. It keeps the lock and `in-progress`. It
   sends the worker's summary, which holds its questions, to the chat. The
   console agent takes a turn to explain the questions and look into the cause.
2. The maintainer and the agent work it out. If the spec missed something, the
   agent updates the spec in the issue worktree, after the worker has stopped.
   _My call:_ spec changes during implementation go on the issue branch, so they
   appear in the implementation pull request.
3. The agent states what it understood and the guidance it will pass on. The
   maintainer confirms through the guidance tool. This counts as approval.
4. Patchmill posts the confirmed guidance to the issue as a kernel comment (D3).
5. Patchmill continues the same phase in the same worker session through
   `pi-subagents` `resume`, with the guidance as the message (D4). It verifies
   the worker's new result in the usual way.

If the process dies before step 4, nothing about the block was saved. The next
attempt derives `implementation` again, and the fresh worker may ask again.
Nothing is lost, because the worker pushed its work. If the process dies after
step 4, the fresh worker reads the guidance from the issue comments in its
envelope.

### Crash, kill, and resume

The worker must not outlive the console (D7). `pi-subagents` runs a background
worker in a detached runner, and that runner keeps working if the console dies.
`pi-subagents` can stop it, and its stop requests go through files, so they work
from a new process too. Patchmill uses that in two places:

- **Clean exit.** On `session_shutdown`, the extension calls `stop` for its
  worker and waits until the run reports that its process has exited.
- **Hard kill or crash.** No handler runs, so the worker may still be running.
  On restart, after Patchmill reopens the Console session and before it derives
  a phase, it asks `pi-subagents` `status` for workers that the extension
  started in that session. It stops each one and waits for its exit. Only then
  does the new attempt start a fresh worker.

This check reads `pi-subagents` run state only to find and stop a stray process.
It never decides a phase, so it is not workflow state.

The operating system releases the issue lock when the console process dies. The
issue keeps `in-progress`, because no stop was published.

Running the same command again resumes the Issue run in a new Run attempt. The
kernel already selects `in-progress` issues and derives the phase from what
exists. A planning gate or the implementation pull request is still a wait,
because both come from host facts. Patchmill reopens the Console session, so the
chat shows the conversation so far (D2).

_My call:_ one console session can hold more than one Issue run, so its Pi
session files live in their own directory, `<runsDir>/console/sessions/`. A
restart reopens the newest session there, the way Pi's own `--continue` does. No
Issue run records the path, because nothing reads it to decide anything.

### Opening a `needs-info` run (optional, cut first)

`patchmill run-once --issue 142 --interactive` on an issue that a
non-interactive attempt stopped with `needs-info`:

1. Works without a relabel. An explicit `--issue` already selects any open
   issue, and the claim already removes `needs-info`.
2. The agent shows the last kernel comment and the issue comments in the chat.
3. The maintainer's confirmed answer is posted as a kernel comment, as in slice
   2, so the next session's envelope carries it.

The phase restarts with a fresh session, because the earlier worker has exited.

### While the agent waits

While the run waits for the maintainer, nothing else in the run moves forward.
Waiting time is not a failure or a timeout. The `pi.timeoutMinutes` limit
applies only to background Pi sessions. The process holds the issue lock, so no
other Run attempt in the same clone can take the issue.

_My call:_ while a worker is active, the console agent does not edit the issue
worktree. If the maintainer asks for a change there, the agent says so and waits
for the worker to finish or block. This keeps one writer per worktree. Better
support for changes during a busy worker is a later feature.

The kernel loop runs at most three sessions per attempt. _My call:_ in an
interactive attempt the limit counts sessions since the last human input, so a
long Issue run with several waits does not hit it, but a run that never advances
still stops.

### Record of decisions

- A confirmed planning result is recorded by the commits and the planning pull
  request that the agent pushed. Patchmill also writes the confirmation into the
  run's `result.json`, which nothing reads to decide.
- Confirmed block guidance is a kernel comment on the issue (D3).
- Spec changes are explained in their commit messages.

## Answers to the questions in the issue

| #   | Question                                                                    | Answer                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Foreground only, or does the run continue after the console exits?          | Foreground only. The run stops with the console.                                                                                                                                                                   |
| 2   | Attach from a second terminal or after a restart?                           | No second terminal. After a crash or kill, the same command resumes.                                                                                                                                               |
| 3   | Is the conversational agent the orchestrator, or a separate operator agent? | Patchmill orchestrates. The console agent runs planning in conversation, supervises the background phases, and calls Patchmill tools to start a run or go on after a merge. Patchmill derives what each call does. |
| 4   | One Pi session for the whole run, or one per stage?                         | One Console session for planning and for the conversation, across the Issue run and later Issue runs started from it. Each implementation worker forks it. Non-interactive runs keep fresh sessions, as now.       |
| 5   | Which interventions are allowed while a stage is active?                    | First version: questions, investigation, and answers to blocks. Steering a busy worker is a later feature. `pi-subagents` `steer` makes it cheap to add.                                                           |
| 6   | Which operations need explicit confirmation?                                | Accepting a planning result, confirming guidance for a block, and starting another Issue run from the chat. Going on after a merge needs only the maintainer's word, because Patchmill checks the merge.           |
| 7   | Live steering of subagents, or resuming finished ones?                      | Bonus. `pi-subagents` already provides its own controls. Patchmill uses `resume` only to continue a blocked worker.                                                                                                |
| 8   | How does the UI name a subagent?                                            | Not Patchmill's concern. `pi-subagents` names them.                                                                                                                                                                |
| 9   | How to avoid double-counting live cost?                                     | Left to the builder. Reuse `sumSessionUsage` in `src/kernel/pi-cost.ts` on the session files that the `pi-subagents` `cost` RPC names.                                                                             |
| 10  | Label live cost as estimated until settled?                                 | _My call:_ yes.                                                                                                                                                                                                    |
| 11  | What is authoritative after reconnect?                                      | Git and the host, through the derived facts. The Console session file holds only the conversation.                                                                                                                 |
| 12  | Pi-based console or Patchmill-owned TUI?                                    | Pi-based console.                                                                                                                                                                                                  |

## Constraints

- Pi 1.4.0 (`@earendil-works/pi-coding-agent`) is the pinned runtime. Its SDK
  exports `InteractiveMode` and `createAgentSessionRuntime`. Extensions can
  register tools and commands, set widgets and status, and send messages into
  the session, including follow-up messages delivered when the agent is idle.
- Non-interactive phases run Pi through `supervisePi` in
  `src/kernel/pi-supervisor.ts`, in print mode with `--session-dir`. The result
  comes from `parseAgentResult` in `src/kernel/result.ts`. RPC mode (#305) would
  change only supervision and does not affect this design.
- `pi-subagents` 0.80.0 is the pinned version. Its in-process RPC offers `spawn`
  (background only, with `fresh` or `fork` context), `steer`, `resume`, `stop`,
  `status`, and `cost`, and sends a completion event. `stop` and `resume` act on
  runs of the current session, which is why the restart reopens the same Console
  session first.
- The envelope is one template file under 150 lines. Interactive changes to it
  must stay within that limit.
- Planning gates are configured under `workflow.specApproval` and
  `workflow.planApproval`. Both default to not required.
- When npm dependencies change, rerun the Nix build. After changing how Pi
  extensions load, run the extension-load check in the project instructions.

## Left to the builder

- How the workflow and the chat share one process and one event loop.
- How the extension tags its workers so that the restart check finds only
  Patchmill's workers, and how long it waits for one to exit.
- Where the worker's session file and transcript are copied or linked under the
  run directory, so the run directory stays the one place to look.
- The exact shape of the human channel dependency on `runOneIssue`.
- The exact names and shapes of the extension tools, the run snapshot, and run
  events.
- Whether Patchmill also watches for merges on its own and tells the chat. This
  is not required.
- Which slash commands to add, if any, and what the status widget shows.
- How live cost is calculated and shown, and whether the Console session's own
  usage counts toward the issue's cost report.

## First slices

Build these in order. Each slice should leave non-interactive runs unchanged.

1. **Planning conversation through to a merged pull request.** `--interactive`
   opens the chat. Planning runs in the conversation with confirmed results.
   Gates hold the run until the maintainer says the planning pull request is
   merged and the agent calls the continue tool. Implementation runs in the
   background with progress in the chat. The run waits for the implementation
   pull request in the same way, then ends. The agent can answer progress
   questions from the snapshot. A crash or kill resumes both the run and the
   conversation.
2. **Unblock in place.** A blocked worker's questions go to the chat. The
   confirmed guidance is posted to the issue and continues the same phase and Pi
   session without a new Run attempt.
3. **Another issue in the same session.** After an Issue run ends, the agent can
   start another one with the start tool.
4. **Open a `needs-info` run (optional).** As described above.

## Verification

Use end-to-end tests of `runOneIssue` with a fake host and fake Pi, as
`src/kernel/run-once.test.ts` and `src/kernel/planning-gates.test.ts` do. Add a
fake human channel. Do not test the TUI rendering itself.

- With no gates, an interactive run goes from a confirmed spec and plan to a
  verified implementation pull request in one Run attempt.
- A planning result that fails `verifyOutcome` returns the reasons to the
  conversation, and a corrected result is accepted in the same Run attempt. No
  `needs-info` label or comment is posted.
- With the spec gate on, the run waits after the agent opens the spec pull
  request. The issue keeps `in-progress`. A continue call before the merge
  reports the gate and changes nothing. A continue call after the merge goes on
  in the same Run attempt.
- After the implementation pull request is verified, the Issue run waits. No
  stop is published yet. A continue call after the merge publishes one
  `agent-done` comment and ends the Issue run. The console stays open.
- A clean quit during a wait publishes the same stop that a non-interactive
  attempt would publish for those facts.
- After a kill during a gate wait or the implementation wait, the same command
  waits again without starting a Pi session, and reopens the Console session.
- After a kill during implementation, the same command stops the stray worker,
  waits for it to exit, then derives `implementation` and starts a fresh worker.
  No Patchmill state file is read.
- A clean quit while a worker runs stops the worker before the process exits.
- An interactive implementation phase starts its worker through a fake
  `pi-subagents` RPC with forked context, and its result goes through the same
  parsing and verification as a `pi -p` result.
- Slice 2: a `needs-input` implementation result does not post a stop or end the
  Run attempt. Confirmed guidance is posted to the issue and reaches the same
  worker through `resume`, and the phase continues.
- Slice 3: after an Issue run ends, a start call runs a second issue in the same
  console session.
- The existing kernel test suite passes unchanged. In particular, a
  non-interactive `needs-input` result still posts its summary and exits, and a
  non-interactive rerun on a ready pull request still derives `implementation`.
- Manual check: run one real interactive Issue run on a test repository from
  spec to a merged implementation pull request.

## Glossary impact

`CONTEXT.md` has no term for an Issue run that takes human input through a
console. If this design is approved, add **Interactive Issue run**, **Console
session**, and **Console agent** through domain modeling. The first draft also
used **Phase workspace** and **Run recovery state**. The kernel retired both,
and this revision no longer uses them.
