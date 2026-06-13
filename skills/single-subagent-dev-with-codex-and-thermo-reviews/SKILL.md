---
name: single-subagent-dev-with-codex-and-thermo-reviews
description:
  Use when executing Patchmill implementation plans that require one plan
  implementation subagent and final full-worktree readiness review before
  landing
---

# Patchmill Single Subagent Dev with Codex and Thermo Reviews

Execute the entire approved implementation plan with one Pi `worker` subagent,
then close the work with the same two mandatory full-worktree review loops used
by Patchmill's stricter final-readiness skill: Codex first, thermo-nuclear
second.

**Core principle:** one implementation subagent preserves plan-level continuity;
final full-worktree reviews catch integration, regression, and structural issues
before Patchmill lands or opens a PR.

## Required sub-skills and agents

- **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`
  before claiming success.
- Use Pi `subagent` with `worker` for the single initial implementation pass.
- Use Pi `subagent` with the canonical `reviewer` agent for both final review
  passes.
- Use Pi `subagent` with `worker` to fix accepted final-review findings.
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

### 7. Complete Patchmill handoff

After both final review loops are closed:

1. Run final verification commands.
2. Summarize implementation commits, validation, Codex review result,
   thermo-nuclear review result, and any deferred findings.
3. Continue with the configured landing skill or Patchmill PR/direct-land
   instructions.

## Supporting files

- `prompts/implement-plan.md` — worker contract owned by this skill for
  implementing all plan tasks in one initial subagent pass.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md` —
  shared final reviewer subagent contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`
  — shared worker fix subagent contract.
- `../subagent-dev-with-codex-and-thermo-reviews/rubrics/armin-codex-review-prompt.md`
  — shared Armin Ronacher adaptation of the Codex review prompt.
- `../subagent-dev-with-codex-and-thermo-reviews/rubrics/cursor-thermo-nuclear-code-quality-review.md`
  — shared Cursor Team Kit thermo-nuclear code quality review rubric.

## Rationalization checks

| Temptation                                                          | Reality                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| "This plan has many tasks, so I should use fresh workers per task." | Not in this skill. Use one initial worker for all plan tasks.          |
| "Final reviews can replace validation."                             | No. Validate before final reviews, then review the validated worktree. |
| "Codex and thermo are both code reviews, so one pass is enough."    | No. They are separate rubrics and separate loops.                      |
| "A reviewer can fix a small issue while reviewing."                 | No. Final reviewers are review-only. Use worker fix passes.            |
| "Thermo feedback permits broad cleanup."                            | No. Escalate unapproved scope or architecture changes first.           |

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

Fix passes should use the normal implementation worker:

```typescript
subagent({
  agent: "worker",
  task: "Use ../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md for the accepted review findings below...",
});
```
