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

If the smoke test fails, complete Pi setup with `pi` and `/login`, then run
`patchmill doctor`.

By default, init writes host fields and project-local skill mappings for
required stages (`triage`, `planning`, and `implementation`); Patchmill fills
omitted labels, paths, and git policy from defaults. The command output reminds
you that you can later change the login in `patchmill.config.json`
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
    "visualEvidence": "capturing-proof-screenshots",
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
      "referenceScreenshotPaths": ["docs/screenshots/baseline.png"],
      "prEvidenceExample": {
        "screenshotPath": ".tmp/issue-42-after.png",
        "caption": "Visible UI state after the change"
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
first `github-gh` version uses the active `gh` authentication context and does
not support GitHub visual-evidence upload.

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

When specification approval is required, automatic `run-once` selection ignores
ready issues that do not have `workflow.specApproval.approvedLabel`. Explicit
`patchmill run-once --issue <number>` fails with an `approval-required` result
for the requested issue instead of silently choosing another issue.

When plan approval is required, Patchmill creates or finds the issue plan,
comments that the plan is ready, applies `workflow.planApproval.reviewLabel`,
restores the ready label, removes `in-progress`, records the run as finished,
and stops. After a human applies `workflow.planApproval.approvedLabel`, a later
`run-once` reuses the existing plan and proceeds to implementation. During the
claim step, Patchmill removes the active plan-review label when the approved
label is present.

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

The required skill keys are `triage`, `planning`, and `implementation`. For new
repositories, `patchmill init` defaults them to local-only skill paths and adds
`.patchmill` plus `patchmill.config.json` to `.git/info/exclude`:

```json
{
  "skills": {
    "triage": ".patchmill/skills/patchmill-issue-triage",
    "planning": ".patchmill/skills/writing-plans",
    "implementation": ".patchmill/skills/subagent-driven-development"
  }
}
```

Path-like skill references resolve relative to the config file directory. For
consistent Patchmill runs across local machines and CI, consider committing
`patchmill.config.json` and `.patchmill/skills/` explicitly.

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

Optional skill keys let a repository add procedure at specific workflow stages:

- `toolchain`: setup and validation conventions.
- `review`: explicit review passes.
- `visualEvidence`: screenshots or other UI proof.
- `landing`: direct-land versus PR decision rules.

See [skills configuration](skills.md) for how these are rendered into prompts.

## Environment-only settings

Some settings are intentionally better as environment variables:

- `PATCHMILL_HOST_LOGIN`: local host login for providers with named-login
  support, such as `forgejo-tea`.
- `PATCHMILL_FORGEJO_URL`, `PATCHMILL_FORGEJO_TOKEN`, `PATCHMILL_FORGEJO_REPO`:
  Forgejo visual-evidence upload credentials and repository override. GitHub
  visual-evidence upload is not supported in the first `github-gh` version.
