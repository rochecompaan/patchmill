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
2. **Serve it (#301).** `patchmill serve` serves the page with sample data from
   a JSON API.
3. **Real board (#302).** The board shows real issues, labels and run state.
4. **Finished threads (#303).** The issue page shows the thread of a run that
   has finished or stopped.
5. **Live progress (#304).** The issue page updates while a run is active.
6. **Live chat.** **Start planning**, chat, **Pause** and **Resume** reach
   run-once through the server. This step needs #225, Pi's RPC mode in run-once
   (#305), and a design for how runs and the server connect. The open questions
   below come back at this step.

Steps 2–5 are view only. They show the whole page, but nothing on it changes a
run. Umbrella issue #300 tracks them, with one sub-issue per step. The
umbrella's decisions are the ones in this file. If a decision changes, update
both.

## Decisions so far

### Scope

- The web page has its own umbrella issue, #300. It isn't a slice of #225
  (interactive operator console), because steps 2–5 don't need #225.
- Live chat does need #225. It uses #225's `RunControl` interface (`snapshot`,
  `dispatch`, `subscribe`) and replaces `pi -p` with Pi's RPC mode, which gives
  prompt, steer, follow-up and abort. The switch to RPC mode is #305, a
  sub-issue of #225, because the terminal console needs it too. #225 stays open
  for the terminal console, subagent controls and live cost.
- The page doesn't show subagents or live cost. Subagent work appears as the
  main agent's tool calls. The cost appears when the run ends.
- The page builds on #295 (concurrent explicit runs). Its ownership rules stop
  the page and a terminal from working on the same issue.

### The view-only steps

- **Run data.** The server gets run data through one read-only interface with
  two operations: the current state (`snapshot`) and a change feed
  (`subscribe`). This is the read half of #225's `RunControl`. For now, the
  interface reads the files that runs write under `.patchmill/runs/`. The API
  and the page never read those files directly. Until live chat, the server must
  run on the same host as the runs. This lets steps 3–5 start before the
  connection design is settled. When live chat needs the connection, only the
  inside of the interface changes.
- **Browser code.** Plain HTML, CSS and JavaScript in `web/`, with no build step
  and no framework. `tsc` checks the JavaScript through JSDoc type comments. The
  page imports the API response types from the server's TypeScript. The npm
  package and the Nix build stay without a build step. If live chat makes the
  page much bigger, we can move to a bundler then.
- **Server code.** TypeScript in `src/`, using Node's `node:http`. No new npm
  dependencies.
- **Requests.** The page uses `fetch` for API calls and `EventSource` for live
  updates.
- **Fonts.** The page ships its fonts in `web/` and makes no requests to other
  hosts. It then works offline, and it sends nothing to other hosts while it
  holds a secret token.
- **The whole page from the start.** Every step shows the message box, the
  header controls and the name prompt, as the mockup does. The team sees the
  whole intended page while it is still view only. Until live chat, the message
  box and the controls change nothing. Using one shows a short note that it
  comes with live chat. The name prompt works as in the mockup and saves the
  name in the browser.

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

| Column          | Issues                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| Triage          | No workflow role, or `needs-info`                                                       |
| Ready           | `agent-ready`                                                                           |
| Planning        | `in-progress`, `spec-approved` or `plan-approved`, or run state `claimed` or `planning` |
| Planning review | `spec-review` or `plan-review`, or an open planning pull request                        |
| Implementing    | Run state `implementing`                                                                |
| Code review     | `agent-done`, or run state shows an implementation pull request                         |
| Blocked         | `blocked`, or run state `blocked`                                                       |

- Labels are matched through workflow roles, so repositories with custom label
  names work.
- If more than one column fits, **Blocked** wins. Otherwise, the furthest step
  wins.
- Issues labelled `agent-unsuitable` don't appear on the board.
- Cards show the issue number and title, and links to the spec, the plan and the
  pull requests.
- A **Live** marker shows that a run is active. The server reads this from
  run-once's admission records, small files that name the process running each
  issue. A record whose process has ended doesn't count.
- A **Waiting for reply** marker shows that the agent asked something. It comes
  with live chat. Today's runs never wait for a reply. If the agent has
  questions, the run stops and goes to **Blocked** with them.
- The page refreshes the board every 15 seconds and shows when it last synced.
  The server fetches the issue list from the host at most once a minute, however
  many browsers are open.

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

- `patchmill serve` listens on `127.0.0.1`, port `4280`, by default. `--host`
  shares it on a trusted network, such as an office network or a VPN. `--port`
  changes the port.
- The server prints a link with a secret token. Opening the link stores the
  token in an `HttpOnly`, `SameSite=Strict` cookie and removes it from the
  address bar. The browser then sends the cookie with every request, including
  `EventSource` requests, which can't set headers. `PATCHMILL_SERVE_TOKEN` keeps
  the same token across restarts.
- The server checks the `Host` header on every request, and the `Origin` header
  on every request that changes state. These checks stop other websites open in
  the same browser from using the server.
- The page inserts issue and run text as text, never as HTML. Pi session logs
  can hold sensitive data, so only people with the token can see them.
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
- Steps 2–5 read run files, so the server must run on the same host as the runs.
  The connection design below removes that limit.

## Open questions for live chat

We postponed these until live chat. Steps 2–5 don't need the answers, because
the run-data interface hides where the data comes from.

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

## Things to test before live chat

Issue #305 (Pi RPC mode in run-once) tests these first and records the answers
here.

- Pi's `--fork` option works with `--mode rpc`. If it doesn't, the RPC `fork`
  command may meet the same need.
- A resumed Pi session can use a different tool list. If it can't, a small
  Patchmill extension can block writing tools during the brainstorm.

One difference is already known. In RPC mode, Pi tells extensions that a user
interface exists (`ctx.hasUI` is `true`), and extension dialogs wait for the
client to answer. In print mode (`pi -p`), dialogs return at once with no
answer. So run-once must answer every dialog itself, or a run could hang.
