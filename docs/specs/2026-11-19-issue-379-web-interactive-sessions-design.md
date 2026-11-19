# Interactive Issue sessions in the web page

Issue #379, part of #300. Replaces the "Later work" list in #300 (Start
planning, chat, Pause and Resume) with one design.

## Intent

The web page is read-only today. A team can watch an Issue run, but to start
one, chat with the planning agent, approve a gate or unblock a worker, someone
has to open a terminal and run `patchmill run-once --interactive`.

This design makes the web issue page a full replacement for the interactive
console: the same Issue run, the same planning chat, the same gates and
guidance, driven from the browser. Several people can share one session. Each
sees the same thread, and any of them can type or answer.

Success: a maintainer opens the board, opens an issue, presses **Start
planning**, brainstorms with the agent, approves the spec and plan, watches the
implementation worker, answers it when it is blocked, and sees the run finish,
all without a terminal. A colleague who opens the same issue page halfway
through sees the whole thread and can join in.

## Goals

- Start an interactive Issue run for one issue from its web page.
- Stream the planning chat live: agent text as it is written, tool calls, and
  Patchmill notices.
- Send chat messages to the agent, including while it is replying.
- Answer the questions the console asks today: the planning approval choice
  (`ctx.ui.select` in `src/console/tools.ts`) and the guidance confirmation
  (`ctx.ui.confirm`). Show `ctx.ui.notify` notices in the thread.
- Stop the current reply (**Stop reply**).
- End the session (**Pause**) and start it again later (**Resume**), picking up
  the same Issue run and the same Pi conversation.
- Several browsers on one session. They all see the same thread and state. Any
  of them can send input. Each input is labelled with its author's name.

## Non-goals

- A live transcript of the implementation worker. The console doesn't show one
  either. The page shows the worker's state and Patchmill's progress lines, as
  the console does. The worker's transcript appears when it finishes, through
  the existing run-file feed.
- Presence ("Bob is viewing"), typing indicators, read markers or notifications.
- Per-person permissions or real identity. Anyone with the server token can do
  everything, under the name they enter. This is enough trust for the first
  version.
- Sessions on a different host from the server.
- Keeping a session running across a server restart. A restart ends live
  sessions. **Resume** starts them again.
- Changes to non-interactive `run-once` or to the terminal console's behaviour.
- `/patchmill-issue` switching inside a web session. A web session belongs to
  one issue. To work on another issue, open its page.

## Anti-goals

These would make the feature a failure even if it technically worked:

- State that lives in one browser tab. Closing or reloading a tab must never
  lose input, a pending question, or the session.
- A question that only one browser can answer, or that two people can both
  answer with different results.
- A second Patchmill run of the same issue at the same time, from the web, a
  terminal console or `run-once`.
- A web Issue run that behaves differently from a console Issue run: other
  prompts, other gates, other result rules or other run files.
- Pi processes left running after a session ends, the server stops, or the agent
  crashes.
- Issue or agent text inserted into the page as HTML.

## Constraints

- Server code stays TypeScript on `node:http`. The page stays plain HTML, CSS
  and JavaScript with JSDoc types, `fetch` and `EventSource`. No new npm
  dependencies. These are the #300 decisions.
- The existing access rules hold: the token cookie, the `Host` check, and the
  `Origin` check on every request that changes state.
- Pi Durable is out (see `docs/mockups/web/run-once-workflow.md`). Sessions use
  the Pi coding agent in RPC mode, as #305 set up.
- The kernel's `HumanChannel` (`src/kernel/human-channel.ts`) is the only
  boundary between `runOneIssue` and the people driving it. The web version must
  not need kernel changes beyond what the console already uses.

## Approaches considered

**A. Host the session inside the server process.** Build the same Pi runtime as
`startConsole`, without `InteractiveMode`, and bridge its events to browsers.
This reuses the most code, but every issue's agent and extensions share one
process with the web server. A crash or a stuck extension takes all sessions
down, and dialogs need their own bridge.

**B. One `pi --mode rpc` process per issue session, with the Patchmill console
extension loaded. (Chosen.)** The server talks to each process over the RPC
protocol from #305. Browser messages become `prompt`, `steer` and `abort`. The
RPC event stream becomes the live thread. Extension dialogs arrive as
`extension_ui_request` records, which become shared web questions. Each issue is
isolated in its own process, and the server stays a thin hub. This matches the
recorded decision that live chat uses Pi RPC mode.

**C. The page attaches to a console started in a terminal.** Dropped. The server
should own the session, and collaboration shouldn't depend on someone's open
terminal.

The maintainer chose B.

## Design

### Shape

```text
browser ─┐                         ┌─ pi --mode rpc  (issue 12)
browser ─┼─ patchmill serve ── hub ┤     └─ Patchmill console extension
browser ─┘   (HTTP + SSE)          │          └─ runOneIssue + HumanChannel
                                   └─ pi --mode rpc  (issue 31)
```

`patchmill serve` gains a **session hub**: a map from issue number to at most
one live **web session**. A web session owns one Pi RPC process, an input queue,
the open question (if any), and an event log that it sends to every subscribed
browser.

### The Pi process

The process runs the console without the terminal. It is started with
`pi --mode rpc` and:

- the same agent dir, skills and extensions as `startConsole`
  (`provisionAgentDir`, `consoleSkillPaths`, pi-subagents);
- the issue's console session file, chosen by `openIssueConsoleSession`, so a
  web session and a terminal console share one conversation history per issue;
- a new Patchmill extension entry point that builds `RunOnceDeps` and
  `createPatchmillExtension` for one issue, with the same `startRun` the console
  uses. It reads the repository root and issue number from the command line or
  environment, never from browser input.

Inside the process, nothing changes: `ConsoleController` is the `HumanChannel`,
planning runs in the Pi session, and implementation runs as a pi-subagents
worker. The console's status bar becomes `setStatus` records, which the hub
reads for the header.

The session ends when the Issue run ends and the agent is idle, when someone
presses **Pause**, or when the server stops.

### The RPC client

The run-once wrapper in `src/kernel/pi-rpc.ts` doesn't fit as it is, and its
behaviour must not change. It sends one prompt from a file, cancels every
dialog, and treats `abort()` as the end of the process. The hub needs an
**interactive RPC client** (a design call, not the maintainer's) that shares the
wrapper's JSONL framing and process-group handling, but:

- sends `prompt` for each chat message, with `streamingBehavior: "steer"` when
  the agent is replying (Pi's RPC docs: `prompt` without it fails while
  streaming);
- sends RPC `abort` for **Stop reply**. In Pi's RPC protocol, this ends the
  current operation and leaves the session idle, not the process;
- passes `select` and `confirm` requests to the hub and sends back the answer;
- passes every other record (streaming `message_update`, tool execution events,
  `message_end`, `agent_start`, `agent_settled`, `notify` and `setStatus` UI
  requests) to the hub as events;
- ends the process (abort, then terminate the group) on **Pause**, server stop,
  or a crash, and leaves no stray processes.

For a browser that connects to a live session, the hub builds the thread from
what it has already received, plus Pi's `get_messages` or the session file for
what came before the process started. The builder picks one.

### One run per issue

The Issue run inside the Pi process takes the issue lock (`src/kernel/lock.ts`),
as every run does. The hub also refuses to start a second web session for an
issue that has one. If the issue lock is held by another process, such as a
terminal console or `run-once`, **Start planning** and **Resume** are refused
with a short message, and nothing starts. The page already shows **Live** for
such runs.

The issue lock is held only while the Pi process lives. A paused issue has no
process and no lock, so it can be continued from the web or from a terminal
console, as it can today between two terminal consoles. Both use the same
console session file, never at the same time.

### Input

Every input from a browser carries the author's name (from the name prompt) and
a request ID that the browser makes. The hub ignores a request ID it has already
accepted, so a retry after a reconnect counts once.

The hub keeps one queue per session and sends inputs to Pi one at a time:

- **A chat message** becomes `prompt` when the agent is idle and `steer` when it
  is replying, as pressing Enter does in the console. The agent receives it as
  `Name: text`, so it can tell people apart. The thread shows the name.
- **Stop reply** becomes `abort` for the current turn. It doesn't end the
  session or the run.
- **An answer to a question** becomes the `extension_ui_response` for that
  question.

### Shared questions

When the extension calls `select` or `confirm`, the hub records one open
question with its ID, title and options, and every browser shows it in the
thread. The first answer settles it. The hub then shows everyone who answered
and what they chose, and rejects later answers with a short "already answered by
…" message. A browser that connects while a question is open sees it.

`input` and `editor` dialogs aren't used by the console today. If one arrives,
the hub cancels it, as #305 does in non-interactive runs, and notes this in the
thread.

### Events to the browser

The existing `GET /api/issues/:number/events` stream carries the live session
too, so the page keeps one `EventSource` per issue. New update kinds cover:

- the session's state (none, starting, idle, replying, waiting for an answer,
  ending);
- agent text as it streams, tool calls and their results;
- chat messages with their authors;
- Patchmill notices (`notify`, `sendMessage` with `customType: "patchmill"`);
- the open question, and its resolution.

When a browser connects, it gets the current thread first and then only changes.
With `Last-Event-ID`, it gets only what it missed. The live session thread and
the run-file thread from #303 and #304 must not show the same entry twice.

The page subscribes whenever the issue page is open, not only while a run is
active. Then a session that someone else starts shows up without a reload.

### Routes

New routes that change state. All require the cookie and a matching `Origin`:

- start a session for an issue (**Start planning**, **Resume**, **Retry**);
- send a chat message;
- answer the open question;
- stop the current reply;
- end the session (**Pause**).

Each returns quickly. Its effect shows up on the event stream.

### Page

The header controls and the message box from the mockup start working. The
issue-state table in `docs/mockups/web/run-once-workflow.md` decides which
control shows. The view-only notes ("This comes with live chat") go away when
the server has live sessions. `patchmill serve --sample` keeps the view-only
page.

The composer is enabled while a session is live. While the agent replies, the
composer stays usable (its messages steer) and **Stop reply** shows. While a
question is open, its options appear in the thread for everyone.

### Ending and restarts

- **Pause** ends the session the same way quitting the console does. The
  controller aborts planning, stops the worker and closes the run. The run state
  and console session file stay.
- **Resume** behaves like starting the console again on the same issue. The
  in-memory waits in `ConsoleController` (a pending gate or guidance answer) are
  gone. The new process starts the Issue run, and `runOneIssue` continues from
  the saved run state, so it reaches the same gate or question again. The Pi
  conversation continues from the session file.
- When the server stops, it ends every session the same way, then exits.
- If the Pi process crashes, the hub shows the error in the thread, frees the
  admission, and offers **Resume**.

## Decided by the maintainer

- The web page is the web version of the interactive console. It doesn't add new
  run behaviour.
- The server owns and runs the session. Browsers only view it and send input.
- Several people can share a session. The core is built for that from the start:
  state on the server, an author and request ID on every input, one input queue,
  and first-answer-wins questions. Presence and similar features come later.
- Anyone with the token is trusted. The name they enter is their identity.
- Approach B: one Pi RPC process per issue session.

## Left to the builder

- The extension entry point's name, its flags, and how it reuses
  `startConsole`'s setup.
- The exact update kinds and payloads, and how they extend `IssueUpdate` in
  `src/web/api-types.ts`.
- Route paths and request bodies.
- How live session entries and run-file entries share IDs, so they appear once.
- How long the hub keeps an ended session's event log for reconnecting browsers.
- Whether the interactive RPC client is a new module or a second mode of
  `src/kernel/pi-rpc.ts`, as long as run-once behaviour stays the same.
- How to split the work into slices under #300.
