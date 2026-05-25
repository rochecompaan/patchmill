# Skills configuration

Patchmill keeps orchestration safety in code and lets repositories choose the Pi
skills used at each workflow stage.

## Core contracts kept in Patchmill

- untrusted issue-content boundaries
- clean-worktree checks
- run-state checkpoints
- run-once final-status validation before Patchmill applies host-side status
  updates
- run-once strict final JSON statuses
- run-once host-side label, comment, PR evidence, and cleanup side effects

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

Each stage accepts one skill name. If a workflow needs several skills or
detailed instructions, create a project skill that references those skills and
configure that project skill here.

The old prompt-fragment settings are removed instead of kept for compatibility.
Move toolchain, host workflow, landing judgment, visual-evidence procedure, and
subagent workflow instructions into skills. For todos, only the removed freeform
`todoWorkflowInstruction` procedure moves into planning or implementation
skills; task naming, tagging, body requirements, and done-status behavior stay
in `projectPolicy.pi.taskContract`.

Supported keys:

- `triage`: skill used to classify issues for automation readiness.
- `planning`: skill used to write implementation plans.
- `implementation`: skill used to execute implementation plans.
- `toolchain`: optional skill used before setup or validation commands.
- `review`: optional skill used for explicit review passes.
- `visualEvidence`: optional skill used when visible UI changes.
- `landing`: optional skill used for direct-land versus PR decisions. It is
  required for direct squash-land eligibility; without it, Patchmill uses PR
  fallback even when direct land is enabled.

## Triage

`patchmill triage` is a harness around `skills.triage`. The configured skill is
responsible for triage judgment and workflow: labels, comments, maintainer
handoff, issue closing, and any repository-owned triage knowledge base.

Patchmill executes the configured triage skill by default. Use `--dry-run` to
ask Patchmill to wrap the skill in a read-only preview prompt that extracts the
classification logic and reports proposed labels, comments, closures, canonical
bucket, and rationale without mutating the issue host.

Patchmill still owns the automation intake contract used by
`patchmill run-once`: an issue is eligible only when it is open, has the
configured ready label, and has none of the configured protection or non-ready
triage labels.
