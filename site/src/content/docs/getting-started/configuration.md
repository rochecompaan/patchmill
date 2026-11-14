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

## Planning gates

`workflow.specApproval.required` and `workflow.planApproval.required` each
default to `false`. Set either to `true` to require a separate planning pull
request for that stage. Only merging that pull request into the base unlocks the
next stage. Review approval alone does not unlock it.

The issue stays `in-progress` while waiting. A later run resumes under the same
issue lock. Ungated documents go into the next required planning pull request,
or the implementation pull request when no later gate is required. With both
gates off, planning writes both documents and continues to implementation.

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

`pi.agentDir` defaults to `.patchmill/pi-agent`. `pi.timeoutMinutes` defaults to
90 for each session. Run `patchmill auth` to configure provider credentials and
choose a default model in that directory. The command verifies the provider and
returns to the shell without opening Pi chat. See
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
  "pi": { "agentDir": ".patchmill/pi-agent", "timeoutMinutes": 90 },
  "workflow": {
    "specApproval": { "required": false },
    "planApproval": { "required": false }
  }
}
```

`init` leaves valid existing configuration unchanged. Invalid configuration
fails rather than being repaired. Commit shared configuration and installed
skills. Keep credentials and run output local. After changes, run
`patchmill doctor`. That command includes a real Pi smoke prompt.
