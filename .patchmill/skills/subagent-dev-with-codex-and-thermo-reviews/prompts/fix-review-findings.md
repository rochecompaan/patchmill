# Fix Final Review Findings Prompt

Use this template when dispatching a Pi `worker` subagent to fix accepted
final-review findings.

```text
You are fixing accepted findings from {REVIEW_NAME}.

## Accepted findings to fix

{ACCEPTED_FINDINGS}

## Non-goals and deferred findings

{DEFERRED_OR_REJECTED_FINDINGS}

## Implementation context

Base SHA: {BASE_SHA}
Current HEAD: {HEAD_SHA}
Worktree: {WORKTREE_PATH}
Plan/spec: {PLAN_OR_SPEC_PATHS}

## Constraints

- Apply only the accepted fixes listed above.
- Preserve user-approved scope and behavior unless a finding explicitly identifies a defect.
- Do not perform broad rewrites or product/API/architecture changes that were not approved.
- Ask for a decision before changing public API, migration strategy, landing policy, or product behavior.
- Keep changes focused and reviewable.
- Add or update tests when fixing behavior, validation, parsing, error handling, or regressions.

## Validation

Run the focused validation needed for the fixes, then any broader validation requested by the plan or parent session. If validation cannot run, explain why and provide the strongest substitute evidence.

## Report format

- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Findings fixed
- Files changed
- Tests/validation run and results
- Any remaining risks or follow-up needed
```
