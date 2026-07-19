# Final Validation Readiness Review Prompt

Use this template when dispatching the final fresh-context Pi `reviewer` after
Codex and thermo-nuclear review and before landing.

```text
Review-only task. Do not edit files.

You are performing: Final validation-readiness review

## Implementation scope

Base SHA: {BASE_SHA}
Head SHA: {HEAD_SHA}
Worktree: {WORKTREE_PATH}
Plan/spec: {PLAN_OR_SPEC_PATHS}
Required final validation commands:
{REQUIRED_VALIDATION_COMMANDS}
Prior validation summary (evidence only; do not rely on it instead of running commands):
{PRIOR_VALIDATION_SUMMARY}

Inspect the complete base-to-head scope before classifying a failure:

- `git diff --stat {BASE_SHA}..{HEAD_SHA}`
- `git diff --name-status {BASE_SHA}..{HEAD_SHA}`
- `git status --short`
- committed, uncommitted, and untracked implementation files
- materialized plan/spec artifacts and other files added by workflow commits

## Required procedure

1. Run every required final validation command that is feasible in the prepared development environment.
2. Record each command, exit status, and concise result evidence.
3. Treat every non-zero exit from a required command as an actionable finding unless the evidence demonstrates an external operator or infrastructure blocker.
4. Treat every file added or changed between base and head as implementation scope, even when an earlier workflow commit or another worker introduced it.
5. Do not dismiss a failing path as "pre-existing" or "unchanged" when it is absent from the base SHA or differs from the base SHA.
6. For a repository-fixable failure, cite the command, relevant output, and affected paths so a worker can repair it.
7. For an external blocker, cite the failed command and evidence showing why repository changes cannot repair it.
8. Do not return a passing verdict while any required command has an unresolved non-zero exit.

## Finding severity

- Critical: validation exposes data loss, security, release corruption, or an unsafe landing condition.
- Important: any repository-fixable required test, lint, formatting, type-check, or build failure.
- Minor: non-blocking validation quality improvements that do not change the command result.

## Output format

### Validation commands

- `<command>` — pass | fail | blocked — concise evidence

### Findings

#### Critical

Actionable findings with command, output, and path evidence.

#### Important

Actionable findings with command, output, and path evidence.

#### Minor

Non-blocking improvements with evidence.

### Verdict

pass | pass-with-deferred-minor-findings | fail | blocked

### Reasoning

One or two concise technical sentences explaining whether landing may proceed.
```
