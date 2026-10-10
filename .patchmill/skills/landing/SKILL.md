---
name: project-landing
description: Use when Patchmill needs the final pull-request review and handoff decision.
---

# Project Landing

Publish the owned implementation branch and create or update its pull request.
Do not merge, reset, or push the shared target branch. No configured skill can
permit direct landing.

Follow the configured implementation skill's validation, independent review,
and PR-check procedure. Return `pr-created` only after all required checks pass.
Do not return `merged`. Patchmill verifies the PR merge in a later Run attempt.
PR creation and process exit do not complete the Issue run.

For a current code-related check failure, use the configured repair procedure.
For credentials, services, runners, permissions, quota, billing, or host failures,
return an operator blocker with evidence. Do not make speculative code changes.

Use `landingDecision` to explain the PR handoff:

```json
{
  "status": "pr-created",
  "prUrl": "<pull request URL>",
  "branch": "agent/issue-124-example-change",
  "commits": ["<implementation commit sha>"],
  "validation": ["npm test passed"],
  "reviewSummary": "Independent review completed",
  "landingDecision": "PR required: implementation changes use the PR merge flow"
}
```
