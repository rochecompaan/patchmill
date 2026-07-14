---
title: Configuration
description: Configure the Patchmill workflow your agents should follow.
---

Patchmill reads repository behavior from `patchmill.config.json`.

Before running `patchmill init`, make sure the repository's issue-host CLI is
installed and authenticated. Patchmill uses GitHub's `gh` CLI or Forgejo/Gitea's
`tea` CLI for issue and pull-request operations; see
[Providers](/guides/providers/) for setup details.

Then initialize the repository and customize only the parts that change how your
team wants agents to work.

```sh
patchmill init
```

A good first configuration answers five questions:

1. Which issue host should Patchmill use?
2. Should humans approve specs or plans before implementation?
3. How should agents prepare the development environment?
4. Which skills should guide implementation, review, visual evidence, and
   landing?
5. Where should Patchmill look for project context, validation commands, and
   visual reference files?

## Configure the issue host

`host` tells Patchmill which issue and pull-request provider to use. `init`
usually writes this for you.

```json
{
  "host": {
    "provider": "github-gh",
    "login": ""
  }
}
```

Use `github-gh` for GitHub through the active `gh` CLI authentication context.
GitHub does not use `host.login` to choose an account.

For Forgejo/Gitea through the `tea` CLI, set the configured login name:

```json
{
  "host": {
    "provider": "forgejo-tea",
    "login": "triage-agent"
  }
}
```

`PATCHMILL_HOST_LOGIN` can override `host.login` for providers that use named
logins, which is useful when local machines need different credentials.

## Decide when humans approve work

`workflow.specApproval` and `workflow.planApproval` control whether `run-once`
stops for human approval before continuing.

```json
{
  "workflow": {
    "specApproval": {
      "required": true,
      "reviewLabel": "spec-review",
      "approvedLabel": "spec-approved"
    },
    "planApproval": {
      "required": true,
      "reviewLabel": "plan-review",
      "approvedLabel": "plan-approved"
    }
  }
}
```

Good starting points:

- Leave both approvals off for solo projects or low-risk maintenance queues.
- Require plan approval when humans should review the implementation approach
  before agents edit code.
- Require spec approval when issues often need product, UX, or architecture
  clarification before planning.

When approval is required, Patchmill writes the artifact, applies the review
label, and stops. Add the corresponding approved label to let the next
`patchmill run-once` continue.

## Teach agents how to work in this repository

`skills` is the most important section to customize. Skills are the instructions
Patchmill gives agents at each workflow stage.

```json
{
  "skills": {
    "triage": ".patchmill/skills/patchmill-issue-triage",
    "planning": ".patchmill/skills/writing-plans",
    "implementation": ".patchmill/skills/subagent-driven-development",
    "visualEvidence": ".patchmill/skills/patchmill-visual-evidence"
  }
}
```

Start with the generated `triage`, `planning`, `implementation`, and
`visualEvidence` skills. Then add optional hooks only after the referenced skill
exists in the repository:

```json
{
  "skills": {
    "developmentEnvironment": ".patchmill/skills/development-environment",
    "toolchain": ".patchmill/skills/project-toolchain",
    "review": ".patchmill/skills/project-review",
    "landing": ".patchmill/skills/project-landing"
  }
}
```

Each path-like value must resolve to a `SKILL.md` file. For example,
`.patchmill/skills/project-review` means Patchmill will look for
`.patchmill/skills/project-review/SKILL.md`.

Add only the optional hooks your repository needs:

- `developmentEnvironment`: run before implementation when agents need local
  services, seeded data, Tilt, Docker, Kubernetes, or another setup step.
- `toolchain`: describe how to install dependencies, run tests, start servers,
  and validate changes.
- `review`: require explicit review passes before final handoff.
- `landing`: describe when direct landing is allowed versus when the agent must
  open a pull request. Direct landing also requires the matching git policy.
- `visualEvidence`: describe how to capture screenshots or other proof for UI
  changes.

Prefer project-local skill paths under `.patchmill/skills/` when the team wants
reviewable, versioned agent instructions. Use global or bundled skill names only
when the exact skill text does not need to live in the repository.

For heavier implementation review loops, the recommended skill pack also
installs opt-in implementation skills such as:

```json
{
  "skills": {
    "implementation": ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews"
  }
}
```

See [Skills configuration](/guides/skills-configuration/) for the full skill
surface.

## Configure visual evidence paths

Visual evidence has two parts:

- `skills.visualEvidence` tells agents how to capture evidence.
- `projectPolicy.visualEvidence` tells Patchmill which committed screenshot
  paths are valid and gives agents an example evidence entry.

```json
{
  "projectPolicy": {
    "visualEvidence": {
      "referenceScreenshotPaths": ["docs/screenshots", "docs/visual-baselines"],
      "prEvidenceExample": {
        "screenshotPath": "docs/screenshots/example-screen.png",
        "caption": "Reference screenshot for the changed UI state",
        "referencePaths": ["docs/visual-baselines/homepage.png"]
      }
    }
  }
}
```

Use this when UI changes need proof in the pull request. Keep screenshot paths
inside directories the team is willing to commit, because Patchmill validates
that referenced evidence files are present before cleanup.

## Set project expectations

`projectPolicy` carries repository-specific expectations that should appear in
agent prompts.

```json
{
  "projectPolicy": {
    "projectName": "Example Project",
    "contextFileNames": ["AGENTS.md", "CONTRIBUTING.md"],
    "validation": {
      "rules": [
        {
          "category": "tests",
          "commands": ["npm test"]
        },
        {
          "category": "docs",
          "commands": ["npm run docs:build"]
        }
      ],
      "forbiddenSubstitutions": [
        "Do not replace browser evidence with static screenshots from design files."
      ]
    }
  }
}
```

The most useful starting points are:

- `contextFileNames`: files agents should read for repository rules.
- `validation.rules`: commands agents should run for common change categories.
- `forbiddenSubstitutions`: shortcuts agents must not take when validation or
  evidence is required.

Keep this section short. Put long procedures in skills, where they can be
reviewed and reused by the relevant workflow stage.

## Keep paths predictable

Most teams can keep the generated `paths` defaults. Customize them when your
repository already has conventions for specs, plans, worktrees, or run logs.

```json
{
  "paths": {
    "specsDir": "docs/specs",
    "plansDir": "docs/plans",
    "worktreeDir": ".worktrees",
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs"
  }
}
```

Commit `patchmill.config.json` and project-local skills when the workflow should
be shared by the team. Keep machine-specific runtime state such as
`.patchmill/pi-agent/`, `.patchmill/runs/`, and `.patchmill/triage-runs/` local.

## What not to configure first

You usually do not need to set `git.baseBranch`. When it is omitted, `run-once`
detects the pull-request target branch from local git metadata and falls back to
`main` only when detection cannot find a better answer.

Only set git policy when your repository has unusual branch, remote, worktree,
or direct-landing rules. Otherwise, start with workflow gates, skills,
development-environment setup, and validation policy.

## Check the result

After changing configuration, run:

```sh
patchmill doctor
patchmill triage --dry-run
```

`doctor` validates host access, labels, skills, runtime access, and local paths.
`triage --dry-run` confirms that Patchmill can read issues before it mutates
labels or comments.

For a fuller reference, see
[Environment and configuration reference](/reference/environment-and-config/)
and the repository `docs/configuration.md` file.
