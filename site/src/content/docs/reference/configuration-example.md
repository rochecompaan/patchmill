---
title: Configuration example
description: Copy focused pieces from a broad Patchmill configuration example.
---

This example shows the main `patchmill.config.json` surface in one place. Copy
only the pieces your repository needs; Patchmill fills omitted labels, paths,
skills, and git policy from defaults.

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
    "toolchain": ".patchmill/skills/project-toolchain",
    "review": ".patchmill/skills/project-review",
    "visualEvidence": ".patchmill/skills/patchmill-visual-evidence",
    "landing": ".patchmill/skills/project-landing"
  },
  "paths": {
    "specsDir": "docs/specs",
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
    }
  }
}
```

## Notes

- Use `github-gh` with an empty `host.login` when the repository uses the active
  GitHub `gh` authentication context.
- Path-like skill values must resolve to a `SKILL.md` file. For example,
  `.patchmill/skills/project-review` resolves to
  `.patchmill/skills/project-review/SKILL.md`.
- `projectPolicy.pi.taskContract` exists for advanced workflow coordination, but
  most repositories should keep the default task contract.
- Run `patchmill doctor` after configuration changes.
