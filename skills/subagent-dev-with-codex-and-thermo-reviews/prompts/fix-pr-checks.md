# Fix Pull Request Checks Prompt

Use this template when dispatching a Pi `worker` to repair code-related failed
checks on an existing pull request.

```text
You are repairing code-related failed checks on an existing pull request. Do not dispatch subagents.

## Pull request context

Pull request: {PR_URL}
Branch: {BRANCH}
Expected failed head SHA: {FAILED_HEAD_SHA}
Current local HEAD: {CURRENT_HEAD_SHA}
Worktree: {WORKTREE_PATH}
Plan/spec: {PLAN_OR_SPEC_PATHS}

## Failed checks

{FAILED_CHECKS}

## Failed-step evidence

{FAILED_CHECK_LOGS}

## Prior readiness evidence

Local validation: {LOCAL_VALIDATION_SUMMARY}
Final reviews: {FINAL_REVIEW_SUMMARY}
Prior PR-check repair attempts: {REPAIR_ATTEMPT_COUNT}

## Required procedure

1. Verify the pull request still points at the expected failed head SHA. If it moved, stop and report `NEEDS_CONTEXT` with both SHAs instead of editing against stale CI evidence.
2. Reproduce or explain each failed test, lint, formatting, type-check, or build check locally when feasible.
3. Apply only repository changes needed to repair the demonstrated failures.
4. Preserve the approved plan/spec, product behavior, public API, architecture, migration strategy, and landing policy unless the failed check proves a defect in one of them.
5. Run focused validation for the changed files and rerun every final validation command affected by the repair.
6. Commit the repair with a focused Conventional Commit.
7. Push normally to the existing pull-request branch. Never force-push.
8. Do not claim that cancelled, timed-out, infrastructure, permissions, quota, billing, or host-service failures were repaired with code.

## Report format

- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Failed checks addressed
- Root cause
- Files changed
- Commit SHA and subject
- Validation run and results
- Push result
- Remaining failed or external checks
```
