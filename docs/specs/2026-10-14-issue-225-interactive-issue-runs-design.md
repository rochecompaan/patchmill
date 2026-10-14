# Interactive Issue runs

- **Issue:** #225
- **Status:** Proposed design
- **Scope:** A first version of interactive Issue runs, started from an existing
  issue, in one terminal

## Why

Today a Patchmill Issue run talks to the maintainer only through the issue. Two
things follow from that.

1. **Spec and plan work is one-way.** The planning agent writes the spec and
   plan on its own. The maintainer cannot work them out with the agent the way
   they would in a normal Pi session.
2. **A blocked run is slow to unblock.** The run posts its questions as an issue
   comment and exits. The maintainer comments, marks the issue ready again, and
   starts a new Run attempt. Patchmill then works through its recovery steps to
   find where it stopped. This is slow, and the maintainer gets no sign that the
   agent understood the answer until they see what it does next.

Plain Pi does not solve this. It gives a conversation but not the workflow. In
plain Pi the maintainer must tell the agent each next step. They also lose
Patchmill's issue states, the planning, implementation, landing, and
visual-evidence skills, the adversarial reviews already set up for the project,
and the checks the workflow makes along the way.

An **interactive Issue run** combines the two. Patchmill keeps running its
workflow, and the maintainer takes part in a Pi conversation with the agent.

## What success looks like

The main case, in the maintainer's words: "me and the agent collaborate on the
spec and/or plan and it feeds straight into implementation and landing using the
configured Patchmill skills."

A maintainer runs one command on an existing issue. They work out the spec and
plan with the agent in a Pi chat. Once they agree, Patchmill runs its usual
checks, reviews, and PR steps. If approval is required, they keep talking while
the Planning pull request is reviewed. When the maintainer says it is merged,
the agent tells Patchmill to go on. Patchmill then runs implementation in the
background in the same process. The Issue run stays active until the
implementation pull request is merged and Patchmill has finished its last steps.
Throughout, the same conversation stays open. The maintainer can ask the agent
where things stand, and the agent investigates and answers at once. When the
Issue run ends, the chat stays open for more instructions, including another
issue.

## Goals

1. Run spec and plan phases as a conversation between the maintainer and the
   agent, then go straight into implementation and landing in the same process.
   This is the most important goal.
2. Keep one agent conversation from spec to landing, like a single Pi session.
   The agent remembers the spec discussion when it explains later work.
3. Let the maintainer ask about progress at any time and get an answer at once,
   even while a worker is busy. The agent can also make changes, like any coding
   agent.
4. When a worker gets blocked, keep the stage where it is and bring the
   questions to the console. Once the maintainer confirms the answer, continue
   the same stage. Do not exit or restart.
5. If the console crashes or is killed, the same command resumes both the Issue
   run and the conversation.
6. Keep the Issue run active until the implementation pull request is merged and
   Patchmill has finished its checkpoints. Then keep the console open, so the
   maintainer can give more instructions or start another Issue run.
7. Optional, and the first thing to cut: open an Issue run that a
   non-interactive run left blocked, and sort it out in the console.

## Non-goals

- Starting an interactive run from a rough idea. The issue must already exist.
- Detaching from a run and reattaching later, or attaching from a second
  terminal. This can be added later as a separate feature.
- A Patchmill-owned terminal screen with several panes.
- Changing how approval works for spec and plan PRs.
- Changing how non-interactive runs behave.
- Steering a busy worker in the middle of an approved plan. The maintainer
  expects this to be rare. The design must not prevent it later, but the first
  version does not need to support it well.

## Anti-goals

These would make the work a failure even if it ran:

- **Two copies of the workflow.** Interactive and non-interactive runs must use
  one Run-once workflow. They may differ only where the workflow needs a human:
  the console in one case, issue comments in the other. If interactive runs got
  their own copy of the stage logic, prompts, or checks, the copies would drift.
- **The agent decides the next step.** The console agent must not pick stages or
  drive the workflow from its prompt by calling `patchmill` commands in
  sequence. The agent may tell Patchmill to go on once the maintainer says a
  human step is done, such as a merge. Patchmill decides what happens next, as
  it does now.
- **Blocks still restart the run.** If a blocked worker still ends the Run
  attempt and a fresh attempt runs recovery, goal 4 is not met. This is true
  even if the agent restarts the run automatically.

## Decisions made by the maintainer

| Topic                          | Decision                                                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starting point                 | An interactive run starts from an existing issue.                                                                                                                                                                                                                     |
| Who answers questions          | Non-interactive runs keep using issue comments, whether or not the maintainer is around. Interactive runs use the console.                                                                                                                                            |
| Process lifetime               | The console and the Issue run share one process, like a non-interactive run today. Killing the console stops the worker too.                                                                                                                                          |
| Resume                         | If the console crashes or is killed, running the same command resumes the Issue run and the conversation. This builds on Patchmill's existing resume.                                                                                                                 |
| Being away                     | The maintainer may leave the terminal. The session waits, however long it takes.                                                                                                                                                                                      |
| One agent                      | One conversation from spec to landing, like a single Pi session.                                                                                                                                                                                                      |
| Answering questions            | The console agent investigates and answers at once. It is not blocked by the work.                                                                                                                                                                                    |
| Background work                | Apart from spec and plan, Patchmill runs stages in the background so the console stays free.                                                                                                                                                                          |
| Agent edits                    | The console agent can make changes, like a normal coding agent.                                                                                                                                                                                                       |
| Approval gates                 | Unchanged. If the project requires approval, spec and plan PRs are still opened. The console stays open for discussion, but implementation cannot start until the Planning pull request is merged. If no approval is required, the run continues in the same session. |
| Moving past a merge            | The maintainer tells the agent when a pull request is merged. The agent then calls a Patchmill tool to go on. This applies to the Planning pull request and the implementation pull request.                                                                          |
| End of an Issue run            | The Issue run does not end before the implementation pull request is merged and Patchmill has finished its checkpoints. Until then, it stays active, reports progress, and answers questions.                                                                         |
| After an Issue run             | The console does not exit when an Issue run ends. The maintainer can give more instructions or start another Issue run from the chat.                                                                                                                                 |
| Console interface              | The Patchmill extension gives the agent a set of tools for the workflow.                                                                                                                                                                                              |
| Spec changes during a block    | The maintainer's confirmation in the console counts as approval, the same way an issue comment does now. No new PR has to be merged before the worker continues.                                                                                                      |
| Priority                       | Going straight from spec and plan to implementation comes first. Unblocking a stuck worker comes second. Opening a non-interactive blocked run is the first thing to cut if scope grows.                                                                              |
| How the console is built       | Patchmill opens Pi's own chat screen with a Patchmill extension. Patchmill does not build its own terminal screen.                                                                                                                                                    |
| Slash commands and live status | Welcome, but not core.                                                                                                                                                                                                                                                |

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

Patchmill selects, claims, and recovers the issue as it does now. It then opens
Pi's interactive chat in the same process, using the Pi SDK (`InteractiveMode`
with `createAgentSessionRuntime`, both exported by
`@earendil-works/pi-coding-agent` 1.2.0). The session loads a Patchmill
extension, `pi-subagents`, and the skills the workflow would load for the
current stage.

The Run-once workflow runs alongside the chat in the same process. Patchmill
owns the order of stages. The chat is where the maintainer takes part.

### Patchmill tools in the console

The Patchmill extension gives the console agent a small set of tools. The agent
uses them to act for the maintainer. Each tool hands control to Patchmill code
that already exists. None of them lets the agent choose a stage.

| Tool                         | What it does                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start an Issue run           | Selects and claims an issue, then starts the Run-once workflow for it. The command uses it for the first issue. The agent uses it for later issues, after the maintainer confirms, because it changes the issue on the host.                                |
| Submit a spec or plan        | Hands Patchmill the typed planning result after the maintainer confirms. See the next section.                                                                                                                                                              |
| Continue the Issue run       | Used when the maintainer says a pull request is merged. Patchmill runs its coordinator again from the Run recovery state. This is the same code a rerun of the command uses today. If the pull request is not merged, the tool says so and changes nothing. |
| Confirm guidance for a block | Slice 2. See "When a worker is blocked".                                                                                                                                                                                                                    |
| Read run status              | Read-only. See "Asking about progress".                                                                                                                                                                                                                     |

_My call:_ the continue tool asks for no extra confirmation. Patchmill checks
the merge on the issue host itself, so a mistaken call does no harm.

_My call:_ a console session runs one Issue run at a time. Running several in
parallel is a later feature.

### Spec and plan phases

For the spec phase and then the plan phase, Patchmill runs its planning stage
inside the console conversation instead of in a `pi -p` process:

1. Patchmill sends the same stage prompt and skills it would use in print mode
   (`patchmill-planning`, which wraps brainstorming and writing-plans). Only the
   parts about reaching a human change: the agent may ask the maintainer
   questions in the chat instead of deciding alone.
2. The agent and the maintainer work out the spec or plan. The agent writes it
   in the active Phase workspace, as the planning skill already requires.
3. When the maintainer agrees, the agent hands Patchmill the same typed result
   the print-mode agent prints as final JSON (`spec-created` or `plan-created`).
   _My call:_ it does this through a Patchmill tool, and the tool asks the
   maintainer to confirm before Patchmill accepts the result. The maintainer's
   yes is then an explicit, recorded action rather than something the agent read
   into the chat.
4. Patchmill validates and publishes the result with its existing code: artifact
   checks, reviews, commits, and the Planning pull request. _My call:_ if a
   check fails before Patchmill publishes anything, the error comes back to the
   agent in the chat. The agent fixes the spec or plan and submits it again in
   the same Run attempt. Failures after publication follow the general failure
   rule below.
5. If a Planning review gate applies, the run waits for the Planning pull
   request to be merged. The chat stays open, and the maintainer and agent can
   keep talking. When the maintainer says the pull request is merged, the agent
   calls the continue tool. Patchmill checks the merge with its existing code
   and goes on in the same Run attempt. If no gate applies, the run moves
   straight on.

Today the workflow returns `review-pending` at this point
(`src/cli/commands/run-once/planning-phase-runner-shared.ts`), and the Run
attempt ends. In an interactive run, the workflow pauses there instead, and the
continue tool starts the coordinator again in the same process.

### Development environment, implementation, and landing

Patchmill runs these stages in the background as it does now, as `pi -p` child
processes with their own Pi session logs. The console agent does not run them,
so it is free to answer.

Patchmill reports stage progress to the chat: stage changes, task progress, PR
links, and the final outcome. _My call:_ use Pi extension messages and a status
widget, not raw terminal output. Today the workflow writes progress to the
terminal (`console-progress.ts`). In interactive mode, Pi owns the terminal, so
that output must go to the chat, a widget, or the log file instead.

### Waiting for the implementation pull request

Today the workflow returns `implementation-published` once the implementation
pull request is open, and the Run attempt ends
(`src/cli/commands/run-once/planning-finish.ts`, around line 240). The
maintainer merges the pull request and runs the command again to finish.

In an interactive run, the Issue run pauses there instead and stays active. The
maintainer reviews the pull request and can talk it over with the agent. When
the maintainer says it is merged, the agent calls the continue tool. Patchmill
then runs its existing finish steps in the same Run attempt: it checks the
merge, applies the done state, and cleans up. Patchmill reports the outcome to
the chat, and the Issue run ends. The console stays open.

_My call:_ while the pull request is open and no worker is active, the agent may
push review fixes to the pull request branch, like a normal coding agent. The
finish step already accepts a merged pull request whose branch moved after
Patchmill opened it. It checks that the merge is in the target branch, not that
the branch is unchanged (`src/workflow/implementation-pr-reconciliation.ts`).

### Asking about progress

The Patchmill extension gives the console agent read-only tools for the current
Issue run: stage, task number and label, elapsed time, cost so far, blockers,
active subagents, and paths to the progress log, Run recovery state, and the
worker's live Pi session log. The agent can also read files and run commands,
like any coding agent.

_My call, following the issue's recommendation:_ the extension reads run
information through one in-process interface that returns a single snapshot and
a stream of run events. It does not read run-state files, progress logs, todo
files, and Pi sessions each on its own. A later web view or reattach feature can
then use the same interface.

### When a worker is blocked

Today, when a stage agent returns `blocked`, Patchmill posts the questions as an
issue comment, applies the needs-info state, and ends the Run attempt. The
current `planning-pr-v1` workflow does this in
`src/cli/commands/run-once/planning-pipeline.ts` (around lines 330 to 356). The
legacy workflow does it in `blockIssue` in
`src/cli/commands/run-once/pipeline-failures.ts`. Interactive runs only need to
support the `planning-pr-v1` workflow.

The Run recovery state for `planning-pr-v1` (`PlanningStateV1` in
`src/workflow/planning-state-types.ts`) has no place for blocker questions or
the blocked worker's Pi session. Slice 2 must add that durable state so a block
waiting in the console survives a crash or kill.

In an interactive run:

1. Patchmill records the block in the Run recovery state, so a crash or kill
   does not lose it. It does not post an issue comment, change the issue's
   state, or end the Run attempt.
2. Patchmill sends the reason and questions to the chat, and the console agent
   takes a turn to explain them and look into the cause.
3. The maintainer and the agent work it out. If the spec missed something, the
   agent updates the spec. _My call:_ spec changes during implementation are
   committed in the implementation Phase workspace, so they appear in the
   implementation PR.
4. The agent states what it understood and the guidance it will pass on. The
   maintainer confirms through the same kind of confirmation tool as in the
   planning phases. This counts as approval.
5. Patchmill continues the same stage. It starts the worker again in the same Pi
   session with a follow-up prompt that contains the confirmed guidance. It does
   not run recovery.

_My call:_ the rule for what goes to the console is any stage outcome that would
make a non-interactive run wait for a human comment. This includes a blocked
implementation agent and a development environment that is not ready. In the
first version, failures that Patchmill detects itself in background stages (for
example a failed commit check after implementation) still end the Run attempt as
they do now. The exception is a spec or plan check that fails before
publication, as described above. The console shows the diagnostic, and the agent
can explain it. Rerunning the same command resumes through the existing
recovery.

### Crash, kill, and resume

Killing the console ends the process and its child Pi processes, as with a
non-interactive run. The Run recovery state is the source of truth for where the
workflow is. _My call:_ because one console session can hold more than one Issue
run, its Pi session file is kept in its own place under the run state directory.
Each Issue run's recovery state records the path of the console session it
belongs to, so a restart can reopen it.

Running the same command again resumes the Issue run through the existing
recovery and reopens the conversation. If the run was waiting for an answer or a
merge, the chat shows that again.

### Opening a non-interactive blocked run (optional, cut first)

`patchmill run-once --issue 142 --interactive` on an issue whose Run recovery
state is blocked:

1. Skips the rule that the issue must be marked ready again
   (`pipeline-selection.ts` rejects an explicit blocked run that is not marked
   ready). The maintainer running the console is the acknowledgement.
2. Shows the recorded questions and the issue comments in the chat.
3. Passes the maintainer's confirmed answer to the resumed stage, the way issue
   comments and `priorBlockerQuestions` reach the stage prompt now.

The stage restarts through the existing recovery, because the earlier worker has
already exited. It does not continue where it stopped.

### While the agent waits

While the run waits for the maintainer, nothing else in the run moves forward.
Waiting time is not a failure or a timeout. The Issue run keeps its current
ownership, so a `patchmill run` coordinator does not select the same issue.

_My call:_ while a worker is active, the console agent does not edit that
worker's Phase workspace. If the maintainer asks for a change there, the agent
says so and waits for the worker to finish or block. This keeps one writer per
workspace. Better support for changes during a busy worker is a later feature.

### Record of decisions

_My call (played back and not corrected):_ console confirmations are not posted
to the issue. They are recorded in the run's progress log, and spec changes are
explained in their commit messages.

## Answers to the questions in the issue

| #   | Question                                                                    | Answer                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Foreground only, or does the run continue after the console exits?          | Foreground only. The run stops with the console.                                                                                                                                                                                   |
| 2   | Attach from a second terminal or after a restart?                           | No second terminal. After a crash or kill, the same command resumes.                                                                                                                                                               |
| 3   | Is the conversational agent the orchestrator, or a separate operator agent? | Patchmill orchestrates. The console agent runs the spec and plan phases in conversation, supervises the background stages, and calls Patchmill tools to start a run or go on after a merge. Patchmill decides what each call does. |
| 4   | One Pi session for the whole run, or one per stage?                         | One console session for the whole Issue run, and for later Issue runs started from it. Background stages keep their own Pi sessions, as now.                                                                                       |
| 5   | Which interventions are allowed while a stage is active?                    | First version: questions, investigation, and answers to blocks. Steering a busy worker is a later feature.                                                                                                                         |
| 6   | Which operations need explicit confirmation?                                | Accepting a spec or plan result, confirming guidance for a blocked stage, and starting another Issue run from the chat. Going on after a merge needs only the maintainer's word, because Patchmill checks the merge.               |
| 7   | Live steering of subagents, or resuming finished ones?                      | Bonus. `pi-subagents` already provides its own controls.                                                                                                                                                                           |
| 8   | How does the UI name a subagent?                                            | Left to the builder.                                                                                                                                                                                                               |
| 9   | How to avoid double-counting live cost?                                     | Left to the builder. Reuse `run-cost.ts`.                                                                                                                                                                                          |
| 10  | Label live cost as estimated until settled?                                 | _My call:_ yes.                                                                                                                                                                                                                    |
| 11  | What is authoritative after reconnect?                                      | The Run recovery state for the workflow, and the console Pi session file for the conversation.                                                                                                                                     |
| 12  | Pi-based console or Patchmill-owned TUI?                                    | Pi-based console.                                                                                                                                                                                                                  |

## Constraints

- Pi 1.2.0 (`@earendil-works/pi-coding-agent`) is the pinned runtime. Its SDK
  exports `InteractiveMode` and `createAgentSessionRuntime`. Extensions can
  register tools and commands, set widgets, and send messages into the session,
  including follow-up messages delivered when the agent is idle.
- Each stage runs Pi through `runPiPrompt` in `src/cli/commands/run-once/pi.ts`,
  in print mode with a `--session` path, and returns a typed result from
  `src/issue-run/types.ts`.
- Approval is configured per project under `workflow.specApproval` and
  `workflow.planApproval`. Both default to not required.
- The `architecture/issue-run-lifecycle` branch has an unmerged design to deepen
  the Issue run module behind `runOneIssue`. This design does not depend on it,
  but the console's handling of human input should fit behind that interface if
  it lands.
- When npm dependencies change, rerun the Nix build. After changing how Pi
  extensions load, run the extension-load check in the project instructions.

## Left to the builder

- How the workflow and the chat share one process and one event loop, and how
  child Pi processes are stopped when the console exits.
- The exact names and shapes of the extension tools, the run snapshot, and run
  events.
- How the console agent finds the active Phase workspace for each phase.
- Whether Patchmill also watches for merges on its own and tells the chat. This
  is not required.
- How the agent gets a checkout for review fixes if the implementation Phase
  workspace was already removed.
- How the interactive prompt variants are kept to the human-input parts only,
  without a second copy of the stage prompts.
- Which slash commands to add, if any, and what the status widget shows.
- How live cost is calculated and shown.

## First slices

Build these in order. Each slice should leave non-interactive runs unchanged.

1. **Spec and plan conversation through to a merged pull request.**
   `--interactive` opens the chat. Spec and plan phases run in the conversation
   with confirmed results. Approval gates hold the run until the maintainer says
   the Planning pull request is merged and the agent calls the continue tool.
   Implementation and landing run in the background with progress in the chat.
   The run waits for the implementation pull request in the same way, then
   finishes. The agent can answer progress questions from the run snapshot.
   Crash and kill resume both the run and the conversation.
2. **Unblock in place.** A blocked worker's questions go to the chat. The
   confirmed answer continues the same stage and Pi session without a new Run
   attempt.
3. **Another issue in the same session.** After an Issue run ends, the agent can
   start another one with the start tool.
4. **Open a non-interactive blocked run (optional).** As described above.

## Verification

Use behavior tests at the workflow seam with fake Pi and host runners, as the
existing `pipeline-*-scenarios` tests do. Do not test the TUI rendering itself.

- An interactive run with no approval gates goes from a confirmed spec to a
  confirmed plan to a published implementation pull request in one Run attempt.
- A spec result that fails an artifact check before publication returns the
  error to the conversation, and a corrected result is accepted in the same Run
  attempt.
- With spec approval required, the run waits after opening the Planning pull
  request. A continue call before the merge reports that the pull request is not
  merged and changes nothing. A continue call after the merge goes on in the
  same Run attempt.
- After the implementation pull request opens, the Issue run stays active. A
  continue call after the merge applies the done state and cleans up in the same
  Run attempt, and the console stays open.
- Slice 3: after an Issue run ends, a start call runs a second issue in the same
  console session.
- A progress question during implementation returns the current stage and task
  while the worker is still running.
- After a kill during implementation, the same command resumes the Issue run and
  reopens the same conversation session.
- Slice 2: a blocked implementation result does not post an issue comment or end
  the Run attempt. The confirmed guidance reaches the same worker session, and
  the stage continues.
- The existing non-interactive test suite passes unchanged. In particular, a
  blocked non-interactive run still posts its questions and exits.
- Manual check: run one real interactive Issue run on a test repository from
  spec to a merged implementation pull request and a finished Issue run.

## Glossary gap

`CONTEXT.md` has no term for an Issue run that takes human input through a
console instead of issue comments. If this design is approved, add **Interactive
Issue run** and **Console session** through domain modeling.
