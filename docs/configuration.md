# Patchmill Configuration

Patchmill reads `patchmill.config.json` from the repository root. You can keep
the file small: any omitted field falls back to Patchmill defaults, and
machine-local values can come from environment variables or CLI flags.

Precedence is:

1. CLI flags
2. `PATCHMILL_*` environment variables
3. `patchmill.config.json`
4. built-in defaults

## Creating the initial config

Run `patchmill init` to create the smallest useful `patchmill.config.json` for a
repository. Init also checks Pi provider readiness through Pi's own model/auth
registry, guides you to Pi login/model setup when needed, and runs a minimal Pi
smoke test. When the smoke test passes, continue with:

```sh
patchmill triage --dry-run
```

If the smoke test fails, repair repo-local Pi provider/model setup, then run the
read-only checks:

```sh
patchmill auth
patchmill doctor
```

By default, init writes host fields and project-local skill mappings for the
main workflow stages (`triage`, `planning`, and `implementation`); Patchmill
fills omitted labels, paths, and git policy from defaults. The command output
reminds you that you can later change the login in `patchmill.config.json`
(`host.login`) or with `PATCHMILL_HOST_LOGIN`.

Accepted `host.provider` values are `forgejo-tea` for Forgejo/Gitea through
`tea` and `github-gh` for GitHub through `gh`.

## Complete example

This example shows the main configuration surface in one place. Copy only the
pieces your repository needs.

```json
{
  "host": {
    "provider": "forgejo-tea",
    "login": "triage-agent"
  },
  "pi": {
    "triageThinking": "high"
  },
  "labels": {
    "ready": "agent-ready",
    "needsInfo": "needs-info",
    "unsuitable": "agent-unsuitable",
    "in-progress": "in-progress",
    "done": "agent-done",
    "blocked": "blocked",
    "types": ["bug", "enhancement", "docs", "chore", "test"],
    "priorities": [
      "priority:critical",
      "priority:high",
      "priority:medium",
      "priority:low"
    ]
  },
  "triage": {
    "stateMap": {
      "agent-ready": "agent-ready",
      "needs-info": "needs-info",
      "agent-unsuitable": "agent-unsuitable",
      "blocked": "blocked"
    }
  },
  "workflow": {
    "specApproval": {
      "required": false,
      "reviewLabel": "spec-review",
      "approvedLabel": "spec-approved"
    },
    "planApproval": {
      "required": false,
      "reviewLabel": "plan-review",
      "approvedLabel": "plan-approved"
    }
  },
  "skills": {
    "triage": ".patchmill/skills/patchmill-issue-triage",
    "planning": ".patchmill/skills/writing-plans",
    "implementation": ".patchmill/skills/subagent-driven-development",
    "toolchain": "project-toolchain",
    "review": "project-review",
    "visualEvidence": ".patchmill/skills/patchmill-visual-evidence",
    "landing": "project-landing"
  },
  "paths": {
    "plansDir": "docs/plans",
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs",
    "worktreeDir": ".worktrees",
    "cleanStatusIgnorePrefixes": [".patchmill/runs/", ".patchmill/triage-runs/"]
  },
  "git": {
    "baseBranch": "main",
    "baseRef": "HEAD",
    "remote": "origin",
    "branchPrefix": "agent/issue-",
    "worktreePrefix": "patchmill-issue-",
    "slugLength": 48,
    "allowDirectLand": true
  },
  "cleanupHook": "./scripts/cleanup.sh",
  "projectPolicy": {
    "projectName": "Example Project",
    "contextFileNames": ["AGENTS.md"],
    "planRequiresApproval": false,
    "validation": {
      "rules": [
        {
          "category": "tests",
          "commands": ["npm test"]
        }
      ],
      "forbiddenSubstitutions": []
    },
    "directLand": {
      "targetBranch": "main"
    },
    "visualEvidence": {
      "referenceScreenshotPaths": ["docs/screenshots"],
      "prEvidenceExample": {
        "screenshotPath": "docs/screenshots/example-screen.png",
        "caption": "Reference screenshot for the changed UI state"
      }
    },
    "pi": {
      "taskContract": {
        "todoRoot": ".pi/todos",
        "todoTitlePattern": "issue-<number>-task-<two-digit-number>-<slug>",
        "todoTags": ["agent-issue", "issue-<number>"],
        "planTodoBodyRequirements": [
          "purpose",
          "the source plan checklist item",
          "checkpoint details",
          "any last error or validation notes known at planning time"
        ],
        "implementationTodoBodyRequirements": [
          "purpose",
          "the source plan checklist item",
          "checkpoint details",
          "the latest last error or validation notes"
        ],
        "doneStatuses": ["closed", "completed", "done"],
        "planTaskHeadingPattern": "## Task <number>: <label>",
        "openTaskTodosBlockFinalHandoff": true
      }
    }
  }
}
```

## Git branch-base safety

`patchmill run-once` creates issue branches from `git.baseRef`. The default is
`"HEAD"`, which is convenient after a normal clone but can be unsafe just after
initializing Patchmill: if you commit generated config locally and do not push
or merge that commit to the PR target branch, every issue branch created from
local `HEAD` would include that setup commit.

Before claiming an issue, commenting, writing run state, creating a worktree, or
running Pi, `run-once` checks that `git.baseRef` is contained in the configured
PR target base. The target base is derived from:

```text
refs/remotes/<git.remote>/<git.baseBranch>
```

When `git.baseBranch` is omitted, `run-once` first tries to detect the target
branch from local git metadata: `refs/remotes/<git.remote>/HEAD`, then the
current branch upstream if it tracks `<git.remote>`. If neither source is
available, Patchmill falls back to `main`, so the default target base remains
`refs/remotes/origin/main`.

Set `git.baseBranch` when the repository's PR target branch should be explicit
or when local git metadata cannot identify the remote default branch. Explicit
`git.baseBranch` values are authoritative and are not overwritten by detection.

If `git.baseRef` has commits that are not in the target base, `run-once` exits
non-zero and lists the commits that would leak into the issue PR. There is no
CLI or config override for this guardrail. Fix the repository state by doing one
of the following:

- push or merge the local setup commits into `<git.remote>/<git.baseBranch>`;
- run `git fetch <git.remote>` if the remote-tracking ref is stale;
- set `git.baseBranch` to the repository's PR target branch if detection chose
  the wrong branch;
- set `git.baseRef` to an upstream ref that is already contained in the target
  base, such as `refs/remotes/origin/main` or `refs/remotes/origin/master`.

`--dry-run` performs the same check because it previews whether a real
`run-once` can safely start.

## Host providers

`host.provider` must be one of:

- `forgejo-tea`: Forgejo/Gitea through `tea`.
- `github-gh`: GitHub through `gh`.

The default host provider is `forgejo-tea`, which supports named logins via
`host.login`, `--host-login`, and `PATCHMILL_HOST_LOGIN`.

For GitHub through `gh`, configure the host like this:

```json
{
  "host": {
    "provider": "github-gh",
    "login": ""
  }
}
```

`PATCHMILL_HOST_LOGIN` only affects providers with named-login support. The
first `github-gh` version uses the active `gh` authentication context.

## Triage state map

Use `triage.stateMap` to map repository triage labels into Patchmill's canonical
buckets. Keep the dashed `labels["in-progress"]` key exactly as shown in JSON.

```json
{
  "skills": {
    "triage": "triage"
  },
  "labels": {
    "ready": "ready-for-agent",
    "in-progress": "in-progress",
    "done": "agent-done",
    "blocked": "blocked"
  },
  "triage": {
    "stateMap": {
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
      "blocked": "blocked",
      "wontfix": "agent-unsuitable"
    }
  }
}
```

`triage.stateMap` keys are repository label names. Values are limited to
`agent-ready`, `needs-info`, `agent-unsuitable`, and `blocked`, and the
configured `labels.ready` label must map to `agent-ready`.

## Workflow approval gates

`workflow.specApproval` and `workflow.planApproval` configure approval labels
that control when `patchmill run-once` may proceed. These labels are workflow
signals, not triage buckets, so they are not nested under the flat `labels`
object and are not added to `triage.stateMap`.

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

`patchmill run-once` treats the configured ready label, spec-approved label, and
plan-approved label as actionable workflow states. Review labels without
matching approved labels are waiting states for human review.

When both spec and plan approval are required:

```text
agent-ready   --run-once--> write spec, stop at spec-review
spec-approved --run-once--> write/reuse spec, write plan, stop at plan-review
plan-approved --run-once--> write/reuse spec and plan, implement, stop at agent-done
```

When spec approval is required and plan approval is not required:

```text
agent-ready   --run-once--> write spec, stop at spec-review
spec-approved --run-once--> write/reuse spec, write plan, implement, stop at agent-done
```

When spec approval is not required and plan approval is required:

```text
agent-ready   --run-once--> write spec, write plan, stop at plan-review
plan-approved --run-once--> write/reuse spec and plan, implement, stop at agent-done
```

When neither approval is required:

```text
agent-ready --run-once--> write spec, write plan, implement, stop at agent-done
```

Humans may either replace review labels with approved labels or add approved
labels while leaving review labels in place. Patchmill tolerates both and
removes stale `spec-*` and `plan-*` workflow labels as it advances.

`projectPolicy.planRequiresApproval` remains as a compatibility alias. If
`workflow.planApproval.required` is omitted, Patchmill derives plan approval
from `projectPolicy.planRequiresApproval`. If both are present,
`workflow.planApproval.required` wins.

### Blocked triage state

`blocked` means the issue is clear and suitable for automation but must wait for
specific same-repository issues to close. The triage agent must record those
blockers as issue numbers in `blockedBy` and in a comment line such as
`Blocked by: #1, #2`. Later triage runs re-check those blocker issues. When all
blockers are closed, Patchmill removes the blocked label, adds the ready label,
and posts a new unblock comment.

`cleanupHook` is an optional repository-relative shell script path. Patchmill
runs it with `bash` from the issue worktree root after a successful run. The
script is responsible for its own safety checks and any repository-specific
process shutdown.

## Skills

The workflow skill keys `triage`, `planning`, `implementation`, and
`visualEvidence` are configured by default. For new repositories,
`patchmill init` defaults them to project-local skill paths or bundled Patchmill
skills. The remaining keys are optional workflow hooks. In an interactive
terminal, init asks whether to add generated config and skills to git, add
Patchmill files to `.gitignore`, or add Patchmill files to `.git/info/exclude`.
Non-interactive and `--yes` runs keep the files local by adding
`patchmill.config.json` and `.patchmill/` to `.git/info/exclude`.

`developmentEnvironment` is optional. When configured, `patchmill run-once` runs
that skill from the issue worktree after the plan is available and before the
implementation skill starts. The skill should prepare and verify local runtime
prerequisites, then return either `ready` or `not-ready`. When the key is
omitted, implementation starts exactly as it did before this feature.

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

Spec and plan discovery is not a configurable skill stage. To make `run-once`
use developer-authored workflow artifacts from an issue, publish the local files
with `patchmill set-spec` and `patchmill set-plan`. Those commands create
Patchmill-owned issue comments with machine-readable metadata and checksums; see
[workflow artifacts](workflow-artifacts.md) for details.

A repository can opt into development-environment setup without changing the
main workflow skill keys:

```json
{
  "skills": {
    "developmentEnvironment": ".patchmill/skills/bootstrapping-tilt-worktrees",
    "implementation": ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews"
  }
}
```

Path-like skill references resolve relative to the config file directory. When
choosing **Add to git**, init stages `patchmill.config.json`,
`.patchmill/skills`, and `.gitignore`; `.gitignore` keeps `.patchmill/pi-agent`,
`.patchmill/runs`, and `.patchmill/triage-runs` local because they contain
machine-specific auth, session, and run output.

### Subagents

Patchmill bundles `pi-subagents`; initialized repositories set
`skills.implementation` to `.patchmill/skills/subagent-driven-development`. The
recommended skill pack also installs two opt-in implementation skills for final
Codex plus thermo-nuclear full-worktree Pi reviewer loops:

- `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews` keeps the
  task-by-task worker/reviewer handoff pattern.
- `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews` uses one
  worker subagent for the whole approved plan before final reviews.

Customize subagent roles and runtime settings through pi-subagents configuration
rather than `patchmill.config.json`:

- `.pi/agents/**/*.md`
- `.pi/settings.json`

Workflow and optional skill keys let a repository add procedure at specific
workflow stages:

- `developmentEnvironment`: local runtime setup and development-environment
  verification before implementation starts.
- `toolchain`: setup and validation conventions.
- `review`: explicit review passes.
- `visualEvidence`: screenshot capture instructions for visible UI changes.
  Patchmill configures `.patchmill/skills/patchmill-visual-evidence` by default,
  expects final `pr-created` JSON to include `visualEvidence` entries, and
  validates that referenced screenshots are committed reference files before
  cleanup.
- `landing`: direct-land versus PR decision rules.

`projectPolicy.visualEvidence` is not the skill. It supplies allowed reference
screenshot paths and an example `visualEvidence` entry for prompts. By default,
reference screenshots live under `docs/screenshots/`.

See [skills configuration](skills.md) for how these are rendered into prompts.

## Environment-only settings

Some settings are intentionally better as environment variables:

- `PATCHMILL_HOST_LOGIN`: local host login for providers with named-login
  support, such as `forgejo-tea`.
