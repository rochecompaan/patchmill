# Planning merge gates

## Approved behavior

This correction supersedes the one-branch, label-based approval rules in the
2026-10-15 kernel design. The operator confirmed the existing legacy settings:

- `workflow.specApproval.required` defaults to `false` when omitted.
- `workflow.planApproval.required` defaults to `false` when omitted.
- A required planning gate opens a separate PR. Only merging that PR unlocks the
  next stage. A review approval alone does not unlock it.
- Keep the issue `in-progress` while waiting. Later runs can resume it under the
  existing issue lock. Never run Pi while a required planning PR is still open.
- Remove spec/plan review and approval labels from configuration and execution.
- When a gate is off, create its artifact in the next required planning branch,
  or in the implementation branch when no later planning gate is required.
- A merged spec or plan PR is never an implementation completion signal.
- Planning PRs use `Refs #N`, not issue-closing references. Only the verified
  implementation PR can complete the workflow.

## Implementation boundaries

Retain the small kernel and existing host adapters. Derive progress from Git and
PR facts, not a second persisted workflow state machine. Use separate
`agent/issue-N--spec` and `agent/issue-N--plan` branches for required gates;
retain the existing issue branch for implementation and for ungated artifacts.
Discover branches independently per stage, so expected planning branches are not
ambiguous issue branches. Create each later branch from the freshly fetched base
after the earlier PR has merged. Require merged artifacts to be present on that
base before moving on. A closed, unmerged planning PR needs human input rather
than implementation.

The planning skill receives the current stage and whether it must publish a
planning PR. With no gates, it creates both documents and continues to
implementation. With only the plan gate, it publishes both documents in the plan
PR. With only the spec gate, the plan goes into the implementation PR.

Existing generated review-label settings are accepted but ignored for migration;
new config and managed files omit them. Do not delete repository-wide host
labels or mutate live issues/PRs during this fix.

## Verification and rollout

Use real Git fixtures plus the existing fake host/Pi boundary to test all four
gate combinations, waiting, merge-only advancement, stale/missing merge
evidence, closed PRs, and repeated runs without duplicate PRs. Keep existing
safety tests for containment, distinct artifacts, locks, wrong worktrees, result
validation, output, and subprocess handling. Check skill/config changes with
lint and packed installation, not tests that assert document text.

Run the complete test suite, lint, build, packed smoke, and Nix build. Commit
the fix, update the local test repo's Patchmill pin and installed managed files,
verify the resolved CLI/config, and commit that update. Live model/host writes
and shared-branch pushes are not part of this correction.
