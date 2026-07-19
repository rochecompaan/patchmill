---
name: subagent-dev-with-validation-and-pr-checks
description:
  Use when executing Patchmill implementation plans with Superpowers task-level
  development plus final validation and pull-request readiness, without extra
  Codex or thermo-nuclear full-worktree reviews
---

# Patchmill Subagent Dev with Validation and PR Checks

Execute the implementation plan with Superpowers' subagent-driven-development
pattern, then require final validation readiness and observable passing PR
checks before Patchmill returns a successful handoff.

**Core principle:** preserve the normal task-level implementation and review
workflow while ensuring known local or CI failures are repaired before landing
is declared ready.

## Required sub-skills and agents

- **REQUIRED SUB-SKILL:** Use the installed sibling Superpowers
  subagent-driven-development skill for task-by-task plan execution. Read it
  from `../subagent-driven-development/SKILL.md` and read its prompt templates
  from `../subagent-driven-development/` before dispatching task-level
  subagents.
- **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`
  before claiming success.
- Use Pi `subagent` with the canonical `reviewer` agent for the final
  validation-readiness review.
- Use Pi `subagent` with `worker` to fix final validation findings and
  code-related failed PR checks.
- Use the shared final-readiness prompts from
  `../subagent-dev-with-codex-and-thermo-reviews/prompts/`.
- Do not run the Codex or thermo-nuclear full-worktree review passes from the
  sibling Patchmill wrapper. This skill intentionally adds validation and PR
  readiness only.
- Do **not** use legacy `code-reviewer`; in Pi, it is a disabled compatibility
  shim.

Before launching any subagent, list available agents with
`subagent({ action: "list" })` and confirm `reviewer` and `worker` are
executable.

## Non-interactive Patchmill orchestration

Patchmill runs this skill inside a one-turn, non-interactive `pi -p` invocation.
Preserve the configured worker and reviewer topology, including multiple
sequential or parallel runs, while keeping lifecycle ownership in the parent
agent.

- Track every foreground or background subagent run until it reaches a terminal
  state.
- Use `subagent({ action: "status" })` to inspect active runs, or include an
  `id` to inspect one run.
- Status is inspection, not waiting. Do not repeatedly poll status merely to
  pass time.
- The parent may continue genuinely independent work while background runs are
  active, but it must not advance past a checkpoint that depends on a subagent
  until that run completes and its result is consumed.
- When no independent work remains and a required result is outstanding, call
  `wait({ id })` or `wait({ all: true })` rather than ending the turn.
- Before final handoff, inspect active runs. Any queued, running, paused,
  needs-attention, or otherwise unresolved run prohibits the final response.
- Resolve, await, resume, or interrupt every outstanding run before
  finalization.
- A subagent result is an intermediate workflow checkpoint. Continue through
  every remaining task, review, fix, re-review, validation, PR-check, todo, and
  landing step required by this skill.
- Never return progress prose or promise to continue after the response. This
  non-interactive invocation has no subsequent turn.

## Process

### 1. Execute the implementation plan

Follow the installed sibling Superpowers subagent-driven-development workflow
for all implementation tasks:

1. Fresh implementer/worker per task as directed by that skill.
2. Task-level spec compliance review.
3. Task-level code quality review.
4. Fix and re-review until each task is complete.

Adapt any upstream `superpowers:code-reviewer` or `code-reviewer` wording to the
canonical Pi `reviewer`. Do not add the separate Codex or thermo-nuclear
full-worktree review loops used by the heavier Patchmill wrappers.

### 2. Capture final implementation scope

After all plan tasks and task-level reviews are complete:

1. Record the implementation base SHA and current `HEAD`.
2. Run `git status --short`.
3. Record the approved plan/spec paths.
4. Collect every final validation command required by the plan, repository
   instructions, and configured workflow.
5. Include committed, uncommitted, untracked, and materialized workflow files in
   base-to-head scope.

Refresh this scope after every fix pass.

### 3. Run final validation-readiness review

Dispatch a fresh-context, review-only `reviewer` using
`../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`.
Prior validation summaries are evidence only; the reviewer must run every
feasible required final command.

Every base-to-head file is in scope, including materialized plans/specs and
files created by earlier workflow commits. Landing is blocked until the reviewer
returns `pass` or `pass-with-deferred-minor-findings`.

### 4. Fix final validation findings

For repository-fixable findings:

1. Synthesize exact commands, concise output, and affected paths.
2. Dispatch `worker` using
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`.
3. Require focused fixes, validation, and a Conventional Commit.
4. Refresh final scope and re-run the validation-readiness reviewer.

For external tooling, infrastructure, credential, or operator blockers, return
the existing blocked contract with evidence. Never dismiss a branch-added file
as unchanged merely because another worker or workflow commit introduced it.

### 5. Complete landing and verify PR checks

After final validation passes:

1. Continue with the configured landing skill or Patchmill PR/direct-land
   instructions.
2. For direct landing, return `merged` only after final validation passed.
3. For PR fallback, create or update the PR, then capture its URL and current
   head SHA.
4. Wait for all observable required checks using configured host tooling.
5. Return `pr-created` only after all required checks pass.
6. For failed test, lint, formatting, type-check, or build checks, collect
   names, links, and failed-step logs; dispatch `worker` using
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`; and
   wait for replacement checks after its normal push.
7. Allow at most two PR-check repair passes.
8. Return an operator blocker for cancelled, timed-out, infrastructure,
   permissions, quota, billing, or host-service failures. Do not dispatch a code
   worker for them.

For GitHub, use `gh pr checks` and `gh run view --log-failed` or equivalent
supported commands. For Forgejo/Gitea, use the configured `tea` or API tooling.
If required checks cannot be observed, report that limitation rather than
claiming the PR is ready.

## Supporting files

- `../subagent-driven-development/SKILL.md` and its sibling templates — upstream
  task-level implementation and review workflow.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
  — shared final validation reviewer contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`
  — shared validation finding repair contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md` —
  shared failed PR-check repair contract.

## Rationalization checks

| Temptation                                        | Reality                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| "The upstream task reviews are enough."           | Task reviews do not prove the complete branch passes final repository commands. Run final validation.           |
| "Use the Codex/thermo wrapper for consistency."   | This wrapper intentionally adds only validation and PR readiness. Do not add the heavier full-worktree reviews. |
| "The failing file was not edited by this worker." | Base-to-head scope includes every workflow commit and materialized artifact.                                    |
| "The PR exists, so handoff is complete."          | PR fallback is complete only after observable required checks pass or an operator blocker is reported.          |
| "Retry CI until it eventually passes."            | Run no more than two code-repair passes and classify external failures.                                         |

## Red flags

Never:

- Skip or replace the upstream Superpowers task-level workflow.
- Add Codex or thermo-nuclear full-worktree reviews in this wrapper.
- Proceed to landing after a required validation command exits non-zero.
- Dismiss branch-added plan/spec or workflow artifacts as unchanged.
- Return `pr-created` before observable required checks finish.
- Dispatch code workers for infrastructure or operator failures.
- Run more than two PR-check repair passes.
- End the Patchmill turn while any subagent run remains unresolved.
- Use repeated status checks as a substitute for `wait` when no independent work
  remains.
- Return progress prose or promise to continue in a later turn.

## Dispatch shape reference

Final validation uses fresh reviewer context:

```typescript
subagent({
  agent: "reviewer",
  context: "fresh",
  task: "Use ../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md with the final scope and required commands below...",
  output: false,
});
```

Repair passes use the normal worker context:

```typescript
subagent({
  agent: "worker",
  task: "Use the appropriate shared fix-review-findings.md or fix-pr-checks.md prompt for the evidence below...",
});
```
