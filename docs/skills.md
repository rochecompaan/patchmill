# Skills configuration

Patchmill keeps orchestration safety in code and lets repositories choose the Pi skills used at each workflow stage.

## Core contracts kept in Patchmill

- untrusted issue-content boundaries
- host mutation only after Patchmill validates model output
- clean-worktree checks
- run-state checkpoints
- strict final JSON statuses
- host-side label, comment, PR evidence, and cleanup side effects

## Direct skills settings

Use the top-level `skills` key:

```json
{
  "skills": {
    "triage": "patchmill-issue-triage",
    "planning": "superpowers:writing-plans",
    "implementation": "superpowers:subagent-driven-development",
    "visualEvidence": "capturing-proof-screenshots"
  }
}
```

Each stage accepts one skill name. If a workflow needs several skills or detailed instructions, create a project skill that references those skills and configure that project skill here.

The old prompt-fragment settings are removed instead of kept for compatibility. Move toolchain, host workflow, landing judgment, visual-evidence procedure, todo workflow, and subagent workflow instructions into skills.

Supported keys:

- `triage`: skill used to classify issues for automation readiness.
- `planning`: skill used to write implementation plans.
- `implementation`: skill used to execute implementation plans.
- `toolchain`: optional skill used before setup or validation commands.
- `review`: optional skill used for explicit review passes.
- `visualEvidence`: optional skill used when visible UI changes.
- `landing`: optional skill used for direct-land versus PR decisions.

## Triage

Triage uses `skills.triage` and still receives a strict Patchmill prompt with allowed labels, issue data, and the required JSON response shape. Patchmill runs triage with read-only tools (`read`, `grep`, `find`, `ls`) so Pi can load skills without write/edit/bash access.
