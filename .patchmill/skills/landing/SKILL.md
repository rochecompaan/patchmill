---
name: project-landing
description: Decide when Patchmill may direct-land and when it must open a PR.
---

# Project Landing

Use this skill for the final direct-land versus pull-request decision.

Direct-land only when all of these are true:

- The issue is a trivial docs, copy, or config change; or a simple bug that was
  reproduced, fixed, and covered by validation.
- The change is small, localized, and easy to inspect from the diff.
- Required validation commands passed.
- No visible UI state requires human inspection.
- No migration, schema change, dependency change, security-sensitive behavior,
  public API change, large refactor, or ambiguous product/UX decision is
  involved.

If direct-land is eligible and Patchmill's prompt says direct landing is
allowed, squash-merge the implementation branch into the target branch, push the
target branch, close the source issue on the issue host, and return `merged`
final JSON. Include a `landingDecision` that explains why direct landing was
safe and confirms the issue was closed:

```json
{
  "status": "merged",
  "branch": "agent/issue-123-fix-empty-state",
  "mergeCommit": "<squash commit sha on target branch>",
  "commits": ["<implementation commit sha>"],
  "validation": ["npm test passed"],
  "reviewSummary": "reviewed simple localized bug fix; closed issue #123",
  "landingDecision": "direct squash-landed and closed issue: reproduced simple bug and validation passed"
}
```

For everything else, create or update a pull request and return `pr-created`
final JSON. Prefer PR fallback for visual UI changes, migrations, large
refactors, dependency updates, security-sensitive changes, and anything that
needs human product, UX, or architecture review. Include a `landingDecision`
that explains why human review is required:

```json
{
  "status": "pr-created",
  "prUrl": "<pull request URL>",
  "branch": "agent/issue-124-redesign-dashboard",
  "commits": ["<implementation commit sha>"],
  "validation": ["npm test passed", "npm run build passed"],
  "reviewSummary": "reviewed implementation and visual evidence",
  "landingDecision": "PR required: visible UI change needs human inspection"
}
```
