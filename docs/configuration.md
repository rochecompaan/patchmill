# Patchmill Configuration

Patchmill reads `patchmill.config.json` from the repository root. You can keep
the file small: any omitted field falls back to Patchmill defaults, and
machine-local values can come from environment variables or CLI flags.

Precedence is:

1. CLI flags
2. `PATCHMILL_*` environment variables
3. `patchmill.config.json`
4. built-in defaults

## Complete example

This example shows the main configuration surface in one place. Copy only the
pieces your repository needs, and replace `my-agent-team` with a Pi agent-team
preset available on your machine.

```json
{
  "host": {
    "provider": "forgejo-tea",
    "login": "triage-agent"
  },
  "pi": {
    "team": "my-agent-team",
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
      "agent-unsuitable": "agent-unsuitable"
    }
  },
  "skills": {
    "triage": "patchmill-issue-triage",
    "planning": "superpowers:writing-plans",
    "implementation": "superpowers:subagent-driven-development",
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
      "wontfix": "agent-unsuitable"
    }
  }
}
```

`triage.stateMap` keys are repository label names. Values are limited to
`agent-ready`, `needs-info`, and `agent-unsuitable`, and the configured
`labels.ready` label must map to `agent-ready`.

`cleanupHook` is an optional repository-relative shell script path. Patchmill
runs it with `bash` from the issue worktree root after a successful run. The
script is responsible for its own safety checks and any repository-specific
process shutdown.

## Skills

The required skill keys are `triage`, `planning`, and `implementation`.
Patchmill defaults them to:

- `patchmill-issue-triage`
- `superpowers:writing-plans`
- `superpowers:subagent-driven-development`

Optional skill keys let a repository add procedure at specific workflow stages:

- `toolchain`: setup and validation conventions.
- `review`: explicit review passes.
- `visualEvidence`: screenshots or other UI proof.
- `landing`: direct-land versus PR decision rules.

See [skills configuration](skills.md) for how these are rendered into prompts.

## Environment-only settings

Some settings are intentionally better as environment variables:

- `PATCHMILL_HOST_LOGIN`: local host login for the `tea` CLI.
- `PATCHMILL_AGENT_TEAM`: local Pi agent-team preset.
- `PATCHMILL_FORGEJO_URL`, `PATCHMILL_FORGEJO_TOKEN`, `PATCHMILL_FORGEJO_REPO`:
  visual-evidence upload credentials and repository override.
