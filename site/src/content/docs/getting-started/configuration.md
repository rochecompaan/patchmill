---
title: Configuration
description: Configure the host, paths, skills, timeout, and spec gate.
---

Patchmill reads `patchmill.config.json` from the repository root. Run
`patchmill init --provider github-gh` to create it when missing. Every supported
key has a default. Unknown keys fail loading by name. There are no aliases or
earlier-version readers.

## Host and trust

`host.provider` is `github-gh` or `forgejo-tea`. GitHub uses the active `gh`
authentication context. Its init flow can seed `host.login` with the detected
username. It does not use that value to select a GitHub account.

For Forgejo, `host.login: ""` means Tea's default profile. Use an explicit Tea
profile alias to select another profile. Do not substitute the detected username
for the alias. `init --provider forgejo-tea --login PROFILE` records that alias.
There is no Patchmill environment override for the login.

`host.login` and `host.trustedAuthors` identify trusted comment authors. Issue
content and comments remain untrusted instructions, even from those authors.

## Spec gate

`workflow.specApproval.required` defaults to `true`. A pushed spec stops at
`spec-review` until a human adds `spec-approved` and `agent-ready`. For
revisions, leave approval off, add review comments and `agent-ready`, then
rerun. One planning session revises the existing spec and stops for review
again. The plan receives review with the pull request, not a separate approval
gate.

## Paths and git

`paths` contains `specsDir`, `plansDir`, `worktreeDir`, and `runsDir`. The
defaults are `docs/specs`, `docs/plans`, `.worktrees`, and `.patchmill/runs`.
One branch and worktree serve each issue. `git.baseBranch: null` uses the remote
default branch. A string selects an explicit base branch. The remote is
`origin`.

## Skills and Pi

`skills` contains only `triage`, `planning`, and `implementation`. Each value
names a directory with a `SKILL.md` file. Put repository procedures in skills
and `AGENTS.md`, not extra configuration keys.

`pi.agentDir` defaults to `.patchmill/pi-agent`. `pi.timeoutMinutes` defaults to
90 for each session. Use Pi's `/login` and `/model` flows through
`patchmill auth` for runtime choices. See
[Skills configuration](/guides/skills-configuration/).

## Full defaults

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

`init` leaves valid existing configuration unchanged. Invalid configuration
fails rather than being repaired. Commit shared configuration and installed
skills. Keep credentials and run output local. After changes, run
`patchmill doctor`. That command includes a real Pi smoke prompt.
