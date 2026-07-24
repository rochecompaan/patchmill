# Run-once approval artifact publication design

## Summary

When repository policy requires manual approval of a spec or implementation
plan, `patchmill run-once` currently creates and commits the artifact in a local
issue worktree, posts a concise path comment, applies the configured review
label, and stops. The issue reviewer cannot read the committed artifact because
no pull request exists and the issue branch is not pushed.

Patchmill will keep the local commit for durable resume state and additionally
publish each Patchmill-created artifact to the issue before requesting its
required review. Publication will use the same internal operation as
`patchmill set-spec` and `patchmill set-plan`, preserving the existing
deterministic path, content, and checksum format.

## Goals

- Make a Patchmill-created artifact visible on the issue before requesting its
  required manual review.
- Keep the current local commit, branch, worktree, and resume behavior.
- Make the issue's deterministic artifact comment the human review surface.
- Reuse one publishing implementation for the CLI and `run-once`.
- Preserve current behavior when the corresponding approval gate is optional.
- Prevent a review label from being applied when publication fails.

## Non-goals

- Pushing the planning branch or creating a pull request before implementation.
- Removing local artifact commits or making issue comments the only persistence
  mechanism.
- Publishing every generated artifact regardless of approval policy.
- Republishing source-provided or pre-existing repository artifacts.
- Adding remote reconciliation after an ambiguous publication failure.
- Changing the deterministic artifact comment format, trust policy, checksum
  validation, or extraction rules.
- Designing artifact revision or approval-revocation behavior.

## Current behavior

The spec and plan creation prompts require the agent to save and commit one
artifact. `run-once` stores the artifact path and commit in run state. If the
corresponding approval policy is required, the pipeline posts `Spec ready` or
`Plan ready`, applies the configured review label, preserves the planning
workspace, and stops.

Separately, `set-spec` and `set-plan` validate a local artifact path, read its
content, format a deterministic Patchmill artifact comment, and post it to the
issue. A later `run-once` extracts and validates these comments before issue
mutation and can materialize source-provided artifacts into an issue worktree.

The missing step is automatic publication between the successful local commit
and the existing review request.

## Architecture

### Shared publisher

Extract the file-validation and comment-publication operation from
`src/cli/commands/set-artifact/main.ts` into a reusable workflow-artifact
publisher. Its input contains:

- artifact kind (`spec` or `plan`);
- issue number;
- repository root containing the artifact;
- artifact path;
- allowed configured artifact directory;
- comment publisher supplied by the configured host provider.

The publisher will:

1. resolve the artifact path against the supplied repository root;
2. require a regular file inside the allowed specs or plans directory;
3. derive the repository-relative source path;
4. read the file;
5. call the existing `formatPublishedArtifactComment` formatter; and
6. post the resulting body through the supplied comment publisher.

A successful return has the same meaning as a successful `set-spec` or
`set-plan` command today. The publisher does not reload the issue to verify the
new comment.

### CLI integration

`runSetArtifactCommand` remains responsible for argument parsing, configuration
and host construction, output, and exit status. It delegates artifact validation
and publication to the shared publisher. Existing command syntax and observable
comment format remain unchanged.

### Pipeline integration

The planning stage already has the configured host, planning repository root,
resolved artifact path, creation provenance, and approval policy. It calls the
shared publisher directly rather than spawning a Patchmill subprocess or
reloading configuration.

Publication applies only when all of these are true:

- the corresponding spec or plan approval policy is required;
- the artifact exists and was created by the Patchmill planning pipeline;
- the artifact has been committed successfully; and
- the corresponding publication checkpoint is not recorded.

This includes a retry of a previously created artifact whose committed workspace
was preserved. A source-provided issue artifact, a pre-existing repository
artifact, or an artifact without a required approval gate is not automatically
reposted.

## Data flow

### Required spec approval

1. Resolve that no usable spec already exists.
2. Create the issue planning worktree when needed.
3. Run the spec agent.
4. Validate the returned spec path and commit SHA.
5. Save the path, commit, and creation checkpoint in run state.
6. Publish the committed file with shared `set-spec` semantics.
7. Record `specPublished` in run-state checkpoints.
8. Post the existing concise spec-ready comment.
9. Apply the configured spec-review label and stop for manual approval.

On the next invocation, existing artifact-source preflight parses the published
spec. Existing resume logic reuses the saved planning worktree and committed
spec before creating the plan.

### Required plan approval

After plan creation and commit, the pipeline performs the equivalent sequence:

1. save plan path, commit, and creation provenance;
2. publish with shared `set-plan` semantics;
3. record `planPublished`;
4. post the existing concise plan-ready comment;
5. apply the configured plan-review label; and
6. stop for manual approval.

### Policies without the gate

If spec approval is not required, spec creation remains commit-only. If plan
approval is not required, plan creation remains commit-only. A plan-only gate
does not cause automatic spec publication, and a spec-only gate does not cause
automatic plan publication.

## Run state and ordering

Add `specPublished` and `planPublished` to `AgentIssueRunCheckpoints`. Preserve
them through the same resumable side-effect checkpoint handling used for ready
comments and labels.

The ordering invariant for each required review is:

```text
artifact commit
  -> publication succeeds
  -> publication checkpoint persists
  -> ready comment
  -> review label
  -> workflow stop
```

A review label must never precede successful publication. The existing concise
ready comment remains a separate notification after the deterministic artifact
comment.

## Failure behavior

If the shared publisher throws:

- retain the local artifact commit, branch, worktree, and run state;
- do not record the publication checkpoint;
- do not post the ready comment;
- do not apply the configured review label; and
- report the failing artifact kind, path, and publication stage through the
  existing pipeline failure mechanism.

If publication succeeds, Patchmill assumes the artifact was uploaded, matching
current `set-spec` and `set-plan` semantics. It does not rehydrate or inspect
the issue. A later retry skips publication when the publication checkpoint was
successfully persisted. Ambiguous remote success before a thrown error or local
checkpoint failure may produce a duplicate deterministic comment on retry; this
rare case is accepted to keep the change simple.

## Testing

Automated behavior tests will cover:

- both CLI commands delegate to the shared publisher while retaining their
  deterministic comment format and validation behavior;
- required spec approval publishes after commit and before the spec-ready
  comment and review label;
- required plan approval publishes after commit and before the plan-ready
  comment and review label;
- a publication exception preserves the committed workspace and applies no
  review label;
- a persisted publication checkpoint prevents publication from repeating when a
  later side effect is retried;
- no publication occurs when the corresponding approval gate is not required;
- a plan-only approval gate does not publish the generated spec;
- a spec-only approval gate does not publish the generated plan; and
- source-provided and pre-existing repository artifacts are not reposted.

Tests will assert behavior and side-effect ordering through injected publishers,
host calls, run state, and existing pipeline scenario harnesses. No test will
merely assert prompt or configuration text.

## Documentation

Update the workflow-artifacts documentation to state that:

- `run-once` automatically publishes a Patchmill-created spec or plan before
  requesting its required review;
- the local artifact remains committed in the issue worktree for resume and
  eventual repository history;
- manual `set-spec` and `set-plan` remain the way to publish human-authored or
  otherwise pre-existing artifacts; and
- automatic publication is not performed when the corresponding approval gate is
  optional.

## Compatibility

No configuration migration is required. Existing label names, artifact paths,
comment parsing, approval transitions, and manual commands remain compatible.
Repositories without required spec or plan approval retain their current
behavior.
