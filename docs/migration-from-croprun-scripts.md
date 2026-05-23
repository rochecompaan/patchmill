# Migrating from Croprun bootstrap scripts to Patchmill

Patchmill keeps the copied `agent-issue-*` entrypoints and several Croprun compatibility fallbacks so existing repositories can move gradually. This guide shows the preferred Patchmill surface and the remaining opt-in compatibility knobs.

## Command mapping

Use the Patchmill CLI for new automation entrypoints:

| Croprun-era command | Patchmill command |
| --- | --- |
| `node scripts/agent-issue-triage.ts --dry-run` | `node bin/patchmill.ts triage --dry-run` |
| `node scripts/agent-issue-triage.ts --execute` | `node bin/patchmill.ts triage --execute` |
| `node scripts/agent-issue-once.ts --dry-run` | `node bin/patchmill.ts run-once --dry-run` |
| `node scripts/agent-issue-once.ts --execute` | `node bin/patchmill.ts run-once --execute` |
| `--tea-login <name>` | `--host-login <name>` (`--tea-login` remains a compatibility alias) |

The copied script entrypoints are still available for compatibility, but new docs and config should target `patchmill` / `node bin/patchmill.ts`.

## Activate normalized Patchmill defaults

`node bin/patchmill.ts` currently dispatches to the copied `agent-issue-*` scripts. Those compatibility workflows only switch to normalized Patchmill defaults after `patchmill.config.json` loads.

Create `patchmill.config.json` in the repo root — even `{}` is enough — if you want `patchmill triage` / `patchmill run-once` to use normalized Patchmill defaults for paths, git/worktree settings, cleanup hooks, and prompt policy. Running the copied scripts directly, or running `patchmill` without that file, keeps the legacy Croprun fallbacks active.

## Environment variable mapping

Use `PATCHMILL_*` names as the primary configuration surface:

| Legacy name | Preferred Patchmill name | Notes |
| --- | --- | --- |
| `CROPRUN_TRIAGE_TEA_LOGIN` | `PATCHMILL_HOST_LOGIN` | Triage login fallback only. |
| `CROPRUN_AGENT_ISSUE_TEA_LOGIN` | `PATCHMILL_HOST_LOGIN` | Run-once login fallback only. |
| `CROPRUN_AGENT_ISSUE_AGENT_TEAM` | `PATCHMILL_AGENT_TEAM` | Agent-team selection fallback only. |
| `CROPRUN_AGENT_ISSUE_FORGEJO_URL` | `PATCHMILL_FORGEJO_URL` | Forgejo visual-evidence upload fallback. |
| `CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN` | `PATCHMILL_FORGEJO_TOKEN` | Forgejo visual-evidence upload fallback. |
| `CROPRUN_AGENT_ISSUE_FORGEJO_REPO` | `PATCHMILL_FORGEJO_REPO` | Optional owner/repo fallback. |

When both names are present, Patchmill prefers the `PATCHMILL_*` value.

## State path migration

Once `patchmill.config.json` is present, normalized Patchmill defaults write local state under `.patchmill/`:

- run-once logs: `.patchmill/runs/`
- triage logs: `.patchmill/triage-runs/`

Without that file, the copied compatibility entrypoints — including `patchmill` CLI dispatch to them — still fall back to the older Croprun paths:

- run-once logs: `.pi/agent-issue/runs/`
- triage logs: `.pi/agent-issue/triage-runs/`

Recommended migration steps:

1. Switch your entrypoints to `patchmill` / `node bin/patchmill.ts`.
2. Create `patchmill.config.json` in the repo root — even `{}` is enough — to activate normalized Patchmill defaults for the CLI-dispatched compatibility workflows.
3. Let new runs write to `.patchmill/` by default, or set explicit paths in `patchmill.config.json`.
4. Keep `.pi/todos/` unchanged unless your Pi workflow itself is moving; task todos remain the default contract.

Example explicit path config:

```json
{
  "paths": {
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs"
  }
}
```

## Enable the legacy Tilt cleanup hook

After `patchmill.config.json` activates normalized Patchmill defaults, `cleanupHooks` defaults to `[]`. If your repository still needs the Croprun-style Tilt cleanup behavior, add the old hook explicitly:

```json
{
  "cleanupHooks": [
    {
      "name": "tilt-just",
      "whenPathExists": ".env",
      "terminateProcessPatterns": ["tilt up", "just tilt-up"],
      "command": "just",
      "args": ["tilt-down"]
    }
  ]
}
```

That restores the legacy behavior of cleaning up matching Tilt processes and then running `just tilt-down` in the worktree.

## Preserve the Croprun prompt policy with config

After `patchmill.config.json` activates normalized Patchmill defaults, the generic Patchmill policy is neutral by default. If you want the `patchmill` CLI to keep the old Croprun prompt wording, validation guidance, visual-evidence expectations, and Pi workflow instructions, set `projectPolicy` in `patchmill.config.json` to match the compatibility policy from `src/policy/defaults.ts`.

At minimum, copy the Croprun-specific values for:

- `projectPolicy.projectName`
- `projectPolicy.toolchainInstruction`
- `projectPolicy.validation`
- `projectPolicy.directLand`
- `projectPolicy.visualEvidence`
- `projectPolicy.hostToolingInstruction`
- `projectPolicy.pi`
- `projectPolicy.planRequiresApproval`

Example skeleton:

```json
{
  "projectPolicy": {
    "projectName": "Croprun",
    "contextFileNames": ["AGENTS.md"],
    "toolchainInstruction": "Use the devenv-managed project toolchain. If the shell is not already active, enter it with `devenv shell` or prefix one-off commands with `devenv shell <command>`.",
    "validation": {
      "rules": [
        { "category": "Server-side changes", "commands": ["just test"] },
        { "category": "Playwright/browser flows", "commands": ["just playwright-test"] },
        { "category": "Mobile unit changes", "commands": ["just mobile-test"] },
        { "category": "Android instrumentation/device behavior", "commands": ["just mobile-instrumentation-test"] }
      ],
      "forbiddenSubstitutions": [
        "Do not run host `go test` as a substitute.",
        "Do not run host `playwright test` as a substitute.",
        "Do not use ad-hoc servers as a substitute.",
        "Do not run direct `kubectl exec` as a substitute."
      ]
    },
    "directLand": {
      "targetBranch": "main",
      "policyText": "Copy the exact Croprun compatibility direct-land policy text from src/policy/defaults.ts when byte-for-byte prompt compatibility matters."
    },
    "visualEvidence": {
      "policyText": "Copy the exact Croprun compatibility visual-evidence policy text from src/policy/defaults.ts when byte-for-byte prompt compatibility matters.",
      "webScreenshotSkill": "capturing-proof-screenshots",
      "mobileScreenshotSkill": "mobile-app-screenshots",
      "referenceScreenshotPaths": [
        "docs/reference-screenshots/web/",
        "docs/reference-screenshots/mobile/"
      ]
    },
    "hostToolingInstruction": "Use Forgejo `tea` for repository-hosting actions. Do not use `gh`.",
    "pi": {
      "todoWorkflowInstruction": "",
      "subagentWorkflowInstruction": "Copy the exact Croprun compatibility Pi workflow text from src/policy/defaults.ts when byte-for-byte prompt compatibility matters.",
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
    },
    "planRequiresApproval": false
  }
}
```

If you need exact compatibility, treat `src/policy/defaults.ts` as the canonical source for the full Croprun policy text and copy the complete strings from `CROPRUN_COMPAT_POLICY`.
