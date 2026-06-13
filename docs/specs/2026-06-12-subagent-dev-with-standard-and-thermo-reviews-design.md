# Subagent Dev with Standard and Thermo Reviews Skill Design

## Goal

Add an optional project-local composite implementation skill that Patchmill
users can configure when they want the existing Superpowers
subagent-driven-development flow plus two final full-worktree review loops
before landing or PR handoff.

## Current behavior

`patchmill init` installs the recommended project-local skill pack and currently
maps implementation to `.patchmill/skills/subagent-driven-development`.

The Superpowers implementation skill reviews each task during plan execution,
then only calls for a single final code reviewer. It does not require both Pi
review profiles over the entire final worktree.

## New behavior

Patchmill's project-local recommended skill pack installs a new
`subagent-dev-with-standard-and-thermo-reviews` skill alongside the existing
`subagent-driven-development` skill. Newly initialized repositories still map
`skills.implementation` to `.patchmill/skills/subagent-driven-development` by
default.

Repositories that want the stricter final review workflow can opt in by setting
`skills.implementation` to
`.patchmill/skills/subagent-dev-with-standard-and-thermo-reviews`.

The new skill is a composite implementation skill. It instructs Pi to:

1. Use the existing Superpowers subagent-driven-development pattern for
   task-by-task plan execution.
2. Capture the final implementation scope after all tasks and validation are
   complete.
3. Run a fresh-context Pi `reviewer` subagent over the full final worktree using
   Armin Ronacher's adaptation of the Codex review prompt.
4. Dispatch a `worker` subagent to fix accepted findings, validate, and re-run
   the standard review until clear.
5. Run a fresh-context Pi `reviewer` subagent over the full final worktree using
   the Cursor thermo-nuclear code quality review rubric.
6. Dispatch a `worker` subagent to fix accepted findings, validate, and re-run
   the thermo-nuclear review until clear.
7. Proceed to the configured landing/PR completion workflow only after both
   review loops are closed or explicitly deferred with rationale.

Project-local defaults continue to use
`.patchmill/skills/subagent-driven-development`.

## Files and responsibilities

- `skills/subagent-dev-with-standard-and-thermo-reviews/SKILL.md`: the
  project-owned composite workflow skill.
- `skills/subagent-dev-with-standard-and-thermo-reviews/rubrics/armin-codex-review-prompt.md`:
  Armin Ronacher adaptation of the Codex review prompt supporting file.
- `skills/subagent-dev-with-standard-and-thermo-reviews/rubrics/cursor-thermo-nuclear-code-quality-review.md`:
  Cursor thermo-nuclear code quality review rubric supporting file.
- `skills/subagent-dev-with-standard-and-thermo-reviews/prompts/final-review.md`:
  reusable reviewer prompt contract for final full-worktree review passes.
- `skills/subagent-dev-with-standard-and-thermo-reviews/prompts/fix-review-findings.md`:
  reusable worker prompt contract for fixing accepted review findings.
- `src/workflow/skill-pack.ts`: add the Patchmill skill to the recommended pack
  while keeping the project-local implementation stage mapped to
  `subagent-driven-development`.
- `src/workflow/skill-pack.test.ts`: prove the recommended project-local config
  keeps the existing default and the skill pack includes the new optional skill.
- `src/cli/commands/init/skill-installer.test.ts`: prove installation copies the
  new Patchmill skill and metadata while returning the existing default
  implementation path.
- Docs: update skill configuration and workflow docs to explain that the new
  skill is an opt-in alternative that composes Superpowers and the two final
  review loops.

## Review rubric source

The supporting rubric files keep separate provenance:

- Standard: Armin Ronacher's adaptation of the Codex review prompt.
- Thermo-nuclear: from Cursor Team Kit's
  [thermo-nuclear code quality review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md).

They remain separate files. The skill must not compose one rubric from the
other, summarize them, or load dynamic `/review` behavior at runtime.

## Non-goals

- Do not change `skills.review` semantics; it remains an optional explicit
  review-stage skill outside the implementation skill.
- Do not change the runtime prompt line renderer.
- Do not add new Pi subagent types or depend on the disabled legacy
  `code-reviewer` agent.
- Do not execute the actual final review loops inside Patchmill code; the
  configured implementation skill directs Pi to do so.

## Testing

Use TDD for code behavior changes:

- First update tests that assert the recommended project-local implementation
  mapping stays on `subagent-driven-development` while the skill pack includes
  the new optional skill.
- Verify those tests fail against the current code.
- Implement the minimal code and skill files to pass.
- Run targeted workflow/init tests and then the full test suite.

Skill content is process documentation. The automated tests should prove
packaging and default selection behavior rather than static prose. The skill
itself should be reviewed by final code review instead of over-testing every
sentence.
