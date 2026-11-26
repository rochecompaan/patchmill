<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="Patchmill logo" src="docs/assets/logo-light.svg" width="400">
  </picture>
</p>

Patchmill turns issues in your issue tracker into pull requests. It uses an AI
coding agent ([Pi](https://github.com/earendil-works/pi)) to read an issue,
write a design and a plan, write the code, and open a pull request. You review
and merge the pull request.

You can change how the agent does its work. Skills (Markdown instruction files
for the agent) define how it triages, plans, codes, reviews, and collects
evidence. Patchmill installs a default set of skills in your repository. You can
edit them, or point Patchmill at your own skills. The Patchmill program itself
only starts the agent, tracks the issue, and checks the result.

Patchmill runs on your computer, in a clone of your repository. It works with
GitHub through the `gh` CLI, and with Forgejo or Gitea through the `tea` CLI.

Read the full documentation at **[patchmill.dev](https://patchmill.dev)**.

## How Patchmill works

You decide which issues the agent can work on. Patchmill then moves each issue
through these steps:

1. Triage: the agent reads each open issue and decides if it suits automated
   work. Patchmill labels the issue `agent-ready`, `needs-info`, or
   `agent-unsuitable`, and adds a comment. You can also add `agent-ready`
   yourself.
2. Claim: `patchmill run-once` selects one ready issue whose dependencies are
   closed. It labels the issue `in-progress`.
3. Plan: the agent writes a spec (a design document) and an implementation plan.
4. Implement: the agent writes the code and tests in a git worktree (a separate
   checkout of your repository). Then it opens a pull request that closes the
   issue.
5. Hand off: Patchmill makes sure that the pull request exists, and labels the
   issue `agent-done`. You review and merge the pull request.

If the agent needs more information, it asks questions on the issue and labels
it `needs-info`.

By default, one pull request holds the spec, the plan, and the code. To approve
the spec or the plan before the agent writes code, turn on a planning gate. Each
gate opens a separate planning pull request. The run continues after you merge
that pull request.

Patchmill has two parts. A small kernel (the core program) starts Pi, claims
issues, decides the next step from git and the issue host, and checks the
result. Skills decide what the agent does in each step. To change the workflow,
change the skills, as [Skills](#skills) describes. The
[overview](https://patchmill.dev/getting-started/overview/) explains this split.

## Requirements

- A git repository with an `origin` remote on GitHub, Forgejo, or Gitea.
- Git 2.38 or later (included in the Nix package). `patchmill doctor` checks the
  version.
- The `gh` or `tea` CLI, logged in to that host.
- Node.js 24 or later (included in the Nix package).
- An account with a model provider that Pi supports, by subscription or API key.

## Installation

Choose one installation method before following the quickstart.

### Nix / NixOS

Use the Nix package instead of a global npm installation. With Nix flakes
enabled, install from GitHub:

```sh
nix profile install github:rochecompaan/patchmill
```

The Nix package includes Node.js and Git, but you must provide the authenticated
`gh` or `tea` CLI separately. Its Git comes first on `PATH`. If your Git
configuration names a system credential helper by a short name, for example
`libsecret`, give its full path instead.

### npm

With Node.js 24 or later installed:

```sh
npm install -g patchmill
```

## Quickstart

After installation, run these commands in the repository you want Patchmill to
manage. For Forgejo or Gitea, use `--provider forgejo-tea`.

```sh
patchmill init --provider github-gh   # write configuration, install skills
patchmill auth                        # choose a model provider and a model
patchmill labels setup                # create the workflow labels
patchmill doctor                      # make sure that everything is ready
patchmill triage --dry-run            # preview the triage results
patchmill triage                      # label the open issues
patchmill run-once                    # take one ready issue to a pull request
```

`auth` asks for an authentication method, a provider, and a default model. It
saves them in the Pi agent directory of the repository. Then it sends a real
prompt to the provider and returns to your shell. `doctor` and
`triage --dry-run` also call the model, so they use tokens.

The [quickstart guide](https://patchmill.dev/getting-started/quickstart/) gives
more detail for each step.

## Run issues

`patchmill run-once` advances one issue, then exits. Run it again to take the
next issue.

```sh
patchmill run-once                  # select the next eligible issue
patchmill run-once --issue 42       # work on issue 42
patchmill run-once --dry-run        # show the issue and its next step only
patchmill run-once --plan-only      # stop after planning
```

A dry run does not claim the issue and does not start Pi. If a planning gate
waits for a merge, the issue stays `in-progress` and no Pi session runs. Merge
the planning pull request, then run `patchmill run-once --issue N` again. Review
approval alone does not unlock a gate. While the gate waits, later runs do not
post the same waiting comment again. They post a new comment only when the gate
changes.

Ctrl-C or `SIGTERM` pauses the run. Patchmill publishes nothing, the issue stays
`in-progress`, and the next `run-once` resumes it.

With both gates on, merge the spec pull request, then the plan pull request.
Each later branch starts from the base branch with the merged documents.

The [Run-once guide](https://patchmill.dev/using-patchmill/run-once/) explains
gates, resume, and failures.

### Run unattended

`patchmill run` triages and runs issues one at a time until you stop it. Each
pass is one `run-once` without `--issue`. Triage runs every
`run.triageIntervalMinutes`. When no issue is eligible, or a planning gate waits
for a merge, the runner waits. The wait grows to `run.idleBackoff` limits. After
an error, it waits with the `run.errorBackoff` limits. Three Needs Info stops in
a row also count as an error, so that a broken provider does not move each ready
issue to `needs-info` without a pause.

Before new work, a pass looks for a Done issue whose open pull request now
conflicts with the base branch. It resolves that conflict first: an agent merges
the base into the issue branch, and Patchmill checks the pushed result. A failed
resolution stops with Needs Info. The same pull request is not tried again until
its head or the base changes, and at most once each `run.conflictRetryMinutes`.

```sh
patchmill run
```

Run it under a process supervisor. This is an example `systemd` unit:

```ini
[Unit]
Description=Patchmill runner for my-repo

[Service]
WorkingDirectory=/srv/my-repo
ExecStart=/usr/bin/env patchmill run
Restart=on-failure
RestartPreventExitStatus=2
KillSignal=SIGTERM
KillMode=control-group
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

The first `SIGINT` or `SIGTERM` stops the loop. The active run pauses and keeps
its state for the next start. A second signal forces an exit. A forced exit can
leave a Pi process running, so keep `KillMode=control-group` to stop the whole
process group.

| Exit code | Meaning                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| 0         | A clean stop after a signal.                                                          |
| 1         | Invalid arguments, configuration, mode, or host CLI, a fatal error, or a forced exit. |
| 2         | Another `patchmill run` owns this clone and its worktrees.                            |

One runner owns a clone and all its worktrees. The lock does not cover a second
clone. In local state mode, run one runner per repository. In label mode, two
clones can still race for the same claim in a short window. The
[Run unattended guide](https://patchmill.dev/using-patchmill/run/) gives more
detail.

### Interactive issue runs

```sh
patchmill run-once --issue 225 --interactive
```

This command opens a Pi console. You plan the issue with the agent in the
console, and a background worker does the implementation. The workflow is the
same as for `run-once`. `--issue N` is optional. Without it, Patchmill selects
the next eligible issue. If no issue is eligible, the command exits without an
error. You cannot combine `--interactive` with `--dry-run` or `--plan-only`.

The console agent uses four tools:

- `patchmill_submit_planning_result`: submit a planning result after your
  review, in one dialog. If you request changes or press Escape, planning stays
  open.
- `patchmill_continue_issue_run`: check the merge and continue the run. You
  merge the pull request yourself, then tell the agent to continue. Patchmill
  does not check for the merge by itself.
- `patchmill_run_status`: show the current or ended run, the worker, the wait,
  and the estimated cost.
- `patchmill_confirm_block_guidance`: send guidance to a blocked worker after
  you confirm it.

While the run waits for your review, you can ask the console agent for pull
request changes. The agent makes them on the issue branch and pushes them. The
status bar keeps the issue and its state until you quit or switch issues. When
the run ends, the console says the outcome, the cleanup result, and the next
step.

The planning dialog names the issue and the document. It shows the files, the
branch, and a short commit hash. It lists two to five key decisions, not the
full summary of the agent.

For a required gate, the dialog offers three choices:

- Approve and open a planning PR: the run waits for you to merge that pull
  request.
- Approve without a PR (continue now): Patchmill pushes the approved planning
  commit to the implementation branch and continues at once. Later documents
  stay on that branch.
- Request changes: planning stays open.

A later required gate offers only "Approve (continue now)" and "Request
changes". The dialog explains which earlier document prevents a planning pull
request. Without gates, the dialog asks if you reviewed the spec, the plan, or
both. It offers "Reviewed, continue" and "Request changes". After "Reviewed,
continue", Patchmill pushes the spec and plan and starts the implementation.

If you request changes or press Escape, Patchmill pushes nothing. After a
restart, Patchmill reads approvals from the pushed documents, not from saved
state. If you quit or pause before you answer the dialog, the documents stay
local, and the next run goes back to planning to ask you again.

To start another issue after the current run ends, type `/patchmill-issue <N>`.
Each issue has its own conversation under `<runsDir>/issue-<N>/console/`. When
you open an issue again, the console resumes its newest session.

After the implementation pull request merges, an interactive run removes the
worktrees and local branches of the issue. It keeps each worktree that has
uncommitted changes and shows the reason in the chat. Non-interactive runs leave
worktrees in place.

When you quit the console (for example with Ctrl-C) while the agent plans or a
worker runs, the worker stops and the run is paused. A pause does not change the
issue's labels and posts no comment. Start the console on the issue again to
continue the run. At startup, Patchmill stops stray workers before it starts a
run. If it cannot stop them, it does not start the run. Do not start this
command inside a pi-subagents child process. `PI_SUBAGENT_CHILD=1` disables
pi-subagents.

## Web board

Run `patchmill serve` from the repository directory that contains your run
files. The board shows real open issues, workflow columns, document links, and
pull requests. It uses the repository config and its host CLI account. The
server and runs must use the same directory on the same host.

The server caches host issues and pull requests for one minute across all
browsers. The page refreshes every 15 seconds and shows the host sync age. Local
run observations and held issue locks supply current progress and Live markers.

The issue page lists the Issue documents: the spec, the plan, and the mockups
and diagrams that they link. The server reads them from committed Git objects on
the local Issue branch, the pushed branch, or the base branch. A spec or plan on
a local branch that is not pushed yet also shows. Mockup scripts run in an
isolated frame. They cannot read the page, read the token cookie, or call the
API.

### Web sessions

The issue page is also the web version of the interactive console. From the
page, you can start an interactive Issue run, chat with the planning agent,
approve gates, answer a blocked worker, and pause and resume the run. You do not
need a terminal. Several people can share one Web session.

- Each Web session is one Pi RPC process that the server starts. The Issue run
  in it behaves as in `patchmill run-once --interactive`.
- An issue has at most one live Web session. If a terminal console, another Web
  session or `run-once` holds the issue, the server refuses the start.
- Anyone with the token can act on the page under the name that they enter. The
  name is a label, not a permission.
- A question from the run shows as a card in every browser. The first answer
  wins. The card closes in the other browsers.
- **Stop reply** stops the agent's current reply. The session stays open.
- **Pause** ends the Web session, as quitting the console does. Patchmill keeps
  the run state and the Console session. **Resume** continues the same Issue run
  and conversation.
- A server stop or restart ends every Web session and stops its worker. Press
  **Resume** to continue.
- A Web session and a terminal console use the same Console session file. They
  never run at the same time. The Console session lock refuses the second one.
- If Pi stops unexpectedly, a worker that is still running stops when the next
  session starts.
- While a Web session is live, the page shows its messages as they arrive. After
  it ends, the page shows the run files, as after a terminal console run.
- Every live issue page shows who has it open and who types in the composer, by
  the entered name. The same name in two tabs counts once. The server keeps this
  in memory only. It is lost on restart.

Use `patchmill serve --sample` for deterministic design fixtures and sample
issue pages. Sample mode needs no repository, config, or provider account. All
fonts and page assets ship locally in both modes.

The default address is `127.0.0.1:4280`. Open the printed secret-token link. The
server stores an HttpOnly cookie and removes the token from the address. Set
`PATCHMILL_SERVE_TOKEN` to keep a token across restarts. Otherwise, each start
creates a new random token. Keep the printed link private.

Use `--host HOST` and `--port PORT` to change the listener. A non-loopback
listener is for a trusted network or VPN only. HTTP does not encrypt its content
or token. With `--sample`, the server only reads data. It never starts or
changes a run.

### Browser regression checks

From a development checkout, use an installed Chrome or Chromium browser:

```sh
CHROMIUM=/path/to/chromium npm run test:web
```

CI runs this command and fails if no browser is available. It checks mobile
layout, message controls, keyboard access, delayed gallery images, and the Web
session controls on the issue page. It also checks presence and typing in two
browsers. The command does not change reference screenshots by default.

To refresh its reference screenshots, set `LAYOUT_SCREENSHOTS=1`. To save its
measurements, set `LAYOUT_EVIDENCE` to a local JSON path.

## Commands

| Command                                                                    | What it does                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patchmill init`                                                           | Write configuration if it is missing, install skills, and set up the Pi agent directory. Safe to run again.                                                                                                   |
| `patchmill auth`                                                           | Choose a subscription or API key, a provider, and a default model. Save them, test the provider, and return to the shell.                                                                                     |
| `patchmill doctor [--fix]`                                                 | Readiness checks: host CLI logged in, labels exist, worktree directory ignored, skills present, the managed `reviewer` resolves with `bash`, Pi answers a test prompt. `--fix` restores the managed reviewer. |
| `patchmill labels setup`                                                   | Create missing labels.                                                                                                                                                                                        |
| `patchmill triage [--dry-run]`                                             | Run the triage skill for each candidate issue. A dry run prints the labels and comment instead of applying them.                                                                                              |
| `patchmill run-once [--issue N] [--dry-run] [--plan-only] [--interactive]` | Advance one issue. A dry run prints the selected issue and its next step without a claim and without Pi.                                                                                                      |
| `patchmill run`                                                            | Triage and run issues one at a time until stopped. See [Run unattended](#run-unattended).                                                                                                                     |
| `patchmill release --issue N`                                              | Clear a stale claim after a hard crash.                                                                                                                                                                       |
| `patchmill status [--all] [--issue N]`                                     | Show workflow status in local state mode. Read blockers of ready and in-progress issues live from the tracker.                                                                                                |
| `patchmill skills update`                                                  | Update the managed skill pack to the installed Patchmill version. Refuses edited managed files and removes files that the pack dropped.                                                                       |
| `patchmill serve [--sample] [--host HOST] [--port PORT]`                   | Serve the repository board and its Web sessions, or view-only fixtures with `--sample`.                                                                                                                       |
| `patchmill version`                                                        | Print the version.                                                                                                                                                                                            |
| `patchmill setup-test-repo`                                                | Development tool for the end-to-end CI. It is not part of the kernel.                                                                                                                                         |

## Labels and dependencies

| Label              | Meaning                                               | Set by                    | Removed by              |
| ------------------ | ----------------------------------------------------- | ------------------------- | ----------------------- |
| `agent-ready`      | Suitable for automation. Dependencies must be closed. | Human or triage           | Kernel on claim         |
| `in-progress`      | Work is active, or waits for a planning PR merge.     | Kernel on claim           | Kernel on final release |
| `needs-info`       | The agent asked questions, or the run attempt failed. | Kernel                    | Kernel on next claim    |
| `agent-done`       | A ready pull request that closes the issue exists.    | Kernel after verification | Human                   |
| `agent-unsuitable` | The issue is not suitable for unattended agent work.  | Triage                    | Human                   |

`agent-done` means that the pull request exists. It does not mean that the pull
request merged.

Native issue links control when work can start: **Blocked by** on GitHub and
**Depends on** on Forgejo and Gitea. Triage adds missing links. Patchmill skips
an issue while a dependency is open or unreadable. When the last dependency
closes, the issue becomes eligible on the next selection. The agents own git and
the pull request. Only the kernel changes labels and posts run comments.

If you used `blocked` labels in an earlier version, update those issues by hand.
The [triage guide](https://patchmill.dev/using-patchmill/triage/#manual-upgrade)
gives the steps. See
[Workflow labels](https://patchmill.dev/reference/workflow-labels/) for more
detail.

## Configuration

Patchmill reads `patchmill.config.json` in the repository root. `patchmill init`
creates it if it is missing. The example shows every key with its default value.
Each key is optional. Patchmill rejects unknown keys by name.

```json
{
  "host": { "provider": "github-gh", "login": "", "trustedAuthors": [] },
  "labels": {
    "ready": "agent-ready",
    "inProgress": "in-progress",
    "needsInfo": "needs-info",
    "done": "agent-done",
    "unsuitable": "agent-unsuitable"
  },
  "paths": {
    "specsDir": "docs/specs",
    "plansDir": "docs/plans",
    "worktreeDir": ".worktrees",
    "runsDir": ".patchmill/runs"
  },
  "git": { "baseBranch": null },
  "skills": {
    "triage": ".patchmill/skills/patchmill-issue-triage",
    "planning": ".patchmill/skills/patchmill-planning",
    "implementation": ".patchmill/skills/patchmill-implementation"
  },
  "pi": {
    "agentDir": ".patchmill/pi-agent",
    "timeoutMinutes": null,
    "commandTimeoutMinutes": 20,
    "maxCommandTimeoutMinutes": 25,
    "stallStopMinutes": 10,
    "maxStalls": 3
  },
  "workflow": {
    "stateTracking": "labels",
    "specApproval": { "required": false },
    "planApproval": { "required": false }
  },
  "run": {
    "triageIntervalMinutes": 5,
    "conflictRetryMinutes": 30,
    "idleBackoff": { "initialSeconds": 60, "maxSeconds": 900 },
    "errorBackoff": { "initialSeconds": 30, "maxSeconds": 1800 }
  }
}
```

These keys change the most:

- `workflow.specApproval.required` and `workflow.planApproval.required` turn on
  the planning gates.
- `workflow.stateTracking` selects labels on the host or
  [local state](#local-state-mode).
- `pi.timeoutMinutes` is the optional Session cap in minutes. The default `null`
  sets no wall-clock limit on phase sessions. A number must be greater than 0
  and at most 35791. About 5 minutes before the cap, Patchmill asks the agent to
  stop new work and hand off. Without a cap, triage sessions stop after 90
  minutes. Subagents follow the same cap (see [Safety](#safety)). A
  configuration from an earlier `patchmill init` has `90`, which keeps a
  90-minute cap; set `null` to turn it off.
- `pi.commandTimeoutMinutes` (default 20) is the timeout of an agent `bash` call
  that sets none. `pi.maxCommandTimeoutMinutes` (default 25) is the longest
  timeout that a call can get. `0` turns a limit off. The default must not be
  longer than an enabled cap.
- `pi.stallStopMinutes` (default 10) is the quiet time after which Patchmill
  stops the turn of an unattended planning or implementation session and asks
  the agent to continue another way. A running `bash` call inside its timeout is
  not quiet. `pi.maxStalls` (default 3) is the number of Stalls that stops the
  Run attempt at Needs Info. A second Stall of the same command also stops it.
  `0` turns a limit off.
- `git.baseBranch: null` uses the default branch of the remote.
- `run` sets the triage interval and the wait limits of `patchmill run`.

The label names must be different from each other. The comparison ignores case.
`init` does not change a valid configuration, and rejects an invalid one. The
[configuration guide](https://patchmill.dev/getting-started/configuration/)
explains each key, including host logins and trusted comment authors.

## Local state mode

Set `workflow.stateTracking` to `"local"` to keep the workflow state on this
computer. The default is `"labels"`.

In local mode, Patchmill keeps issue copies and status history in
`.patchmill/state/`. It does not use labels or status comments. It still posts
questions, opens pull requests, adds cost reports to pull request bodies, and
adds dependency links. Questions are the only issue comments that it posts.

`patchmill status` reads the local state without a sync, and shows the time of
the last sync. It reads the blockers of ready and in-progress issues live from
the tracker. A blocker in the same repository shows its local status, for
example `(Ready)` or `(In Progress)`. A done blocker shows
`(Done, PR not merged)`. An open pull request marks work done, but the issue
blocks other issues until it closes after the merge. Other blockers show no
status note. Add `--all` to include closed issues. Add `--issue N` to see the
full status history of one issue and, if it is open, its live blockers.

`patchmill labels setup` refuses to run in local mode. `patchmill doctor` checks
the state folder instead of the labels.

Local state mode is for one user on one computer. When you change modes,
Patchmill does not move the state.

## Safety

- Each phase runs in a new Pi session. By default, no wall-clock limit applies.
  The Stall policy stops and recovers a stuck unattended planning or
  implementation session, and blocks the Run attempt after repeated Stalls. Set
  `pi.timeoutMinutes` for an extra hard cap. Triage stops after 90 minutes when
  no cap is set.
- Patchmill sets `timeoutMs` and `checkpointBeforeDeadlineMs` in
  `<agentDir>/extensions/subagent/config.json`, replaces an operator value for
  these two keys, and keeps the other keys. Because `checkpointBeforeDeadlineMs`
  is a fail-closed key, an invalid value of another key in that file stops
  pi-subagents from loading. Subagents get the Session cap, or the largest
  pi-subagents deadline (about 24.8 days) without a cap. A single async child
  gets a "checkpoint and stop" message 5 minutes before it; a foreground child,
  a resumed run, and an async chain or parallel step do not. Agents that
  Patchmill does not manage keep the 30-minute pi-subagents default on a resume
  and in an async chain or parallel step.
- A lock file stops two runs in the same clone from working on one issue.
  Separate clones can still race. Do not delete the lock file or its folder,
  even after a crash. To clear a stale claim, run `patchmill release --issue N`.
- Patchmill decides the next step from git and the issue host only. Logs, result
  files, and labels never decide it.
- Names are stable. Implementation branches are `agent/issue-N-<slug>`. Specs
  are `docs/specs/YYYY-MM-DD-issue-N-<slug>-design.md`. Plans are
  `docs/plans/YYYY-MM-DD-issue-N-<slug>-plan.md`. If a plan from an earlier
  version has no `-plan` suffix, rename it once.
- The skills tell the agent not to push to the base branch and not to force
  push. Shell access cannot enforce this. Use branch protection on your host to
  block direct pushes.

The [Run-once guide](https://patchmill.dev/using-patchmill/run-once/) and
[Git safety](https://patchmill.dev/reference/git-safety/) give the full rules.

## Skills

`patchmill init` installs the Patchmill skills in `.patchmill/skills`, together
with pinned [Superpowers](https://github.com/obra/superpowers) and SimpleEnglish
skills. Three keys in `patchmill.config.json` select the skill for each step:
`skills.triage`, `skills.planning`, and `skills.implementation`. Each key names
a directory that contains a `SKILL.md` file.

To change the workflow, copy a skill to a new directory, edit the copy, and set
the matching key to that directory. Your skill must keep the result format that
the kernel reads, and must leave labels and issue comments to the kernel. Put
project rules, such as setup and test commands, in skills or `AGENTS.md`.

Run `patchmill skills update` after you upgrade Patchmill. The command refuses
to overwrite managed skill files that you edited.

For visible browser changes, planning adds an offline HTML mockup of the full
page to the spec. After validation, implementation reviews the frontend against
pinned local rules, fixes each valid finding, and records the review in the pull
request. Backend work, documentation, and small text changes skip both steps.
See [Skills configuration](https://patchmill.dev/guides/skills-configuration/)
and the [Skills workflow](https://patchmill.dev/reference/skills-workflow/)
diagrams.

## Roadmap

The [roadmap](docs/roadmap.md) describes future work, not current features.

## License

Apache-2.0. See [LICENSE](LICENSE).
