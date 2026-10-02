# Non-invasive Patchmill mode for repositories without label control

- **Issue:** #165
- **Status:** Proposed design

## Summary

Patchmill will add a configurable issue-state backend. The default backend will
continue to use labels. A new comment backend will store Patchmill workflow
state in issue comments.

The comment backend lets a contributor use Patchmill on a repository without
creating labels or changing repository files. Patchmill will still use the code
host for issues and pull requests. It will store its local configuration outside
version control through the existing `patchmill init` git policy.

## Context

Patchmill currently treats host labels as durable workflow state. `run-once`
selects issues by labels, moves an issue to `in-progress` with label changes,
uses review and approval labels for planning gates, and marks terminal results
with labels.

This model fails when a contributor can comment on an issue but cannot create or
apply labels. It also intrudes on repositories where maintainers do not want
Patchmill-specific labels.

The requested behavior is narrower than a separate local work source. The issue
still lives in the code host. The non-invasive mode changes how Patchmill stores
its own workflow state for that issue.

## Goals

- Let `run-once` work when the user can comment but cannot change labels.
- Keep labels as the default behavior and preserve existing configurations.
- Store Patchmill workflow roles in issue comments with markdown front matter.
- Resolve current workflow state from the last trusted Patchmill state comment.
- Reuse current approval, selection, claim, failure, and completion semantics.
- Avoid changes to repository files beyond the user's local configuration.
- Keep host providers responsible for host operations, not workflow decisions.

## Non-goals

- Replacing GitHub or Forgejo issues with Beads, Kata, `taskdb`, or another
  local tracker.
- Adding a generic work-source provider in this issue.
- Encoding type labels, priority labels, or arbitrary repository labels in
  comments.
- Changing planning pull request publication or pull request body handling.
- Making unauthenticated issue comments authoritative.
- Changing the existing `.patchmill` local-only setup behavior.

## Configuration

Add an issue-state section to `patchmill.config.json`:

```json
{
  "issueState": {
    "provider": "comments"
  }
}
```

The default value is:

```json
{
  "issueState": {
    "provider": "labels"
  }
}
```

`host` remains the code-host configuration. The new section selects where
Patchmill stores workflow state for issues from that host.

The comment provider can also accept a trusted-author list:

```json
{
  "issueState": {
    "provider": "comments",
    "trustedAuthors": ["jimfulton"]
  }
}
```

If `trustedAuthors` is omitted, Patchmill will trust the authenticated host
user. This matches the user who can create Patchmill state comments through the
CLI.

## Using comment mode after init

The first implementation does not need to change `patchmill init`. Because
`patchmill init` prepares the repository for the default label backend, it asks
whether to create missing Patchmill labels.

Documentation must explain the comment-mode setup path:

1. Run `patchmill init` without `--yes`.
2. Answer `no` when asked to create missing labels.
3. Edit the generated `patchmill.config.json` to set `issueState.provider` to
   `comments`.
4. Add `issueState.trustedAuthors` if the authenticated host user should not be
   the only trusted author.

This keeps the implementation scope limited. A later change can add an `init`
option or prompt for selecting the issue-state provider.

## Patchmill state comments

The comment backend will use a small front-matter document:

```markdown
---
Patchmill: agent-ready
---
```

The value after `Patchmill:` is a Patchmill workflow role. The first version
will support these roles:

- `agent-ready`
- `needs-info`
- `agent-unsuitable`
- `blocked`
- `in-progress`
- `agent-done`
- `spec-review`
- `spec-approved`
- `plan-review`
- `plan-approved`

A state comment must contain only the front matter and optional explanatory text
after the closing `---`. Patchmill will ignore malformed front matter. It will
also ignore comments from untrusted authors.

When an issue has more than one trusted state comment, the last one by creation
time is authoritative. If the host does not return comment creation times,
Patchmill will use the returned comment order.

## State model

Introduce a CLI-neutral issue-state contract that works above raw labels:

```ts
type IssueWorkflowRoles = {
  roles: string[];
};

type IssueStateProvider = {
  resolveRoles(issue: IssueSummary): IssueWorkflowRoles;
  setRoles(issue: IssueSummary, roles: string[]): Promise<void>;
};
```

The names are illustrative. The implementation plan can choose exact names that
fit the current modules.

The label provider will map configured labels to roles. It will preserve current
behavior by applying and removing labels through
`IssueHostProvider.applyLabels`.

The comment provider will map roles to one new state comment. It will not edit
or delete old comments. Each state change appends a new authoritative comment.

The rest of Patchmill will consume roles rather than labels for Patchmill-owned
workflow state. Host labels remain available on `IssueSummary` for repository
classification and human context.

## Selection behavior

With the label provider, selection remains unchanged.

With the comment provider, `run-once` will select an issue when the resolved
roles contain an actionable role:

- `agent-ready`
- `spec-approved`
- `plan-approved`

The existing workflow-state resolver will keep its current precedence:

1. `plan-approved`
2. `plan-review`
3. `spec-approved`
4. `spec-review`
5. `agent-ready`
6. not actionable

Blocking roles exclude an issue from selection. These roles are `needs-info`,
`agent-unsuitable`, `blocked`, `in-progress`, and `agent-done` unless the run is
an eligible resume.

Priority ordering will continue to use configured priority labels when labels
exist. If the user cannot use priority labels, selection falls back to issue
number order.

## State transitions

The comment provider will append one state comment for each state transition.
The comment records the complete Patchmill workflow role set for that point.

Examples:

```markdown
---
Patchmill: in-progress
---

Automation started for issue #165.
```

```markdown
---
Patchmill: spec-review
---

Spec output path:
docs/specs/2026-10-01-issue-165-non-invasive-patchmill-mode-for-working-on-repositories-one-doesn-t-control-design.md
```

```markdown
---
Patchmill: spec-approved
---
```

For a single state value, the `Patchmill` field contains one role. If a later
implementation needs multiple concurrent roles, it can use a YAML list while the
parser keeps the scalar form valid:

```markdown
---
Patchmill:
  - spec-approved
  - plan-review
---
```

The first implementation does not need to publish lists if the current workflow
can be represented as one role at a time.

## Approval behavior

Approval behavior must match durable approval labels.

When the comment backend sees `spec-approved`, Patchmill requires one uniquely
resolved specification. It must reuse that specification and must not create a
replacement.

When the comment backend sees `plan-approved`, Patchmill requires one uniquely
resolved implementation plan. It must reuse that plan and must not create a
replacement.

Patchmill must not treat an untrusted approval comment as approval. It must fail
safely if an approved artifact is missing or ambiguous.

## Host-provider changes

`IssueHostProvider` already exposes the host operations that the comment backend
needs:

- `viewIssue()`
- `hydrateIssueComments()`
- `trustedTriageCommentAuthors()`
- `commentIssue()`
- `applyLabels()`

The design keeps those operations. The new issue-state provider will compose a
host provider and the Patchmill configuration.

Host implementations need only focused changes if their comment payloads lack
stable authors, creation times, or ordering. GitHub already returns these values
through `gh issue view --json comments`. Forgejo must provide the same
normalized fields before the comment backend can be enabled for it.

## Affected components

Expected implementation areas are:

- `src/config/types.ts`, `src/config/defaults.ts`, and `src/config/load.ts` for
  `issueState` configuration.
- A new issue-state module under `src/issue/` or `src/workflow/`.
- `src/policy/triage.ts` and `src/policy/triage-state.ts` to expose workflow
  roles without assuming labels.
- `src/cli/commands/run-once/selection.ts` and `workflow-state.ts` to resolve
  workflow state from roles.
- Run-once lifecycle modules that call `applyLabels()` for claim, review stops,
  failures, and completion.
- Triage command code that writes Patchmill state after classification.
- Host tests for normalized comment author, time, and ordering fields.

No npm dependency change is expected.

## Error handling

If the comment backend cannot identify a trusted author, Patchmill fails before
it selects or changes an issue. The error must tell the user to configure
`issueState.trustedAuthors` or authenticate the host CLI.

If comment creation fails, Patchmill reports the host error and leaves earlier
comments unchanged. A rerun resolves the last successfully written state.

If a state transition comment is written but a later operation fails, rerunning
Patchmill uses that comment as the current state. This matches the existing
label-based recovery model.

If both labels and comments contain Patchmill state, the configured provider is
authoritative. Patchmill must not merge both sources.

## Compatibility

Existing repositories continue to use labels because `labels` remains the
default provider. Existing `labels` and `workflow` configuration keys keep their
current meanings for the label provider.

The comment provider can still read configured label names for compatibility
messages and for priority labels. It does not require those labels to exist on
the host.

`patchmill doctor` will validate the selected issue-state provider. For the
comment provider, it will resolve trusted authors instead of checking required
label existence. Doctor will not write a probe comment. The first state write
will verify comment permission.

## Verification strategy

Apply the Testing Value Gate. Add automated tests because the change affects
selection, state transitions, approval gates, and host permissions.

Automated coverage will include:

1. Config parsing accepts `issueState.provider: "comments"` and preserves the
   current label default.
2. The comment parser accepts scalar front matter and ignores malformed or
   untrusted comments.
3. The comment resolver chooses the last trusted state comment.
4. `run-once` selects `agent-ready`, `spec-approved`, and `plan-approved` from
   comments when the comment provider is configured.
5. Blocking roles in comments exclude issues from automatic selection.
6. Claim, review-stop, failure, and completion flows append state comments
   instead of changing labels.
7. Durable spec and plan approvals from trusted comments enforce the existing
   approved-artifact safety checks.
8. Label-provider tests keep passing without behavior changes.
9. Doctor checks trusted-author resolution for the comment provider and label
   existence for the label provider.

Verification commands will include focused run-once, config, policy, and host
tests, then `npm run check:types`, `npm run lint`, `npm run build`, and
`npm test`.

## Acceptance mapping

| Acceptance criterion                   | Design response                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Work without label control             | The comment provider stores Patchmill state through issue comments.              |
| Avoid repository configuration changes | The mode uses local `patchmill.config.json` and existing local-only setup.       |
| Preserve existing behavior             | The label provider remains the default and keeps current label semantics.        |
| Determine state from the last comment  | The resolver uses the last trusted Patchmill state comment.                      |
| Keep approvals safe                    | Trusted approval comments reuse approved artifacts and fail safely on ambiguity. |
| Avoid a larger tracker rewrite         | The design adds issue-state providers, not a new work-source subsystem.          |
