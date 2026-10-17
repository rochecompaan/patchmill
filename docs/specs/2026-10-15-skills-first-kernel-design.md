# A skills-first Patchmill kernel

- **Issue:** none yet. This design came from the simplification review on
  2026-10-14.
- **Status:** Proposed design
- **Scope:** Replace the deterministic workflow engine with a small kernel. Move
  all judgment into skills. Keep every user-visible capability that earns its
  place.

## Purpose and evidence

Patchmill started as a thin wrapper that hands one issue to a Pi agent. It has
grown into a workflow engine that tries to control the agent's work step by
step. Most of that control re-does work that git and the issue host already
record, or polices advice that belongs in a skill.

The numbers on `main` at `e422162`:

| Area                               | Production lines | Notes                                  |
| ---------------------------------- | ---------------: | -------------------------------------- |
| All production TypeScript          |           53,510 | 294 files                              |
| All test TypeScript                |           85,546 | 263 files, plus 4,317 lines of support |
| `run-once` command                 |           25,774 | 124 files, 32 of them `planning-*`     |
| Persisted planning state machine   |          ~12,000 | `planning-*` across workflow, git, CLI |
| Recovery, lease, and lock          |           ~5,000 | `recovery-*` alone is 15 files         |
| Legacy workflow and its dependents |           ~7,700 | measured in #298                       |
| Result and terminal diagnostics    |            2,620 | 13 files explain why a run stopped     |
| Subagent progress correlation      |           ~2,400 | parses Pi session JSONL for a display  |
| `init` command                     |            3,776 | its own auth and model-selection TUI   |
| Prompt builders                    |           ~1,100 | multi-page prompts per phase           |
| Vendored todo extension            |            2,142 | polices the agent's note-taking        |
| All bundled skills                 |            1,088 | the part that holds the workflow       |

The maintainer's own audit (#293) found that the largest blocker classes were
tracked workspace changes, the terminal output contract, and workflow deadlines
or stalled children. Each one is a case where code checked the agent's work
against a contract and stopped. The contracts, not the agents, produced most of
the stops.

### The thought experiment

Imagine Patchmill as one skill: "Find an issue labelled `agent-ready`. Claim it.
Create a worktree and branch. Write the spec and plan into `docs`. Implement.
Validate. Open a pull request that closes the issue. If you cannot proceed, post
your questions and stop." Pi with `gh` or `tea` on `PATH` can do every step
today. The planning, implementation, visual-evidence, and triage skills already
cover the judgment in about a thousand lines of prose.

Five things break in that version, and only these justify code:

1. **Process supervision.** Something must start Pi without a terminal, set the
   agent directory, enforce a wall-clock limit, kill a hung process group, and
   read the final result. The agent cannot supervise itself.
2. **Mutual exclusion.** Two unattended runs must not claim the same issue.
3. **A fact check at the end.** Patchmill must not trust the agent's claim of
   success. The issue host can answer the real question: is there a pull request
   that closes this issue?
4. **Resumption by observation.** When a run dies, the next run must look at the
   world and continue from what exists.
5. **Stable names and paths.** Branch names, worktree locations, spec and plan
   paths. Humans and agents must find the same files.

Everything else is advice. Advice belongs in a skill file that the agent reads,
not in a prompt renderer with a config schema behind it.

## Decisions

| Topic              | Decision                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel scope       | Five responsibilities: supervise Pi, claim and release, derive phase, verify outcome, fixed names. Nothing else is deterministic.                             |
| Workflow state     | None persisted. Every Run attempt derives the phase from git and the host. Logs and session files are outputs, never inputs.                                  |
| Branch model       | One branch and one worktree per issue. Spec, plan, and implementation live on that branch. No planning pull requests.                                         |
| Pull request model | One pull request per issue. The agent may open it as a draft during planning and marks it ready when implementation is complete.                              |
| Human gate         | One optional gate: spec approval, recorded as the `spec-approved` label on the issue. No plan approval gate. The plan is reviewed with the pull request.      |
| Host mutations     | The kernel owns issue labels and the run report comment. The agent owns git, the branch, and the pull request. Neither does the other's job.                  |
| Prompt             | One short envelope: facts, the untrusted boundary, the skill to follow, and the result contract. Target under 150 template lines.                             |
| Result contract    | A final fenced JSON block with `status` and `summary`. Nothing else.                                                                                          |
| Todo contract      | Removed. The vendored todo extension, task contract, done-status policy, and todo checks go. Skills may recommend todos. Code never checks them.              |
| Config             | Host, labels, paths, base branch, skills, Pi timeout and agent directory, trusted authors, and the spec gate. Unknown keys fail loading by name.              |
| Init and auth      | Patchmill provisions the agent directory and skills. Provider login and model choice use Pi's own interactive flows.                                          |
| Triage             | Code lists candidates, runs Pi with the triage skill, and applies the returned labels and comment. No simulated dry-run agent.                                |
| Diagnostics        | The agent's `summary` is the diagnostic. The kernel prints the final JSON, one outcome line, and a best-effort cost line.                                     |
| Build strategy     | Blank slate. The kernel is a fresh tree. No code is ported for compatibility. The old tree is deleted in the same change.                                     |
| Earlier versions   | No upgrade path. The kernel reads no run state, config, label, spec, or plan from an earlier Patchmill and contains no migration code.                        |
| Quality gates      | Keep type checks, lint, format, markdown lint, and `node --test`. Remove mutation testing, the CRAP gate, dependency-cruiser, property tests, contract tests. |
| Tests              | End-to-end tests of `runOneIssue` against a fake host and a fake Pi. Unit tests only for the derived-phase table, result parsing, naming, and supervision.    |
| Hosts              | GitHub through `gh` and Forgejo through `tea`, both behind one small interface.                                                                               |

## The kernel's five responsibilities

### 1. Supervise one Pi process

The kernel starts Pi once per phase:

```sh
PI_CODING_AGENT_DIR=<repo>/.patchmill/pi-agent \
pi -p --session-dir <runDir>/sessions --skill <skillPath> @<runDir>/prompt.md
```

- The working directory is the issue worktree.
- The child runs in its own process group. On timeout, cancellation, or
  `SIGINT`/`SIGTERM` to Patchmill, the kernel sends `SIGTERM` to the group,
  waits a short grace period, then sends `SIGKILL`.
- The wall-clock limit comes from `pi.timeoutMinutes`. There is no other stall
  detection. Per-command timeouts inside the session are a Pi or skill concern
  (#322), not a kernel concern.
- Stdout and stderr stream to the console and to `<runDir>/pi.log`.
- The result is the last fenced `json` block in stdout. A missing or invalid
  block is a failed Run attempt with the reason "no result".
- Cost is best effort: sum usage from the session file when readable, and print
  one line. A cost failure never fails the run.

Print mode (`-p`) stays for now. Moving to RPC mode (#305) changes only this
section.

### 2. Claim and release an issue

Selection takes `--issue N`, or the oldest open issue that carries the ready
label and not the in-progress label.

Claiming has two layers:

- **Same clone.** A permanent file at `.patchmill/runs/issue-N/lock` uses an
  OS-managed exclusive lock through `fs-ext`. If another process holds the lock,
  the Run attempt stops with "another Run attempt is active". The OS releases
  ownership when the process exits. The JSON process id and start time are
  diagnostic only. The kernel never removes or replaces the file. See the
  approved [issue-lock revision](2026-10-16-issue-lock-design.md).
- **Across clones.** The label swap from `agent-ready` to `in-progress`, re-read
  once after the swap. A narrow race window between two clones is accepted and
  documented. There are no leases, revision counters, or repair flows.

Release always runs after timeout, termination, or a thrown error. Remove
`in-progress`, add the outcome label, clear the diagnostic JSON while locked,
and close the lock handle. Keep the file and its containing directory in place.
A hard crash can leave `in-progress` on the issue. The operator runs
`patchmill release --issue N`, which acquires the same local lock before it
swaps the label back to `agent-ready`. Contention stops the command without
changing labels. The command releases its handle in `finally`.

### 3. Derive the phase from the world

After claiming, the kernel runs `git fetch origin`, resolves F1, creates the
worktree when it is missing, and collects the remaining facts in that worktree:

| Fact | Question                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| F1   | Does a remote branch `agent/issue-N-*` exist? (One match is used. Several matches stop the run with `needs-info`.) |
| F2   | Does a spec `<specsDir>/*-issue-N-*-design.md` exist in the worktree?                                              |
| F3   | Does a plan `<plansDir>/*-issue-N-*.md` exist in the worktree?                                                     |
| F4   | Is spec approval satisfied? True when the gate is off, or when the issue carries `spec-approved`.                  |
| F5   | Is there a pull request whose head is the branch? None, draft, open, merged, or closed.                            |

F2 and F3 match these names and nothing else. A file with another name does not
exist as far as the kernel is concerned.

The phase follows from the facts, in this order:

| Condition                  | Result                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| F5 is merged               | Stop. Label `agent-done`. Comment that the work is already merged.       |
| F2 is false                | Phase `planning`.                                                        |
| F2 is true and F4 is false | Stop. Label `spec-review`. Comment with the spec link and the PR if any. |
| F3 is false                | Phase `planning`. The envelope says the spec exists and names it.        |
| otherwise                  | Phase `implementation`. The envelope names the PR and its state if any.  |

One exception applies when the issue carried `agent-ready` before the claim. If
its spec exists and lacks required approval, the attempt runs one initial
`planning` session to revise it. The exception does not change the facts or
grant approval. A verified revision stops at `spec-review`. It does not enter
`implementation` in that attempt. Other results follow the verification table.
The merged pull request stop still takes precedence.

A Run attempt advances through phases in order. Each phase is a fresh Pi
session. The kernel re-derives the facts between sessions. The attempt stops
when a phase needs a human, when the implementation phase verifies, or when
`--plan-only` was given and planning is complete.

The worktree lives at `<worktreeDir>/<branch-dir>`. It is created from the
remote branch when one exists and from the base branch otherwise. The kernel
never deletes a worktree. Cleanup is a human task through the
`patchmill-cleanup` skill.

### 4. Verify the outcome

After each Pi session the kernel fetches again and checks the world, not the
agent's words:

| Agent status  | Phase            | Verification                                                                                           | Outcome                                                    |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `done`        | `planning`       | F1 and F2 are true. If the gate is on and `spec-approved` is absent: stop with `spec-review`.          | Continue, or stop for review.                              |
| `done`        | `implementation` | An open, non-draft pull request has head = branch and a body that contains `Closes/Fixes/Resolves #N`. | Label `agent-done`.                                        |
| `done`        | any              | Verification failed.                                                                                   | Label `needs-info`. Comment: claim not verified.           |
| `needs-input` | any              | None.                                                                                                  | Label `needs-info`. Comment with the summary.              |
| `failed`      | any              | None.                                                                                                  | Label `needs-info`. Comment with the summary.              |
| no result     | any              | None.                                                                                                  | Label `needs-info`. Comment: timeout, exit code, log path. |

After a verified implementation the kernel also runs `git status --porcelain`
and `git rev-list origin/<branch>..<branch>` in the worktree. Uncommitted or
unpushed work produces a warning in the comment and the console. It does not
fail the run. The pull request is real either way.

The kernel posts exactly one comment per stop. The comment carries the outcome,
the agent's `summary`, the cost line, and any warnings. The agent does not post
issue comments and does not touch labels.

### 5. Stable names and paths

| Item          | Rule                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| Branch        | `agent/issue-<N>-<slug>`, slug from the title at creation, 48 characters at most.             |
| Worktree      | `<worktreeDir>/<branch with "/" replaced by "-">`, default `.worktrees`.                      |
| Spec          | `<specsDir>/<YYYY-MM-DD>-issue-<N>-<slug>-design.md`, default `docs/specs`.                   |
| Plan          | `<plansDir>/<YYYY-MM-DD>-issue-<N>-<slug>.md`, default `docs/plans`.                          |
| Run directory | `.patchmill/runs/issue-<N>/<run-id>/` with `prompt.md`, `pi.log`, `sessions/`, `result.json`. |

`result.json` is a write-only record for operators and future tooling. The
kernel never reads it to make a decision.

## Issue lifecycle

Labels the kernel owns:

| Label           | Meaning                                               | Set by                    | Removed by           |
| --------------- | ----------------------------------------------------- | ------------------------- | -------------------- |
| `agent-ready`   | Eligible for a Run attempt.                           | Human or triage           | Kernel on claim      |
| `in-progress`   | A Run attempt holds this issue.                       | Kernel on claim           | Kernel on release    |
| `spec-review`   | The spec is pushed. A human must review it.           | Kernel after verification | Kernel on next claim |
| `spec-approved` | A human approved the spec.                            | Human                     | Human                |
| `needs-info`    | The agent asked questions, or the Run attempt failed. | Kernel                    | Kernel on next claim |
| `agent-done`    | A ready pull request that closes the issue exists.    | Kernel after verification | Human                |

Triage labels (`agent-unsuitable`, `blocked`, `wontfix`) are set by the triage
flow only.

To resume any stopped issue, a human adds `agent-ready`. For a spec stop, the
human also adds `spec-approved`, or leaves it off and adds review comments on
the draft pull request or the issue. In the second case the next Run attempt
uses the one-session revision exception above. The skill tells the agent to read
the review comments and revise the spec.

Re-running an issue that already has an open, ready pull request derives phase
`implementation`. The envelope names the pull request, and the implementation
skill tells the agent to read its review comments and address them.

## The prompt envelope

The envelope replaces all phase-specific prompt builders. It contains, in this
order:

1. One line of role: unattended Patchmill run for repository, issue, and phase.
2. The skill to follow, by name and path. The skill is also loaded with
   `--skill`, so Pi lists it as available.
3. Facts: worktree path, branch, base branch, spec and plan paths (existing or
   expected), the pull request and its state if any, the spec gate state, the
   time limit, and the result contract.
4. The untrusted issue content boundary, then the issue title, body, labels, and
   comments. Each comment carries its author and a trusted or untrusted mark.
   Trusted authors are `host.login` plus `host.trustedAuthors`.
5. Hard rules, kept to a handful: commit and push before finishing; never push
   the base branch; never force-push; never change labels; put questions in the
   summary; end with the JSON block.

The template is one file. The target is under 150 lines. Nothing else goes in
it. Todo contracts, validation rule lists, subagent orchestration prose,
visual-evidence examples, and finalization gates belong in skills or nowhere.

## The result contract

The agent ends its final message with one fenced block:

```json
{ "status": "done", "summary": "What was done, in Markdown." }
```

`status` is `done`, `needs-input`, or `failed`. `summary` is Markdown and is
posted as the issue comment on every stop. Questions for humans go in the
summary. There are no other fields. The kernel derives pull request URLs, paths,
and commits itself.

## Skills

Skills shipped in the Patchmill package and installed by `init` into
`.patchmill/skills`:

| Skill                                                    | Role                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patchmill-issue-triage`                                 | Classifies one issue and returns the triage JSON (labels and comment) that the kernel applies.                                                                                                        |
| `patchmill-planning`                                     | Writes the spec on the issue branch, commits, pushes, opens or updates a draft pull request, then stops with `done` when the gate is on. Otherwise continues to the plan. Revises on review comments. |
| `patchmill-implementation`                               | Sets up the development environment, implements the plan, validates, may use todos and subagents, and marks the pull request ready with a body that closes the issue (`Closes #N`).                   |
| `patchmill-visual-evidence`                              | Advice for user-facing changes. Nothing in code checks it.                                                                                                                                            |
| `module-size`                                            | Advice on file size.                                                                                                                                                                                  |
| `patchmill-cleanup`, `patchmill-label`, `patchmill-plan` | Human-interactive helpers.                                                                                                                                                                            |

This is the complete list. There is no upload skill, because artifacts are files
on the branch. There are no separate development-environment or landing skills,
because that advice lives in `patchmill-implementation`.

The third-party pack (Superpowers, SimpleEnglish) is installed and pinned to a
release. Whether `init` uses a copy-and-hash installer or Pi's own package
manager is left to the builder. The installer must pin a release and must be
idempotent.

`init` provisions `.patchmill/pi-agent` with the reviewer agent definition
(#229) and the `pi-subagents` extension. The implementation skill may dispatch
subagents. The kernel does not observe them.

## Commands

| Command                                                    | Behaviour                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `patchmill init`                                           | Write config when missing, install skills, provision the agent directory. Idempotent.                                                |
| `patchmill auth`                                           | Run Pi interactively with the agent directory set. Login and model choice use Pi's `/login` and `/model`. Patchmill records nothing. |
| `patchmill doctor`                                         | Read-only checks: host CLI logged in, labels exist, worktree directory ignored, skills present, Pi answers a smoke prompt.           |
| `patchmill labels setup`                                   | Create missing labels.                                                                                                               |
| `patchmill triage [--dry-run]`                             | Run the triage skill per candidate issue. Dry run runs Pi and prints the labels and comment instead of applying them.                |
| `patchmill run-once [--issue N] [--dry-run] [--plan-only]` | Advance one issue. Dry run prints the selected issue and derived phase without claiming or running Pi.                               |
| `patchmill release --issue N`                              | Clear a stale claim after a hard crash.                                                                                              |
| `patchmill version`                                        | Print the version.                                                                                                                   |
| `patchmill setup-test-repo`                                | Development tool for the end-to-end CI (#320). Outside the kernel.                                                                   |

This table is the complete command set.

`runOneIssue(config, options)` remains the programmatic entry point so a later
loop (#236) can call it.

## Configuration

```json
{
  "host": { "provider": "github-gh", "login": "", "trustedAuthors": [] },
  "labels": {
    "ready": "agent-ready",
    "inProgress": "in-progress",
    "specReview": "spec-review",
    "specApproved": "spec-approved",
    "needsInfo": "needs-info",
    "done": "agent-done",
    "unsuitable": "agent-unsuitable",
    "blocked": "blocked"
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
  "pi": { "agentDir": ".patchmill/pi-agent", "timeoutMinutes": 90 },
  "workflow": { "specApproval": { "required": true } }
}
```

`git.baseBranch` of `null` means the remote default branch. Every key has a
default. The loader recognises exactly the keys above. There are no aliases, no
deprecated keys, and no rewriting of files written by anything else. Any other
key fails loading by name. The loader targets under 200 lines.

Direct landing is not a Patchmill feature. The agent has shell access, so code
cannot stop it from pushing the base branch. Branch protection on the host is
the right control, and the documentation says so.

## Host adapters

One interface, implemented for `gh` and `tea`:

```ts
interface Host {
  checkCli(): Promise<{ ok: boolean; message: string }>;
  repository(): Promise<{ owner: string; repo: string; defaultBranch: string }>;
  listOpenIssues(): Promise<Issue[]>;
  viewIssue(n: number): Promise<Issue>; // includes comments with author and date
  listLabels(): Promise<string[]>;
  createLabel(label: {
    name: string;
    color: string;
    description: string;
  }): Promise<void>;
  setLabels(n: number, add: string[], remove: string[]): Promise<void>;
  commentIssue(n: number, body: string): Promise<void>;
  findPullRequestByHead(branch: string): Promise<PullRequest | undefined>; // url, state, draft, body
}
```

The adapters are written for this interface. Pull request body rewriting,
ownership markers, reference parsing, and existence probing are not part of it.

## What is deleted

The kernel replaces the production tree rather than extending it. Deleted in the
same change:

- `src/cli/commands/run-once/` in full, including every prompt builder.
- `src/workflow/` in full.
- `src/git/planning-*`, head adoption, remote-base evidence, and the mutation
  runner.
- `src/pi/subagent-progress*`, `src/pi/extensions/`, and `extensions/todos.ts`.
- `src/cli/commands/init/` and `src/cli/commands/triage/` are rewritten. The
  auth flow, model selection, git policy, push setup, dry-run agent, blocked
  preprocessor, and Forgejo-specific module have no successor.
- `src/cli/commands/run/`, `set-artifact/`, `skills/`, and every deprecation
  shim.
- `src/config/load.ts` and its deep-merge and clone helpers. The new loader
  replaces it.
- Quality tooling: `stryker.config.mjs`, `.crap-ts.json`, dependency-cruiser
  config, `quality/property`, and `tsconfig.contract-tests.json`.

Tests dedicated to deleted code go with it. The fake-host and fake-Pi test
support is written fresh for the kernel interface.

## No upgrade path

The kernel assumes a repository that has never run Patchmill. It has no code for
earlier versions:

- It reads no run directory, config file, label, spec, or plan written by an
  earlier Patchmill. It renames nothing, migrates nothing, and warns about
  nothing.
- Spec and plan discovery uses only the naming rules in this document.
- The config loader accepts only the keys in this document. Any other key fails
  loading by name, whatever wrote it.
- `init` on a repository that already has a valid `patchmill.config.json` leaves
  it alone. On an invalid one it fails like every other command.

There is no upgrade path from earlier versions and no compatibility window.

## Testing and quality gates

Apply the Testing Value Gate from the project instructions.

- **End-to-end tests** drive `runOneIssue` and `triage` against an in-memory
  fake host and a fake Pi. The fake Pi is a script that reads the prompt,
  performs scripted git actions in the worktree, and prints a result block.
  Scenarios: fresh issue to spec stop; approved spec to ready pull request;
  revise after review comments; unverified `done`; timeout; invalid result;
  stale lock; merged pull request; several branches.
- **Unit tests** for the derived-phase table, result-block extraction, branch
  and path rules, lock behaviour, and process-group termination.
- **Real-host check.** The end-to-end CI from #320 runs the kernel against a
  real repository and model. It is the integration gate.
- **Kept tools:** `tsc`, ESLint, Prettier, markdownlint, `node --test`.
- **Removed tools:** Stryker, the CRAP gate, dependency-cruiser, property tests,
  and the contract-tests type check.

Size targets guide the plan and the review. They are not CI gates:

| Item                   | Target                                           |
| ---------------------- | ------------------------------------------------ |
| Kernel production code | 4,300 lines or less, both host adapters included |
| Prompt template        | 150 lines or less                                |
| Config loader          | 200 lines or less                                |
| Bundled skills         | 1,500 lines or less                              |

## Glossary impact

`CONTEXT.md` defines terms that this design retires or changes. Per
`docs/agents/domain.md`, the conflicts are listed here rather than overridden
silently. Updating the glossary is part of the implementation.

| Term                   | Change                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Planning review gate   | Replaced by the spec gate, which is an approval label. The glossary currently rejects that wording. |
| Planning pull request  | Retired. There is one pull request per issue.                                                       |
| Phase workspace        | Retired. There is one worktree and branch per issue, which the glossary currently rejects.          |
| Run recovery state     | Retired. State is derived, not persisted.                                                           |
| Pi session log         | Unchanged. Still the cost source and still never a decision input.                                  |
| Issue run, Run attempt | Unchanged.                                                                                          |
| Run-once workflow      | Unchanged in meaning. Its mechanics are this document.                                              |
| Normalized run outcome | Unchanged. The kernel's outcomes map onto it for a later coordinator.                               |

## Non-goals and anti-goals

- No continuous mode, ledger, budget, or coordinator in this change. The kernel
  keeps `runOneIssue` callable so #230 to #238 can build on it later.
- No web page or progress stream (#300 to #304). The run directory layout is
  stable so a later reader can use it.
- No RPC mode (#305). It replaces only the supervision section.
- No per-command timeouts or stall heuristics inside sessions (#316, #319,
  #322). One wall-clock limit is the kernel's whole answer.
- No automatic retry of failed Run attempts. A human re-labels.
- No parity preservation of removed features. Separate planning pull requests,
  plan approval, cost publication into pull request bodies, artifact upload
  commands, and the todo contract are gone, not deferred.
- Anti-goal: a kernel that grows a second state machine. If a change needs
  persisted workflow state, it is the wrong change.

## Related issues

| Issue                        | Effect of this design                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| #298, #164, #163, #154       | Superseded. The old workflow is deleted outright.                                                  |
| #226, #250, #232             | Covered by the lock, the label swap, and process supervision.                                      |
| #229                         | Kept. The reviewer agent is provisioned by `init`.                                                 |
| #276, #317                   | Covered. Comments carry author and trust in the envelope.                                          |
| #282                         | Covered. The draft pull request is the default planning handoff.                                   |
| #227, #247, #206, #207, #191 | Moot. Cost publication, prompt caps, and artifact requirements are removed or become skill advice. |
| #305, #320                   | Compatible. Both proceed after the kernel lands.                                                   |
| #230 to #238, #300 to #304   | Deferred. Unaffected by this design.                                                               |

## Left to the builder

- The exact file layout of the kernel tree and the test support.
- The skill installer mechanism, within the pinning and idempotence rules.
- The grace period between `SIGTERM` and `SIGKILL`, and the default
  `timeoutMinutes`.
- The shape of `result.json`.
- Whether the old tree is deleted in one commit or several on the same branch.
- The release notes and the README rewrite.

## Acceptance criteria

- A fresh repository goes from `init` through `triage` and `run-once` to a ready
  pull request that closes the issue, with spec approval on, using only the
  kernel and the skills.
- Killing Patchmill mid-run, then running `run-once --issue N` again, resumes
  from the files and pull request that exist. No state file is read.
- The kernel never sets `agent-done` without an open, ready pull request whose
  head is the issue branch and whose body closes the issue.
- The agent's result block has two fields, and the envelope template is one file
  under 150 lines.
- `patchmill.config.json` with any unknown key fails loading and names the key.
- No code path reads, renames, or warns about run state, config, labels, specs,
  or plans from an earlier Patchmill version. Spec and plan discovery matches
  only the names in this document.
- The end-to-end CI from #320 passes against the kernel.
- The old `run-once` tree, the planning state machine, recovery modules, the
  todo extension, and the removed quality gates are gone from the repository.
- Production code is at most 4,300 lines excluding tests, measured with the same
  method as the table at the top.
- `CONTEXT.md` reflects the retired and changed terms.
