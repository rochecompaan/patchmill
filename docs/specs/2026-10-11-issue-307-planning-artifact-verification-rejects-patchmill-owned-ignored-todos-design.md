# Permit owned todo metadata during planning artifact verification

- **Issue:** #307
- **Status:** Proposed design
- **Review context:** Current planning pull request

## Purpose and evidence

A planning agent can commit a plan and create ignored task todos in the same
phase workspace. Read-only artifact verification must accept this expected
metadata without removing the plan or todos.

`PlanningPublicationGit.assertClean()` requests ignored status and rejects every
nonempty result. Neither verification input carries the recorded `todoRoot`.
`runPlanningPhaseArtifacts()` already records this root before the agent starts,
but does not pass it to verification.

A disposable linked-worktree reproduction against the current source proved that
both verification methods pass before todo creation. After todo creation,
ordinary status stayed empty. Both methods rejected `!! .pi/todos/\0` with
`status/dirty-workspace`. The commit and todo bytes remained intact.

A retry also needs artifact reconciliation. Verification fails before Patchmill
records the artifact and its HEAD. The implementation phase can adopt the newer
HEAD before artifact generation resumes. Reusing that commit then produces an
empty artifact diff, which `verifyArtifactCommit()` rejects.

## Requirements and scope

- Both `verifyArtifactCommit()` and `verifyWorkspace()` must permit ignored
  metadata beneath the current phase workspace's recorded todo root.
- Verification must preserve the plan commit, index, worktree files, and todo
  bytes.
- Staged changes, tracked changes, and ordinary untracked files must still fail,
  including changes beneath the todo root.
- HEAD mismatch, invalid ancestry, invalid artifact files, and unrelated
  committed changes must retain their existing rejection rules.
- Unknown ignored content must still fail publication verification.
- A supported in-place retry must reuse the committed artifact and todos before
  it continues through the existing workflow gates.
- Verification success must not authorize workspace removal or replacement.

No dependency, configuration, durable schema, or planning review gate change is
required. This work does not add cleanup commands, force flags, backups, or todo
content validation.

## Approaches considered

**Recorded-root exception, selected.** Pass saved ownership evidence to both
verification methods. Permit only ignored records within that root. This keeps
the behavior change limited to expected task metadata.

**Ordinary status only, rejected.** Removing `--ignored=matching` permits all
ignored content, including unknown files. That change exceeds this issue's
scope.

**Remove todos before verification, rejected.** This removes required task state
and violates the preservation requirement.

## Proposed behavior

### Ownership evidence

Add optional `todoRoot` to `PlanningArtifactCommitInput` and
`PlanningWorkspaceVerificationInput`. Callers must obtain this value from the
current phase's saved workspace ownership, not from agent output or Git status.

The artifact runner will pass the root that it records through the existing
Issue todo contract resolver. The publisher will pass `phase.workspace.todoRoot`
after its existing workspace ownership verification.

An absent root grants no exception. Older records remain readable. The normal
resolver can record a root before a new artifact agent starts, as it does today.
A valid external or shared root grants no exception inside the phase workspace.

For a local exception, the recorded root must be a proper directory descendant
of the verified workspace. Path comparison must respect directory boundaries and
canonical filesystem containment. Relative, malformed, workspace-wide, or
symlink-escape roots must not grant an exception. Git failures and unsafe path
evidence must fail closed.

The recorded local root defines the owned metadata subtree. Verification does
not parse todo titles, tags, statuses, or file contents. It must not treat the
whole `.pi/` directory as owned because `.pi/todos` is recorded.

### Status assessment

Keep ordinary cleanliness and the ignored-content exception separate:

1. Read NUL-delimited ordinary porcelain status with all untracked files. Any
   ordinary record retains `status/dirty-workspace`.
2. Read NUL-delimited status with `--ignored=matching`. Permit only `!!` records
   at the recorded todo directory or beneath it.
3. Reject every other record with `status/dirty-workspace`.

The shared assessment must preserve raw Git path spelling. It must not split on
newlines, trim paths, or decode paths as display strings. A missing NUL
terminator or malformed record produces `status/malformed-response`.

Directory records such as `!! .pi/todos/` must pass for that recorded root.
Sibling prefixes such as `.pi/todos-backup/` must fail. A collapsed ancestor
record such as `!! .pi/` must fail because it does not prove todo-only content.
This rule prevents a broad ignore pattern from hiding unrelated metadata.

Use `--no-optional-locks` for verification status reads. The verifier must not
remove files, change refs, reset the index, or run worktree mutation commands.
Existing HEAD, ancestry, tree, and artifact-diff proofs remain unchanged.

### Supported in-place retry

Reconciliation applies only to `workspace-ready` phases with incomplete artifact
evidence and a live HEAD that differs from the saved HEAD. It must run before
strict saved-HEAD resume or generic implementation HEAD adoption. Fresh
workspaces at the saved HEAD continue through normal artifact generation.

Recovery must prove all of these conditions:

- The Issue run, phase, saved base, branch, path, and worktree registration
  match the existing ownership rules.
- Ordinary status is clean, and the observed HEAD descends from the saved HEAD.
- The committed tree contains one unambiguous candidate for the next missing
  artifact kind and current issue, inside the configured artifact directory.
- `verifyArtifactCommit()` accepts that candidate against the earlier saved
  HEAD, with the recorded todo root. The delta contains only that artifact path.

Candidate discovery must inspect the committed tree and use the existing
`-issue-<number>-` naming rule. It must preserve the original path, not derive a
new filename from the retry date.

After proof, recovery must append the artifact evidence and advance workspace
HEAD through the existing checkpoint operation. Strict resume then uses this
checkpoint. The artifact agent must not recreate the recovered document or its
todos. Remaining artifact work and publication use the normal phase flow.

This bounded retry supports one unrecorded artifact delta, which matches the
reported interruption. Ambiguous candidates, unrelated changes, invalid
ancestry, and unsafe workspace evidence must stop without changing files. A
failed checkpoint must stop before publication or implementation.

Already recorded artifacts retain their existing skip behavior. Planning pull
requests still require verified merge where the saved planning review gate
requires it. Retry must preserve `plan-only` behavior and implementation PR
requirements.

### Cleanup boundary

The exception belongs only to read-only publication verification. It must not
filter ignored inventories used by destructive recovery. Refresh, reset,
replacement, and removal retain their own authorization and preservation rules.

Current final phase cleanup follows issue #262. Normal `git worktree remove` can
remove ignored content after separate publication and ownership safeguards pass.
That policy replaced issue #243's final-cleanup preservation rule. This design
does not expand or reverse that existing authorization.

The preservation guarantee covers verification and in-place retry, not later
separately authorized final cleanup. Verification alone must never trigger
cleanup or classify unknown ignored files as disposable.

## Affected components

- `src/git/planning-publication-git.ts`: Extend both verification inputs and add
  the shared, read-only status assessment.
- `src/cli/commands/run-once/planning-phase-artifacts.ts`: Pass the recorded
  todo root and reuse recovered artifact evidence.
- `src/cli/commands/run-once/planning-phase-publisher.ts`: Pass saved ownership
  evidence to workspace verification.
- `src/cli/commands/run-once/planning-phase-runner-shared.ts` and
  `src/cli/commands/run-once/planning-phase-runner-implementation.ts`: Reconcile
  an unrecorded artifact before saved-HEAD resume or generic HEAD adoption.
- A focused artifact-recovery helper and committed-tree discovery operation:
  Keep retry proof separate from agent execution and reuse artifact naming
  rules.
- Publication, artifact, publisher, and real-Git phase-runner tests: Cover both
  verification entry points, ownership propagation, and the retry interruption.

Workspace cleanup and destructive recovery guards require no policy changes.
Existing state transitions already permit one artifact append with HEAD advance.

## Verification strategy

These automated tests pass the Testing Value Gate. They protect production Git
validation, a durable retry regression, and a data-preservation boundary.

### Real-Git verification

Extend `src/git/planning-publication-git.real.test.ts` with a linked phase
workspace, committed artifact, recorded todo root, and ignored todo files. Both
verification methods must pass. Artifact bytes, todo bytes, index state, and
HEAD must remain unchanged across repeated calls.

Cover a custom local todo root and absent ownership evidence. Cover external
roots, unsafe roots, sibling prefixes, and collapsed ignored ancestors. Unknown
ignored files beside the owned root must fail.

Retain negative coverage for staged changes and tracked changes. Cover ordinary
untracked files inside and outside the todo root. Retain coverage for HEAD
mismatch, invalid ancestry, missing artifacts, symlinks, gitlinks, and extra
committed paths. Focused unit tests must cover malformed NUL records and Git
command errors.

### Workflow retry and safety

Extend the real-Git phase-runner coverage beyond the existing mocked artifact
operation. Start from saved `workspace-ready` state at the pre-agent HEAD.
Include a committed plan, missing plan evidence, and the recorded ignored todo
root.

A supported retry must checkpoint the original plan path and commit without
another plan-agent invocation. The next implementation-agent boundary must
observe the same plan commit and byte-identical todos. Stop this scenario before
final cleanup. Repeat from the updated checkpoint to prove idempotence.

Caller tests must prove that both verification paths receive the saved root.
Retain planning review gate, verified-merge, and `plan-only` tests. Add retry
refusals for ambiguous candidates, unrelated commits, dirty status, invalid
ancestry, and checkpoint failure. Each refusal must preserve the workspace.

Retain destructive recovery tests that refuse unknown ignored content before
refresh or reset. Retain final-cleanup tests under the separately approved
policy. Command observations must show no cleanup or replacement during
verification or artifact reconciliation.

Implementation verification will run the focused Git and workflow suites, then
`npm run test:run-once`, `npm test`, `npm run lint`, `npm run build`, and
`git diff --check`. If npm dependency files change, a Nix build is required.

## Planning handoff

This artifact receives review in the current planning pull request. The next
Patchmill workflow step creates the implementation plan. This spec-creation step
does not implement code or create implementation task todos.
