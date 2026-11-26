---
title: Configuration
description: Configure the host, paths, skills, timeout, and planning gates.
---

Patchmill reads `patchmill.config.json` from the repository root. Run
`patchmill init --provider github-gh` to create it when missing. Every supported
key has a default. Unknown keys fail loading by name. There are no aliases or
earlier-version readers. Retired spec/plan review-label settings and
string-valued `labels.blocked` are accepted but ignored. New configuration omits
them. Dependency links belong in the issue tracker, not label configuration.
[Update old blocked issues manually before using the upgrade](/using-patchmill/triage/#manual-upgrade).

## Host and trust

`host.provider` is `github-gh` or `forgejo-tea`. GitHub uses the active `gh`
authentication context. Its init flow can seed `host.login` with the detected
username. It does not use that value to select a GitHub account.

For Forgejo, `host.login: ""` means Tea's default profile. Use an explicit Tea
profile alias to select another profile. Do not substitute the detected username
for the alias. `init --provider forgejo-tea --login PROFILE` records that alias.
There is no Patchmill environment override for the login.

The authenticated username and `host.trustedAuthors` identify trusted comment
authors. GitHub also trusts its nonempty configured `host.login`. A Tea profile
alias does not grant trust. Duplicate identities count once. Issue content and
comments remain untrusted instructions, even from those authors.

Patchmill also accepts a GitHub App installation token in `GH_TOKEN`, for
example in CI. An App token has no username, so only `host.login` and
`host.trustedAuthors` grant trust. Put the bot login, for example
`patchmill-e2e[bot]`, and the maintainer logins in `host.trustedAuthors`. If
`host.login` and this list are both empty, no comment author is trusted.
`patchmill doctor` warns when this list is empty.

## Planning gates

`workflow.specApproval.required` and `workflow.planApproval.required` each
default to `false`. Set either to `true` to require a separate planning pull
request for that stage. Only merging that pull request into the base unlocks the
next stage. Review approval alone does not unlock it.

The issue stays `in-progress` while waiting. A later run resumes under the same
issue lock. Ungated documents go into the next required planning pull request,
or the implementation pull request when no later gate is required. With both
gates off, planning writes both documents and continues to implementation.

## Run loop

The `run` section controls `patchmill run`. Other commands ignore it, except
`run.conflictRetryMinutes`, which also applies to `patchmill run-once` without
`--issue`.

| Key                               | Default | Meaning                                                            |
| --------------------------------- | ------- | ------------------------------------------------------------------ |
| `run.triageIntervalMinutes`       | `5`     | Minimum time between two triage runs.                              |
| `run.conflictRetryMinutes`        | `30`    | Minimum time between two conflict resolutions of one pull request. |
| `run.idleBackoff.initialSeconds`  | `60`    | First wait when no issue is eligible.                              |
| `run.idleBackoff.maxSeconds`      | `900`   | Longest wait when no issue is eligible.                            |
| `run.errorBackoff.initialSeconds` | `30`    | First wait after a failed pass.                                    |
| `run.errorBackoff.maxSeconds`     | `1800`  | Longest wait after failed passes.                                  |

Each wait doubles after each pass of the same kind, up to its maximum. Jitter
makes the actual wait between half and all of that value. A pass that does work
resets both waits. Each value must be a number greater than 0. Each `maxSeconds`
must be at least its `initialSeconds` and at most `2147483` (about 24 days).

## Paths and git

`paths` contains `specsDir`, `plansDir`, `worktreeDir`, and `runsDir`. The
defaults are `docs/specs`, `docs/plans`, `.worktrees`, and `.patchmill/runs`.
Required planning gates use separate branches and worktrees. Each later branch
starts from the fetched base after earlier planning PRs merge.
`git.baseBranch: null` uses the remote default branch. A string selects an
explicit base branch. The remote is `origin`.

## Cleanup hook

The optional top-level `cleanupHook` names a Bash script. Omit it for no hook. A
non-string value fails with `Invalid type for cleanupHook`.

```json
{
  "cleanupHook": "./scripts/cleanup.sh"
}
```

After a confirmed implementation merge and issue closure, Patchmill runs
`bash <cleanupHook>` from the implementation worktree before any workspace
removal. Relative paths resolve there. The script needs no executable bit. A
failing hook keeps all worktrees and branches without changing the done outcome.
Patchmill reports the error and cleanup log path.

Every real run sweeps local candidates before open-issue selection, including
non-interactive runs and `--plan-only`. A dry run skips cleanup. Interactive
merge confirmation also triggers immediate cleanup under the issue lock. After
the hook, dirty workspaces remain with their branches and an operator notice.

`<runsDir>/issue-N/cleanup.json` records a successful hook step. It prevents
repetition during partial cleanup retries, but never replaces fresh merge
verification. Hook output and diagnostics enter `cleanup.log` beside that
receipt. A corrupt receipt or missing hook directory requires manual inspection.

Use an idempotent script that touches only issue-scoped resources and tolerates
missing resources. Exit non-zero when resource cleanup is incomplete. Never
remove Patchmill worktrees, branches, PRs, run state, or lock files from the
hook. See [Run-once](/using-patchmill/run-once/#supervision-and-cleanup) for
triggers and retry behavior.

## Skills and Pi

`skills` contains only `triage`, `planning`, and `implementation`. Each value
names a directory with a `SKILL.md` file. Put repository procedures in skills
and `AGENTS.md`, not extra configuration keys.

`pi.agentDir` defaults to `.patchmill/pi-agent`.

`pi.timeoutMinutes` is the optional Session cap. The default is `null`: phase
sessions have no wall-clock limit, and the Stall policy stops a stuck unattended
session. A number sets a cap in minutes. It must be greater than 0 and at most
35791, or Patchmill rejects the configuration. About 5 minutes before a cap
ends, Patchmill asks the agent to start no new work and hand off. Triage has no
Stall policy, so without a cap a triage session stops after 90 minutes.

Patchmill sets `timeoutMs` and `checkpointBeforeDeadlineMs` in
`<agentDir>/extensions/subagent/config.json` before each session, and keeps the
other keys of that file. Subagents get the Session cap, or the largest deadline
that pi-subagents accepts (about 24.8 days) when no cap is set. A single async
child gets a "checkpoint and stop" message 5 minutes before its deadline. A
foreground child, a resumed run, and an async chain or parallel step get no such
message. The managed `reviewer` and `patchmill-implementation` agents carry the
same `timeoutMs`, so a resume or a chain step of these agents gets it too. Other
agents keep the pi-subagents default of 30 minutes on a resume and in an async
chain or parallel step. Patchmill owns these two keys and replaces an operator
value for them. `checkpointBeforeDeadlineMs` is a fail-closed key of
pi-subagents: while it is in the file, an invalid value of another key there
stops pi-subagents from loading, instead of a logged fallback.

Upgrade note: a configuration that `patchmill init` wrote earlier has
`"timeoutMinutes": 90`. That value keeps a 90-minute cap, which now also limits
subagents. Set it to `null` to turn the cap off.

`pi.commandTimeoutMinutes` defaults to 20. It is the timeout that an agent
`bash` call gets when it sets none. `pi.maxCommandTimeoutMinutes` defaults
to 25. It is the longest timeout that an agent `bash` call can get. A longer
request gets the cap. Set a value to `0` to turn that limit off. The default
must not be longer than an enabled cap. The limits also apply in subagent
sessions.

`pi.stallStopMinutes` defaults to 10. When an unattended planning or
implementation session and its subagent sessions show no activity for this time,
Patchmill stops the turn and asks the agent to continue another way. A running
`bash` call inside its timeout is not quiet. `pi.maxStalls` defaults to 3. A
Command timeout and a stall stop both count as a Stall. When the number of
Stalls reaches `pi.maxStalls`, Patchmill stops the Run attempt at Needs Info. A
second Stall of the same command also stops it. Set a value to `0` to turn that
limit off.

Run `patchmill auth` to configure provider credentials and choose a default
model in `pi.agentDir`. The command verifies the provider and returns to the
shell without opening Pi chat. See
[Skills configuration](/guides/skills-configuration/).

## Full defaults

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

`init` leaves valid existing configuration unchanged. Invalid configuration
fails rather than being repaired. Commit shared configuration and installed
skills. Keep credentials and run output local. After changes, run
`patchmill doctor`. That command includes a real Pi smoke prompt.
