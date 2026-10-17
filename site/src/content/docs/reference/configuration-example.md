---
title: Configuration example
description: The complete supported default configuration.
---

This is the complete default configuration. Omitted keys use these values.
Unknown keys fail by name. Copy only the values that your repository needs.

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

For Forgejo, set `host.provider` to `forgejo-tea`. Leave `host.login` empty to
use Tea's default profile, or set an explicit Tea profile alias. GitHub init can
seed the detected username for comment trust, not account selection.

`git.baseBranch: null` uses the remote default branch. The spec gate defaults to
on. The three skill paths each name a directory with `SKILL.md`. See
[Configuration](/getting-started/configuration/) for these boundaries.
