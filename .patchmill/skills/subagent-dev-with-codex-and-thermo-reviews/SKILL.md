---
name: subagent-dev-with-codex-and-thermo-reviews
description:
  Use when executing Patchmill implementation plans that require final
  full-worktree readiness review before landing
---

# Patchmill Subagent Dev with Codex and Thermo Reviews

Execute the implementation plan with Superpowers' subagent-driven-development
pattern, then close the work with two mandatory full-worktree Pi review loops:
Codex first, thermo-nuclear second.

**Core principle:** task-level reviews catch local issues; final full-worktree
reviews catch integration, regression, and structural issues before Patchmill
lands or opens a PR.

## Required sub-skills and agents

- **REQUIRED SUB-SKILL:** Use the installed sibling Superpowers
  subagent-driven-development skill for task-by-task plan execution. Read it
  from `../subagent-driven-development/SKILL.md` and read its prompt templates
  from `../subagent-driven-development/` before dispatching task-level
  subagents.
- **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`
  before claiming success.
- Use Pi `subagent` with the canonical `reviewer` agent for both final review
  passes.
- Use Pi `subagent` with `worker` to fix accepted findings.
- Do **not** use legacy `code-reviewer`; in Pi, it is a disabled compatibility
  shim.

Before launching any subagent, list available agents with
`subagent({ action: "list" })` and confirm `reviewer` and `worker` are
executable.

## Process

### 1. Execute the implementation plan

Follow the installed sibling Superpowers subagent-driven-development workflow
for all implementation tasks:

1. Fresh implementer/worker per task as directed by that skill.
2. Task-level spec compliance review.
3. Task-level code quality review.
4. Fix and re-review until each task is complete.

Adapt its subagent wording to Pi:

- Dispatch task implementers and fix passes through Pi `worker` unless the task
  is so mechanical that the active project has a more specific worker agent.
- Dispatch task-level spec and code-quality reviews through Pi `reviewer` with
  fresh context.
- If any upstream Superpowers template mentions `superpowers:code-reviewer` or
  `code-reviewer`, replace that role with Pi `reviewer`. Never dispatch legacy
  `code-reviewer`.
- Keep the upstream task-level review order: spec compliance first, code quality
  second.

Do not replace task-level reviews with the final reviews below. Both are
required.

### 2. Capture final implementation scope

After all plan tasks and task-level reviews are complete:

1. Record the implementation base SHA from the Patchmill prompt, plan context,
   or the branch point against the target branch.
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

Dispatch a fresh-context, review-only `reviewer` subagent using
`prompts/final-review.md` and Armin Ronacher's Codex review prompt adaptation.

Use:

- `rubrics/armin-codex-review-prompt.md`
- Review name: `Final Codex full-worktree review`
- Scope: the entire final worktree and full implementation diff

The reviewer must not edit files. It must inspect the code directly, cite
file/line evidence, and return a clear verdict.

### 4. Fix Codex-review findings

If the Codex reviewer reports Critical or Important findings, or any Minor
finding that should be fixed before landing:

1. Synthesize accepted findings.
2. Dispatch `worker` using `prompts/fix-review-findings.md`.
3. Instruct the worker to apply only accepted fixes, preserve approved scope,
   and validate.
4. Re-run the Codex final review until it passes or only explicitly deferred
   findings remain.

Ask the human before applying any review item that changes product scope,
architecture beyond the approved plan, public API, migration strategy, or
landing policy.

### 5. Run final review pass 2: Cursor thermo-nuclear rubric

Only start this after the Codex final review loop is closed.

Dispatch a fresh-context, review-only `reviewer` subagent using
`prompts/final-review.md`.

Use:

- `rubrics/cursor-thermo-nuclear-code-quality-review.md`
- Review name: `Final thermo-nuclear full-worktree review`
- Scope: the entire final worktree after Codex-review fixes

The reviewer must focus on structural maintainability, abstraction quality,
codebase health, and code-judo simplifications without changing behavior.

### 6. Fix thermo-nuclear findings

If the thermo-nuclear reviewer reports actionable findings worth doing before
landing:

1. Synthesize accepted findings.
2. Dispatch `worker` using `prompts/fix-review-findings.md`.
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

- `rubrics/armin-codex-review-prompt.md` — Armin Ronacher's adaptation of the
  Codex review prompt.
- `rubrics/cursor-thermo-nuclear-code-quality-review.md` — Cursor Team Kit
  thermo-nuclear code quality review rubric.
- `prompts/final-review.md` — final reviewer subagent contract.
- `prompts/fix-review-findings.md` — worker fix subagent contract.

## Red flags

Never:

- Point Patchmill directly at `superpowers:subagent-driven-development` when
  this final-readiness workflow is required.
- Run the thermo-nuclear review before the Codex review loop is closed.
- Let a reviewer edit files during review-only passes.
- Treat one review pass as satisfying both rubrics.
- Review only the last task; final reviews cover the full final worktree.
- Skip re-review after fixes.
- Ignore uncommitted or untracked implementation changes.
- Proceed to landing with unresolved Critical or Important findings.

## Dispatch shape reference

Review passes should use fresh context:

```typescript
subagent({
  agent: "reviewer",
  context: "fresh",
  task: "Use prompts/final-review.md with the selected rubric file and final scope below...",
  output: false,
});
```

Fix passes should use the normal implementation worker:

```typescript
subagent({
  agent: "worker",
  task: "Use prompts/fix-review-findings.md for the accepted review findings below...",
});
```
