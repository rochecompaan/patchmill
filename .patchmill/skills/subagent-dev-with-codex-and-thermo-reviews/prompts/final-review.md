# Final Full-Worktree Review Prompt

Use this template when dispatching a Pi `reviewer` subagent for one final review
pass.

```text
Review-only task. Do not edit files.

You are performing: {REVIEW_NAME}

## Rubric

Use the rubric in `{RUBRIC_PATH}` as the governing review rubric. Apply it directly. Do not substitute another rubric and do not blend it with the other final-review rubric.

## Implementation scope

Base SHA: {BASE_SHA}
Head SHA: {HEAD_SHA}
Worktree: {WORKTREE_PATH}
Plan/spec: {PLAN_OR_SPEC_PATHS}
Validation already run: {VALIDATION_SUMMARY}

Review the entire final implementation, not just the last task. Inspect:

- `git diff --stat {BASE_SHA}..{HEAD_SHA}`
- `git diff {BASE_SHA}..{HEAD_SHA}`
- `git status --short`
- any uncommitted or untracked implementation files
- relevant tests, docs, config, and generated artifacts touched by the implementation

## Requirements

- Verify implementation correctness against the plan/spec and Patchmill prompt context.
- Verify regressions, edge cases, validation quality, and production readiness.
- For thermo-nuclear review, also aggressively inspect structure, maintainability, abstraction quality, file/module boundaries, and opportunities to simplify without changing behavior.
- Cite file paths and line numbers for every finding.
- Report only evidence-backed, actionable findings.
- Separate Critical, Important, and Minor findings.
- Include a clear verdict: pass, pass with deferred minor findings, or fail.
- If there are no qualifying findings, say the final worktree passes this review.

## Output format

### Review name
{REVIEW_NAME}

### Scope checked
Summarize the diffs, status, files, tests, and docs you inspected.

### Strengths
Concrete evidence of what is already good.

### Findings

#### Critical
Must-fix issues with file/line references.

#### Important
Should-fix issues with file/line references.

#### Minor
Nice-to-have issues with file/line references.

### Verdict
pass | pass-with-deferred-minor-findings | fail

### Reasoning
One or two concise technical sentences explaining the verdict.
```
