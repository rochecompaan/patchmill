# Planning Artifacts Review Fix Design

## Source and scope

This design records the requirements in four review-fix todos for PR #326:

- `TODO-22050eb3`: preserve PR identity and restore removed phase workspaces.
- `TODO-b0acafe3`: run implementation retries through canonical workspace
  checks.
- `TODO-1aaa7e97`: separate PR identity, observed heads, and checked heads.
- `TODO-27af0bd5`: materialize selected approved artifacts before execution.

The user requested all four fixes and a push to the existing PR. The starting
commit is `221441ce7c9fa0b0461c7a170e6b18b453a8961c`. Work stays in
`.worktrees/planning-artifacts-without-issue-branch` on
`fix/planning-artifacts-without-issue-branch`.

The todos contain the approved behavior and acceptance criteria. The
implementation choices below are proposals for plan review, not additional user
requirements.

## Intent

Resume an Issue run without losing its PR, destroying local work, or claiming
checks for a revision that Patchmill did not check. Give each agent its selected
approved artifacts in its actual execution worktree.

A Phase workspace is the owned worktree and branch for one workflow phase. Run
recovery state records the checkpoints needed to resume the workflow. An
observed head identifies the PR revision seen on the host. A checked head
identifies the revision covered by successful Patchmill checks.

## Required behavior

### PR identity and workspace recovery

Invalidating checks must preserve the PR reference, URL, repositories, branches,
saved base, artifact identity, and actual workspace cleanup state. It must not
turn a removed workspace into a ready workspace by changing a record alone.

Before an agent runs, inspect an existing owned workspace or restore a removed
workspace at its saved conventional path. Restoration uses the existing PR's
current branch. It must not reset a surviving local branch or replace the PR.

The canonical preparation path must prove ownership, registration, cleanliness,
and ancestry from the saved base before it records a new workspace head. A
changed implementation commit does not invalidate workspace identity. A failed
restoration must retain recoverable PR evidence and stop execution.

A changed `branch-pushed` checkpoint must enter this preparation path. An
unchanged checkpoint must continue independent PR validation without another
agent run. Dirty content and unsafe workspace evidence must stop execution
before an agent starts.

### Revision evidence and human merges

Use the existing canonical PR identity validator for references, URLs,
repositories, branches, ownership markers, and closing references. Do not make
an exact-head comparison pass by replacing its expected head with its input.

Record observed and checked heads separately. Only successful fresh checks can
advance checked-head evidence. Old validation and review results remain
historical evidence for their checked revision.

If Patchmill checked A and a human advances and merges B, accept a valid merge.
Record observed head B, checked head A, and the merge commit as distinct facts.
Do not rerun agents after merge merely because B differs from A. The completion
result must identify the revision covered by the saved checks and review.

Foreign PRs, invalid ownership evidence, and merges absent from the fetched
merge target remain blocked.

### Approved artifact availability

Convention-based discovery remains supported. Canonical resolution must retain
one selected relative path, source location, and content snapshot for each
required approved artifact. Approval and materialization must use that same
selection.

Materialize repository-fallback and explicit sources through the artifact layer.
Before execution, require the selected artifact to be readable at its supplied
path inside the execution worktree. Another root cannot satisfy this check.

Preserve approval policy, configured directories, ambiguity rules, saved
artifact identity, and safe-path rules. Do not overwrite conflicting files. If
resolution, materialization, or destination checks fail, report the affected
artifact and stop before agent execution.

## Proposed implementation choices

### Recovery checkpoints

Add an implementation-only `revalidation-pending` phase. It retains the saved
workspace and prior publication evidence while fresh work is required. Carry
that prior evidence into the next `workspace-ready` and `branch-pushed`
checkpoints until independent validation succeeds for the same PR. If a
`branch-pushed` receipt has only a PR URL, resolve its canonical reference for
both agent handoff and independent validation. Restoring a workspace must not
allow an agent to replace that PR.

Use a focused recovery helper from the outer phase runner. Extend the workspace
lifecycle's existing `resume` input with an optional restoration head. The Git
adapter handles restoration under the existing repository mutation guard.
Non-implementation resumes retain their existing behavior.

The canonical workspace reconciliation function remains the pre-agent safety
boundary. It must not checkpoint a changed head before cleanliness and
saved-base ancestry checks finish. Restoration and reuse converge on that same
boundary.

### Evidence fields

Add optional `checkedHeadOid` to implementation evidence and optional
`observedHeadOid` to published and complete implementation phases. Optional
fields keep older checkpoints readable. Older published check receipts derive
their checked revision from the saved publication head, not a new observation.

Both open and merged PR reconciliation return `headOid`. The completion result
exposes the checked and observed heads. If they differ, its validation and
review presentation explicitly identifies the saved evidence as historical.

A late merge can have three distinct revisions: checked A, prepared workspace B,
and merged PR head C. Before recording this transition, prove that B is in C's
Git history and verify the PR merge in the fetched target. Record B in optional
`merge.workspaceHeadOid`. Retain A's receipt, B's workspace head, and observed
C.

This proof also supports squash merges, which combine PR changes into one
commit. Cleanup must still reject new dirty content or a changed local head. If
B's inclusion cannot be proved, retain the workspace and block cleanup.

### Artifact selection

Extend resolved approved artifacts with their selected source evidence.
Preflight returns those sources alongside the existing policy and artifacts. A
focused execution-artifact module handles materialization, saved commit
identity, and destination checks. The legacy pipeline only supplies its
execution root and consumes the prepared artifact result.

## Non-goals

- Replace or reopen a PR, reopen an Issue, or reset local work.
- Require an old implementation HEAD to prove workspace ownership.
- Reject a valid human merge because Patchmill checked an earlier revision.
- Change planning-PR head-adoption policy or agent-result parsing policy.
- Add dependency updates, skill-pack changes, or broad pipeline restructuring.

## Verification

All four fixes change reusable behavior and pass the Testing Value Gate. Use
behavioral regression tests, including outer-runner and real-Git tests. Prove
blocked cases launch no agent and preserve existing content and identity.

Run focused suites after each fix. Before pushing, run the full test suite,
TypeScript checks, lint, build, architecture checks, and `git diff --check`. Use
formatting and Markdown lint for these documents rather than text-assertion
tests. If npm dependency files remain unchanged, their mandatory Nix rebuild
rule does not apply.
