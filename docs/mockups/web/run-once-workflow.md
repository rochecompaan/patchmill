# Web page for the run-once workflow: mockup notes

`run-once-workflow.html` is a static mockup of a web page where a team works on
issues with Patchmill's agents. It follows the run-once workflow. Other
workflows may get their own mockups in this folder later.

These notes record the decisions behind the mockup, so they are ready when the
page needs a real server.

## How to use the mockup

Open `run-once-workflow.html` in a browser. It needs no server and no build
step. It loads its fonts from Google Fonts. Without a network connection, the
page uses fallback fonts.

The striped **MOCKUP** bar at the bottom is not part of the design. Use it to:

- open the board;
- switch issue #227 between states: not started, agent working, waiting for a
  reply, in review, paused and blocked;
- open other example runs: implementing, running in a terminal, code review and
  blocked by an error.

The issues come from this repository. Their states, threads and times are made
up. The chat replies, **Pause**, **Resume**, **Retry** and **Stop reply** are
simulated. The page asks for your name the first time and saves it in the
browser.

## How we get from the mockup to a working page

1. **Static mockup.** This file. We change it until the page feels right.
2. **Serve it.** `patchmill serve` serves the same page, still with fake data.
3. **Real board.** The board shows real issues and labels.
4. **Real threads, view only.** The issue page shows real progress from runs.
5. **Live chat.** **Start planning**, chat, **Pause** and **Resume** reach
   run-once through the server. The open client-server questions below come back
   at this step.

## Decisions so far

### Scope

- The page is the first slice of #225 (interactive operator console). It uses
  #225's `RunControl` interface (`snapshot`, `dispatch`, `subscribe`) and
  replaces `pi -p` with Pi's RPC mode, which gives prompt, steer, follow-up and
  abort. #225 stays open for the terminal console, subagent controls and live
  cost.
- The page doesn't show subagents or live cost. Subagent work appears as the
  main agent's tool calls. The cost appears when the run ends.
- The page builds on #295 (concurrent explicit runs). Its ownership rules stop
  the page and a terminal from working on the same issue.

### Planning flow

- **Start planning** starts `patchmill run-once --issue N --interactive`. In
  interactive mode, run-once skips the triage-label check, so any open issue can
  start.
- **Brainstorm first.** The agent starts with read-only tools and a brainstorm
  prompt. A new `skills.brainstorming` setting picks the skill and defaults to
  `superpowers:brainstorming`. The agent can't write files, so it can't write
  the spec before the design is agreed.
- **The chat is the only interface.** There are no approve buttons. When the
  developer approves in the chat, the agent calls a Patchmill tool such as
  `patchmill_advance`. The thread then shows a divider such as "Spec approved.
  Opening the pull request." If the agent misreads the developer, Git and the
  normal workflow let the team undo the step.
- **One conversation for planning.** The spec and plan steps continue the same
  Pi session, so the agent remembers the brainstorm. Implementation runs in a
  fresh session, unattended, but the chat can still steer it.
- **Approval settings don't change.** Interactive runs use the same gates as
  unattended runs. They read the gates from the issue's saved planning state.
  #206 will later set those gates per issue. If an issue needs no spec or no
  plan, the chat steps skip it.
- **No gate (the default).** After each approval, the next step starts in the
  same process. The spec and plan go out with the code in the implementation
  pull request.

### When a planning pull request is open

These rules apply only to issues whose gates require a spec or plan pull
request.

- run-once doesn't exit when it opens the pull request. The agent, the chat and
  the planning worktree stay alive.
- The agent fetches reviewer comments itself, discusses them in the chat, pulls
  the branch, commits, pushes and replies on the pull request.
- Patchmill's existing head checks apply to the agent's pushes as they do to a
  person's. If a push breaks them, the run is blocked and the chat says why.
- run-once checks the pull request every 60 seconds while the agent is idle. The
  run keeps ownership of the issue during the whole review.
- When the pull request merges, the agent announces it in the chat and starts
  the next step straight away. It doesn't wait for the developer.

### Chat and controls

- A message sent while the agent is idle starts a new turn. A message sent while
  it is working steers it before its next step.
- **Stop reply** in the message box stops only the agent's current reply. The
  run continues.
- The header control depends on the issue's state:

  | Issue state                               | Header control                    |
  | ----------------------------------------- | --------------------------------- |
  | No run yet                                | **Start planning**                |
  | Agent working, or waiting for a reply     | **Pause**                         |
  | Paused                                    | **Resume**                        |
  | Blocked by an error                       | **Retry**, after someone fixes it |
  | Running in a terminal                     | None. A note says so.             |
  | Implementation pull request open, or done | None                              |

- **Pause** works like Ctrl-C in a terminal. Patchmill keeps the run state, the
  worktree and the Pi session. **Resume** continues the same session.

### The board

| Column          | Issues                                                   |
| --------------- | -------------------------------------------------------- |
| Triage          | No workflow label, or `needs-info`                       |
| Ready           | `agent-ready`                                            |
| Planning        | Brainstorm, spec or plan in progress                     |
| Planning review | A spec or plan pull request is open                      |
| Implementing    | The implementation step is running                       |
| Code review     | The implementation pull request is open                  |
| Blocked         | `blocked`, or a run that Patchmill stopped with an error |

Cards show the issue number, title and pull request links. A **Live** marker
shows that an agent is working. A **Waiting for reply** marker shows that the
agent asked something.

### The issue page

- **Header:** number and title, current step, elapsed time, pull request links,
  the header control, and the cost once the run ends.
- **Thread, oldest first:** chat messages, one line per tool call (click for
  details), the progress lines the terminal prints, and a divider between steps.
- **Message box** at the bottom, with **Stop reply**.
- **Runs started in a terminal** show the same thread without the message box.

### Themes

- The page has a dark theme and a light theme. It follows the operating system
  setting until someone picks a theme with the switch in the top bar. The
  browser remembers that choice.
- Both themes use the logo colours. The light theme uses darker brass, green and
  red, so text in those colours stays readable.

### Access

- `patchmill serve` accepts only local connections by default. `--host` shares
  it on a trusted network, such as an office network or a VPN.
- The server prints a link with a secret token. Every request must include the
  token. `PATCHMILL_SERVE_TOKEN` keeps the same token across restarts.
- People enter a name, not an account. The browser remembers it, and the agent
  sees it on each message. Several people can chat in one thread. Messages reach
  the agent in the order they arrive.
- The agent posts on GitHub or Forgejo as Patchmill's host account.

### Runs and the server

- Runs must keep going when the server restarts. A restart must not interrupt an
  agent.
- Everything can run on one host for now. Choices made now must still work when
  runs and the server are on different hosts or Kubernetes pods. This matches
  the roadmap's Phase IV: a remote controller, worker leases and Kubernetes
  Jobs.

## Open questions

These were still under discussion when we switched to the mockup.

- **Proposed, not yet agreed:** run-once connects to the server, not the other
  way round. The server learns about runs only through that connection, and
  doesn't read a run's files in `.patchmill/`. Messages use one format whatever
  the transport. Each event has a number, so a run can resend what the server
  missed after a reconnect. For now, runs connect through a Unix socket that
  only the user's account can open. Browsers use a TCP port.
- Where the thread history lives if the server can't read a run's files.
- How the server starts a run: a detached local process now, and maybe a
  Kubernetes Job later.
- What the connection design changes for terminal runs, server restarts and
  issue ownership.

## Things the plan must check

- Pi's `--fork` option works with `--mode rpc`.
- A resumed Pi session can use a different tool list. If it can't, a small
  Patchmill extension can block writing tools during the brainstorm.
- The page's static files are included in the npm package and the Nix build.
