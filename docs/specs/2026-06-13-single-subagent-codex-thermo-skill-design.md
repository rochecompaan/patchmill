# Single Subagent Dev with Codex and Thermo Reviews Skill Design

## Goal

Add a second optional Patchmill implementation skill for repositories that want
a single implementation subagent to execute an entire approved plan, followed by
the existing final full-worktree Codex and thermo-nuclear review loops.

## Current behavior

Patchmill already installs
`.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews` as an opt-in
implementation skill. That skill composes the Superpowers
`subagent-driven-development` workflow, so it uses a fresh implementer and
task-level spec/code-quality reviewers for every plan task before running final
full-worktree reviews.

That behavior is deliberately stricter and more granular than the new requested
workflow. A baseline pressure scenario against the existing skill confirmed it
would choose “fresh workers/reviewers per task” because the skill explicitly
says “Fresh implementer/worker per task” and “Do not replace task-level reviews
with the final reviews below.”

## New behavior

Patchmill installs another opt-in Patchmill-owned skill named
`single-subagent-dev-with-codex-and-thermo-reviews`.

Repositories can set `skills.implementation` to
`.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews` when they
want this flow:

1. List Pi subagents and confirm `worker` and `reviewer` are executable.
2. Dispatch exactly one Pi `worker` subagent to implement all approved plan
   tasks in sequence.
3. Require the worker to use TDD where appropriate, validate, summarize task
   status, and escalate unapproved scope/product/architecture decisions.
4. Capture final implementation scope: base SHA, current HEAD, worktree status,
   validation summary, committed changes, uncommitted changes, and untracked
   implementation files.
5. Run the final Codex full-worktree review loop using the same Codex rubric and
   final-review prompt contract as the existing optional skill.
6. Fix accepted Codex findings with a `worker` subagent and re-review until
   closed or explicitly deferred.
7. Run the final thermo-nuclear full-worktree review loop using the same thermo
   rubric and final-review prompt contract.
8. Fix accepted thermo findings with a `worker` subagent and re-review until
   closed or explicitly deferred.
9. Continue to landing/PR handoff only after both final loops close.

The default implementation skill remains
`.patchmill/skills/subagent-driven-development`.

## Files and responsibilities

- `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`: the new
  single-worker composite workflow.
- `skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md`:
  reusable worker prompt for implementing the entire plan.
- `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md`:
  shared sibling final reviewer contract reused by both optional final-readiness
  skills.
- `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`:
  shared sibling accepted-finding fix contract reused by both optional
  final-readiness skills.
- `skills/subagent-dev-with-codex-and-thermo-reviews/rubrics/*.md`: shared
  sibling final review rubrics reused by both optional final-readiness skills.
- `src/workflow/skill-pack.ts`: add the optional skill to the recommended pack
  while preserving default stage mapping.
- `src/workflow/skill-pack.test.ts`: prove pack metadata includes the optional
  skill and default config is unchanged.
- `src/cli/commands/init/*.test.ts`: prove init/install copies the optional
  skill.
- README/docs: document the opt-in variant and how it differs from the
  task-by-task variant.

## Non-goals

- Do not change Patchmill's default implementation skill.
- Do not remove or weaken the existing task-by-task optional skill.
- Do not add runtime code that executes review loops directly; the skill directs
  Pi agents to do it.
- Do not use the disabled legacy `code-reviewer` agent.

## Verification

Use TDD for pack/init behavior changes: update focused tests first, verify
failure, implement minimal code and files, then run targeted tests plus lint for
Markdown/TypeScript changes.
