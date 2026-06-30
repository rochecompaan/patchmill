# Skills configuration

Patchmill keeps orchestration safety in code and lets repositories choose the Pi
skills used at each workflow stage.

A few terms appear throughout this page:

- **Skills** are reusable workflow instructions that encode how a repository or
  team wants a stage handled.
- **Subagents** are delegated agent roles, such as workers, reviewers, scouts,
  or planners, used during implementation and review.

## Core contracts kept in Patchmill

- untrusted issue-content boundaries
- clean-worktree checks
- run-state checkpoints
- run-once final-status validation before Patchmill applies host-side status
  updates
- run-once strict final JSON statuses
- run-once host-side label, comment, PR evidence, and cleanup side effects

## Direct skills settings

Use the top-level `skills` key with a supported reference form (examples):

```json
{
  "skills": {
    "triage": "patchmill-issue-triage",
    "planning": ".patchmill/skills/writing-plans",
    "developmentEnvironment": ".patchmill/skills/development-environment",
    "implementation": ".patchmill/skills/subagent-driven-development",
    "visualEvidence": "capturing-proof-screenshots"
  }
}
```

`patchmill init` writes `.patchmill/skills/...` references by default and adds
`.patchmill` plus `patchmill.config.json` to `.git/info/exclude`.
Namespace-style references like `superpowers:writing-plans` are supported custom
examples.

Each stage accepts one skill reference (name, namespace-style, or path-like
local skill directory/file). If a workflow needs several skills or detailed
instructions, create a project skill that references those skills and configure
that project skill here.

The old prompt-fragment settings are removed instead of kept for compatibility.
Move toolchain, host workflow, landing judgment, visual-evidence procedure, and
subagent workflow instructions into skills. For todos, only the removed freeform
`todoWorkflowInstruction` procedure moves into planning or implementation
skills; task naming, tagging, body requirements, and done-status behavior stay
in `projectPolicy.pi.taskContract`.

Subagent execution runs through bundled `pi-subagents`. Patchmill controls the
production workflow around those delegated roles, while pi-subagents builtin
agents, user overrides, and project agent files control role behavior such as
models, tools, and context.

Supported keys:

- `triage`: skill used to classify issues for automation readiness.
- `planning`: skill used to write implementation plans.
- `implementation`: skill used to execute implementation plans.
- `developmentEnvironment`: optional skill used after worktree preparation and
  before implementation to prepare, minimally repair, and verify local runtime
  prerequisites. A `not-ready` result stops the run locally without posting
  issue `needs-info` questions.
- `toolchain`: optional skill used before setup or validation commands.
- `review`: optional skill used for explicit review passes.
- `visualEvidence`: optional skill used when visible UI changes.
- `landing`: optional skill used for direct-land versus PR decisions. It is
  required for direct squash-land eligibility; without it, Patchmill uses PR
  fallback even when direct land is enabled.

## Development environment

Use `skills.developmentEnvironment` when a repository needs mutable local
services before implementation can safely start. Examples include
Kubernetes/Tilt, Docker Compose, seeded databases, browser automation
infrastructure, or a per-worktree development namespace.

The development-environment skill owns project-specific setup and repair logic.
It may make and commit minimal code or configuration changes required to get the
local development environment ready, but it must not implement planned feature
scope, refactor broadly, land code, push branches, or open pull requests.
Patchmill only enforces the stage boundary: if the skill returns `ready`,
Patchmill passes its summary and evidence into the implementation prompt as
untrusted JSON handoff data; if it returns `not-ready`, Patchmill stops before
implementation and prints operator-facing remediation for external tooling,
infrastructure, credential, or operator problems.

## Project-local default skills

`patchmill init` installs Patchmill's recommended skill pack into
`.patchmill/skills/` by default (mode `project`). If you choose another
`--skills` mode, the default pack is not installed.

The project-local implementation skill configured by default is
`.patchmill/skills/subagent-driven-development`. The recommended skill pack also
installs two opt-in alternatives that add final full-worktree review loops using
Pi `reviewer` subagents:

- `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews` composes the
  Superpowers subagent-driven-development workflow, including fresh worker and
  task-level review handoffs for each plan task.
- `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews` uses one
  worker subagent to implement the whole approved plan before the same final
  review loops.

Both alternatives run
[Armin Ronacher's Codex review prompt adaptation](https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/review.ts#L389)
first, then the Cursor Team Kit
[thermo-nuclear code quality review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md)
rubric.

Project-local skills are local-only by default. For consistent Patchmill runs
across local machines and CI, consider committing `patchmill.config.json` and
`.patchmill/skills/` explicitly.

### Updating project-local skills

When Patchmill publishes a newer bundled skill pack, update a repository with
the latest CLI:

```sh
npx patchmill@latest skills update
```

The command only updates Patchmill-managed project-local skills under
`.patchmill/skills/`. It refuses to run if managed skill files were edited or
removed locally. Review the resulting `git diff`, then commit the skill changes
with the repository.

Patchmill treats installed files as project-owned. It will not silently
overwrite edited skill files and will preserve local edits.

`patchmill doctor` checks the skill paths configured in `patchmill.config.json`.
Path-like skill references are resolved relative to the config file directory,
and doctor fails when required configured skill paths are missing or malformed.

## Triage

`patchmill triage` is a harness around `skills.triage`. The configured skill is
responsible for triage judgment and workflow: labels, comments, maintainer
handoff, issue closing, and any repository-owned triage knowledge base.

Patchmill executes the configured triage skill by default. Use `--dry-run` to
ask Patchmill to wrap the skill in a read-only preview prompt that extracts the
classification logic and reports proposed labels, comments, closures, canonical
bucket, and rationale without mutating the issue host.

Patchmill still owns the automation intake contract used by
`patchmill run-once`: an issue is eligible when it is open, has no
protection/exclusion label, and carries an actionable workflow label:
`agent-ready`, `spec-approved`, or `plan-approved` by default.
