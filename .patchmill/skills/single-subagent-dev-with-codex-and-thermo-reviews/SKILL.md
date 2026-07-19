---
name: single-subagent-dev-with-codex-and-thermo-reviews
description:
  Use when executing Patchmill implementation plans that require one plan
  implementation subagent and final full-worktree readiness review before
  landing
---

# Patchmill Single Subagent Dev with Codex and Thermo Reviews

Execute the entire approved implementation plan with one Pi `worker` subagent,
then close the work with Codex, thermo-nuclear, and final validation-readiness
review before landing.

**Core principle:** one implementation subagent preserves plan-level continuity;
final full-worktree reviews and validation readiness catch integration,
regression, structural, and known command failures before Patchmill lands or
opens a PR.

## Required sub-skills and agents

- **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`
  before claiming success.
- Use Pi `subagent` with `worker` for the single initial implementation pass.
- Use Pi `subagent` with the canonical `reviewer` agent for both final code
  review passes and the final validation-readiness review.
- Use Pi `subagent` with `worker` to fix accepted final-review findings, final
  validation findings, and code-related failed PR checks.
- Requires the sibling `../subagent-dev-with-codex-and-thermo-reviews/` skill
  directory for shared final-review prompts and rubrics. If those files are
  missing, stop and ask instead of recreating or substituting them.
- Do **not** use the sibling Superpowers `subagent-driven-development` workflow
  for plan execution in this skill; that workflow intentionally uses fresh
  workers and task-level reviewers per task.
- Do **not** use legacy `code-reviewer`; in Pi, it is a disabled compatibility
  shim.

Before launching any subagent, list available agents with
`subagent({ action: "list" })` and confirm `worker` and `reviewer` are
executable.

## When to choose this skill

Choose this optional implementation skill when the repository wants:

- one implementation worker to keep context across every task in a plan;
- final full-worktree Codex and thermo-nuclear review gates before landing;
- fewer task-level handoffs than the stricter task-by-task optional skill.

Choose `subagent-dev-with-codex-and-thermo-reviews` instead when the repository
wants a fresh worker and two task-level reviews for every task before final
reviews.

## Process

### 1. Execute the entire plan with one worker

Dispatch exactly one initial implementation `worker` subagent using
`prompts/implement-plan.md`.

The worker prompt must include:

1. the approved plan/spec paths;
2. Patchmill issue or prompt context;
3. worktree path and base SHA;
4. acceptance criteria and non-goals;
5. validation required by the plan;
6. the requirement to implement all approved tasks in sequence;
7. the requirement to ask before unapproved product, API, architecture,
   migration, landing-policy, or scope changes.

This initial worker is responsible for all plan tasks. Do not split plan tasks
across fresh implementer subagents and do not run task-level spec/code-quality
reviewers between tasks.

If the worker returns `BLOCKED` or `NEEDS_CONTEXT`, resolve the blocker with the
human or approved project context before continuing. Do not guess.

### 2. Capture final implementation scope

After the single worker reports completion:

1. Record the implementation base SHA from the Patchmill prompt, plan context,
   or branch point against the target branch.
2. Record current `HEAD`.
3. Run `git status --short`.
4. Run focused validation required by the plan.
5. Include committed changes, uncommitted changes, and untracked implementation
   files in final review scope.

Refresh this scope snapshot before every final review dispatch and every
re-review dispatch. If a worker fix pass commits or edits files, update current
`HEAD`, `git status --short`, and validation summary before asking the reviewer
to inspect the next version.

If validation fails, fix validation failures before requesting final reviews.

### 3. Run final review pass 1: Codex review

Dispatch a fresh-context, review-only `reviewer` subagent using the sibling
`../subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md` prompt
and Armin Ronacher's Codex review prompt adaptation.

Use:

- `../subagent-dev-with-codex-and-thermo-reviews/rubrics/armin-codex-review-prompt.md`
- Review name: `Final Codex full-worktree review`
- Scope: the entire final worktree and full implementation diff

The reviewer must not edit files. It must inspect the code directly, cite
file/line evidence, and return a clear verdict.

### 4. Fix Codex-review findings

If the Codex reviewer reports Critical or Important findings, or any Minor
finding that should be fixed before landing:

1. Synthesize accepted findings.
2. Dispatch `worker` using the sibling
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`.
3. Instruct the worker to apply only accepted fixes, preserve approved scope,
   and validate.
4. Re-run the Codex final review until it passes or only explicitly deferred
   findings remain.

Ask the human before applying any review item that changes product scope,
architecture beyond the approved plan, public API, migration strategy, or
landing policy.

### 5. Run final review pass 2: Cursor thermo-nuclear rubric

Only start this after the Codex final review loop is closed.

Dispatch a fresh-context, review-only `reviewer` subagent using the sibling
`../subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md` prompt.

Use:

- `../subagent-dev-with-codex-and-thermo-reviews/rubrics/cursor-thermo-nuclear-code-quality-review.md`
- Review name: `Final thermo-nuclear full-worktree review`
- Scope: the entire final worktree after Codex-review fixes

The reviewer must focus on structural maintainability, abstraction quality,
codebase health, and code-judo simplifications without changing behavior.

### 6. Fix thermo-nuclear findings

If the thermo-nuclear reviewer reports actionable findings worth doing before
landing:

1. Synthesize accepted findings.
2. Dispatch `worker` using the sibling
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`.
3. Validate after fixes.
4. Re-run the thermo-nuclear final review until it passes or only explicitly
   deferred findings remain.

Do not use the thermo-nuclear pass as permission for broad unapproved rewrites.
Escalate scope or architecture changes to the human first.

### 7. Run final validation-readiness review

Only start this after the Codex and thermo-nuclear review loops are closed.
Refresh base SHA, current HEAD, `git status --short`, plan/spec paths, required
validation commands, and prior validation evidence.

Dispatch a fresh-context, review-only `reviewer` using
`../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`.
The reviewer must run every feasible required final command and treat any
repository-fixable non-zero result as an Important or Critical finding. Every
base-to-head file is in scope, including materialized plan/spec files and files
created by earlier workflow commits.

Prior passing summaries are evidence only. They do not permit the reviewer to
skip commands. Landing is blocked until the reviewer returns `pass` or
`pass-with-deferred-minor-findings`.

### 8. Fix final validation findings

When the validation-readiness reviewer reports repository-fixable findings:

1. Synthesize the accepted validation findings with exact commands, concise
   output, and affected paths.
2. Dispatch `worker` using the sibling
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`
   contract.
3. Require focused fixes, appropriate validation, and a Conventional Commit.
4. Refresh HEAD, worktree status, and validation evidence.
5. Re-run the final validation-readiness review.

If validation is blocked by external tooling, infrastructure, credentials, or
operator action, return the existing blocked contract with evidence. Never
classify a branch-added failing file as out of scope merely because the
implementation worker did not edit it.

### 9. Complete landing and verify PR checks

After all three final review gates are closed:

1. Summarize implementation commits, passing validation, Codex review, thermo
   review, final validation-readiness review, and deferred findings.
2. Continue with the configured landing skill or Patchmill PR/direct-land
   instructions.
3. For direct landing, return `merged` only after the final validation-readiness
   review passed.
4. For PR fallback, create or update the pull request, then obtain its URL and
   current head SHA before returning final JSON.
5. Wait for all observable required PR checks using configured host tooling.
6. If all required checks pass, return the normal `pr-created` final JSON with
   only current passing validation evidence.
7. If test, lint, formatting, type-check, or build checks fail, collect failed
   check names, URLs, and failed-step logs. Dispatch `worker` using
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`,
   then wait for replacement checks after its push.
8. Allow at most two PR-check repair passes. If code-related checks still fail,
   return the existing blocked contract with the remaining failures and links.
9. Treat cancelled, timed-out, infrastructure, permissions, quota, billing, or
   host-service failures as operator blockers. Do not dispatch a code-repair
   worker for them.

For GitHub, use `gh pr checks` and `gh run view --log-failed` or equivalent
supported commands. For Forgejo/Gitea, use the configured `tea` or API tooling.
If required checks cannot be observed, report that limitation rather than
claiming the PR is ready.

## Supporting files

- `prompts/implement-plan.md` — worker contract owned by this skill for
  implementing all plan tasks in one initial subagent pass.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md` —
  shared final reviewer subagent contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`
  — shared worker fix subagent contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
  — shared final validation-readiness reviewer contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md` —
  shared worker contract for code-related failed PR checks.
- `../subagent-dev-with-codex-and-thermo-reviews/rubrics/armin-codex-review-prompt.md`
  — shared Armin Ronacher adaptation of the Codex review prompt.
- `../subagent-dev-with-codex-and-thermo-reviews/rubrics/cursor-thermo-nuclear-code-quality-review.md`
  — shared Cursor Team Kit thermo-nuclear code quality review rubric.

## Rationalization checks

| Temptation                                                          | Reality                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "This plan has many tasks, so I should use fresh workers per task." | Not in this skill. Use one initial worker for all plan tasks.                                                                    |
| "Final reviews can replace validation."                             | No. Validate before final reviews, then review the validated worktree.                                                           |
| "Codex and thermo are both code reviews, so one pass is enough."    | No. They are separate rubrics and separate loops.                                                                                |
| "A reviewer can fix a small issue while reviewing."                 | No. Final reviewers are review-only. Use worker fix passes.                                                                      |
| "Thermo feedback permits broad cleanup."                            | No. Escalate unapproved scope or architecture changes first.                                                                     |
| "The failing file was not edited by the implementation worker."     | Base-to-head scope includes every workflow commit and materialized artifact. Fix the required validation failure before landing. |
| "The PR exists, so handoff is complete."                            | PR fallback is complete only after observable required checks pass or an operator blocker is reported.                           |
| "Retry CI until it eventually passes."                              | Run no more than two code-repair passes; classify external failures instead of looping.                                          |

## Red flags

Never:

- Dispatch a fresh worker per plan task while using this skill.
- Run task-level spec/code-quality reviewer loops between plan tasks.
- Run the thermo-nuclear review before the Codex review loop is closed.
- Let a reviewer edit files during review-only passes.
- Treat one review pass as satisfying both rubrics.
- Review only the last task; final reviews cover the full final worktree.
- Skip re-review after accepted fixes.
- Ignore uncommitted or untracked implementation changes.
- Proceed to landing with unresolved Critical or Important findings.
- Proceed to landing after a required validation command exits non-zero.
- Dismiss branch-added plan/spec or workflow artifacts as unchanged.
- Return `pr-created` before observable required checks finish.
- Dispatch code workers for infrastructure or operator failures.
- Run more than two PR-check repair passes.

## Dispatch shape reference

Initial implementation should use the normal implementation worker:

```typescript
subagent({
  agent: "worker",
  task: "Use prompts/implement-plan.md to implement every approved task in the plan below...",
});
```

Review passes should use fresh context:

```typescript
subagent({
  agent: "reviewer",
  context: "fresh",
  task: "Use ../subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md with the selected rubric file and final scope below...",
  output: false,
});
```

Final validation uses fresh reviewer context:

```typescript
subagent({
  agent: "reviewer",
  context: "fresh",
  task: "Use ../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md with the final scope and required commands below...",
  output: false,
});
```

Fix passes should use the normal implementation worker:

```typescript
subagent({
  agent: "worker",
  task: "Use ../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md for accepted review or validation findings below...",
});
```

PR-check repair uses the normal worker context:

```typescript
subagent({
  agent: "worker",
  task: "Use ../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md for failed check evidence below...",
});
```
