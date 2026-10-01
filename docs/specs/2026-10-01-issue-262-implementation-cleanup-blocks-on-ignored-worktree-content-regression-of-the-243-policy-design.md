# Remove ignored content during verified phase cleanup

- **Issue:** #262
- **Status:** Proposed design

## Summary

When ordinary Git status is clean, Patchmill will remove a verified phase
workspace. Ignored content will not block removal or produce a warning.

Ordinary status includes staged changes, tracked changes, and non-ignored
untracked files. It excludes ignored files and directories. The policy applies
to spec, plan, and implementation phase workspaces.

Patchmill will use normal `git worktree remove` without `--force`. Git removes
ignored content during this operation. If an ordinary change appears after the
last status read, Git refuses removal.

This design intentionally replaces the ignored-content preservation policy from
issue #243 for final phase cleanup. It does not change the non-destructive,
in-place recovery policy from issue #211.

## Context

`PlanningWorkspaceCleanupGit.removeWorktree()` currently reads ordinary and
ignored status. It returns `cleanup-pending` for any ignored path. Phase callers
persist that result and require operator action before a later Run attempt.

That behavior protects unknown ignored files from deletion. However, it also
blocks successful cleanup for expected build, tool, environment, and agent
artifacts.

The issue owner accepts permanent deletion of all ignored content in a verified
phase workspace. This permission includes unknown files, operator-created files,
`.env`, and `.pi/` data.

A phase workspace is still disposable only after all existing identity, HEAD,
publication, and branch-removal safeguards pass.

## Requirements

- Cleanup must use the machine-readable equivalent of:

  ```sh
  git status --porcelain=v1 --untracked-files=all
  ```

- Empty output must satisfy the workspace-content requirement.
- Staged, tracked, and non-ignored untracked changes must block cleanup.
- Ignored content alone must not block cleanup.
- Cleanup must not classify ignored paths by name or owner.
- Cleanup must not publish an ignored-content warning or remediation comment.
- Cleanup must not apply `needs-info` because ignored content exists.
- The policy must apply to spec, plan, and implementation phase workspaces.
- Existing ownership, path, local-HEAD, publication, remote-HEAD, and branch
  deletion safeguards must remain.

## Non-goals

This change will not:

- use `git worktree remove --force`.
- run `git clean` before removal.
- add an ignored-path allowlist or ownership classifier.
- add a repository setting for this policy.
- preserve, copy, archive, quarantine, hash, or upload ignored content.
- permit cleanup of the main checkout or an unverified worktree.
- change cleanup-hook execution or checkpoint order.
- weaken the in-place recovery safeguards from issue #211.
- remove durable legacy `cleanup-pending` records without compatibility.

## Approaches considered

### Normal removal with legacy-state compatibility

This is the selected approach. The shared cleanup layer will ignore ignored
status and use normal worktree removal. It will continue to accept durable
`cleanup-pending` state from older runs.

This approach implements the approved policy with the smallest safety change.
Normal Git removal also protects ordinary changes that appear after the status
read.

### Force removal or explicit ignored-file cleaning

One option is to use `git worktree remove --force` or `git clean -fdX`. These
commands add destructive behavior that the requirement does not need.

A force operation can also delete a late ordinary change. This approach is
rejected.

### Allowlist or repository configuration

An allowlist can remove only known generated paths. A repository setting can
make the policy optional. Both choices conflict with the approved
path-independent rule and add test combinations without a current requirement.

### Remove all cleanup-pending support

Removing the state variants, codecs, diagnostics, and output can reduce code.
However, older durable records then require migration or become unreadable.

This approach is rejected for this issue. Compatibility can remain without
letting new cleanup operations produce the pending state.

## Proposed design

### Shared cleanup policy

`PlanningWorkspaceCleanupGit.removeWorktree()` will remain the shared removal
policy for all phase workspaces. Phase-specific callers will not select a
different ignored-content rule.

The method will continue to accept workspace state `ready` or `cleanup-pending`.
The latter input supports records from older Patchmill versions.

### Removal preconditions

Before worktree removal, Patchmill will make sure that:

1. the saved Run attempt and phase own the workspace.
2. the expected worktree path and Git registration match.
3. the expected branch is not owned by another worktree.
4. the local branch is at the saved HEAD.
5. ordinary Git status is clean.
6. the current phase has its existing publication or pull-request proof.

The later branch-removal step will retain its exact remote-HEAD proof. It will
also retain compare-and-swap deletion of the expected local branch.

### Ordinary status assessment

The removal assessment will request ordinary status only. It will not pass
`--ignored=matching` and will not collect ignored paths.

The implementation can retain NUL-delimited output for safe parsing:

```sh
git --no-optional-locks -C <worktree> status \
  --porcelain=v1 -z --untracked-files=all
```

Empty output means that the content requirement passes. Any output means that
ordinary content is dirty and produces the existing `dirty-worktree` conflict.

The cleanup layer will retain its second ordinary-status read after workspace
inspection. This read narrows the race between initial inspection and removal.

### Worktree removal

When all preconditions pass, Patchmill will run:

```sh
git worktree remove -- <worktree-path>
```

The command will not include `--force`. Patchmill will not run a separate clean
operation first.

Normal Git removal deletes ignored files and directories. If an ordinary change
appears after the last status read, Git refuses removal. Patchmill will return
the existing typed command error and will not retry with force.

After successful removal, the current checkpoint sequence records
`worktree-removed`. Patchmill then verifies the remote branch and removes the
expected local branch. The final checkpoint records `removed`.

### Ignored content behavior

Ignored paths will have no live cleanup classification. Patchmill will not:

- inventory them for removal.
- compare them with an allowlist.
- return `cleanup-pending` because of them.
- include them in output or issue comments.
- preserve them before worktree removal.

This deletion is deliberate. The issue owner accepts deletion of every ignored
path inside a verified phase workspace.

### Legacy cleanup-pending compatibility

State codecs and validation will continue to accept this durable state:

```text
state: cleanup-pending
reason: ignored-worktree-content
ignoredPaths: [...]
```

When an eligible Run attempt resumes this state, the shared cleanup layer will
apply the new policy. It will recheck live ownership, identity, HEAD,
publication, remote, and ordinary-status evidence.

If these checks pass, cleanup will advance directly to `worktree-removed` and
then `removed`. It will not replay completed cleanup hooks or earlier finish
effects.

New worktree-removal executions will not create an ignored-content pending
state. Existing issue comments remain historical records.

### Phase behavior

Spec and plan cleanup will use the shared rule after the existing planning pull
request proof. Implementation cleanup will use the same rule after the existing
pull request handoff and cleanup-hook checkpoint.

Successful cleanup will continue through the normal completion path for each
phase. An implementation Run attempt will return its normal `pr-created` result.

No phase will stop, request `agent-ready`, or apply `needs-info` because only
ignored content exists.

## Error handling

- Invalid saved ownership remains `invalid-saved-identity`.
- A changed worktree registration remains an existing registration conflict.
- A changed local HEAD remains `head-oid-mismatch`.
- Ordinary dirty status remains `dirty-worktree`.
- A late ordinary change makes normal Git removal fail without a force retry.
- A missing or changed remote branch remains `remote-head-mismatch` before local
  branch deletion.
- Other Git and file-system errors retain their current typed error paths.
- Ignored content alone produces no error, warning, or pending result.

## Affected components

- `src/git/planning-workspace-inspection.ts` will assess ordinary removal status
  without `--ignored=matching` or an ignored-path inventory.
- `src/git/planning-workspace-cleanup.ts` will remove the live branch that
  returns `cleanup-pending` for ignored paths.
- `src/git/planning-workspaces.ts` and `src/git/planning-workspace-git.ts` will
  distinguish legacy pending input from the live worktree-removal result.
- `src/cli/commands/run-once/planning-phase-cleanup.ts` and
  `src/cli/commands/run-once/planning-finish.ts` will advance live cleanup
  directly after successful worktree removal.
- Planning state codecs and validation will retain legacy pending-state support.
- Cleanup-pending reconciliation and public output code will remain available
  for durable legacy records, but new cleanup will not call that path.
- `site/src/content/docs/using-patchmill/run-once.md` will describe deletion of
  ignored content during verified phase cleanup.

No dependency or configuration-schema change is planned.

## Verification strategy

These automated tests pass the Testing Value Gate. They protect destructive
behavior, durable compatibility, and a critical workflow regression.

### Shared Git cleanup tests

Use real repositories and Patchmill-owned worktrees to prove that:

- ordinary-clean worktrees with ignored files and directories are removed.
- known and unknown ignored path names receive the same treatment.
- the ignored bytes and worktree path no longer exist after cleanup.
- the removal command does not include `--force`.
- staged, tracked, and ordinary untracked changes block cleanup.
- blocking ordinary files remain on disk.
- an ordinary file created after the last status read makes Git refuse removal.

Unit tests will prove that ordinary status parsing treats empty output as clean
and all non-empty ordinary output as dirty. The Git command must not request
ignored entries.

### Phase and compatibility tests

Cover spec, plan, and implementation cleanup. For each phase, ignored content
must advance cleanup instead of producing `cleanup-pending`.

Start a retry from a durable legacy pending state. Verify that cleanup rechecks
all live safeguards and reaches normal completion. Also verify that completed
cleanup hooks and finish effects do not run again.

Retain or strengthen tests for local-HEAD mismatch, remote-HEAD mismatch,
registration conflict, and idempotent missing-worktree or missing-branch state.

### Pipeline and output tests

Exercise a successful implementation pull request with representative ignored
tool, environment, build, and agent paths. Verify that:

- the result is the normal successful result.
- no ignored-content warning is present.
- no ignored-path remediation comment is published.
- `needs-info` is not applied.
- normal done-label behavior continues.
- the worktree and expected local branch are removed.

Run focused cleanup, phase, finish, pipeline, output, and legacy-state tests.
Then run:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run site:build
git diff --check
```

If implementation changes `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json`, a Nix build is required.

## Acceptance mapping

| Requirement                            | Design response                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Empty ordinary status permits cleanup  | The removal assessment ignores ignored entries and accepts empty ordinary porcelain output.                    |
| Ordinary changes remain blockers       | Staged, tracked, and non-ignored untracked entries retain `dirty-worktree` behavior.                           |
| Every ignored path is disposable       | The shared policy does not inspect names or ownership before normal removal.                                   |
| No operator round-trip occurs          | New cleanup does not return `cleanup-pending`, apply `needs-info`, or request another Run attempt.             |
| Every phase uses the rule              | Spec, plan, and implementation call the shared cleanup layer.                                                  |
| Existing safeguards remain             | Ownership, path, registration, local-HEAD, publication, remote-HEAD, and branch deletion checks stay in place. |
| Late ordinary changes remain protected | Worktree removal stays non-force, so Git can refuse the race.                                                  |
| Older state remains readable           | Legacy pending state remains valid and advances under the new cleanup policy.                                  |
