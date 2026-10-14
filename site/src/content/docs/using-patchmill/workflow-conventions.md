---
title: Workflow conventions
description:
  Understand how Patchmill names specs, plans, branches, and worktrees and finds
  them during an issue run.
---

A spec describes the design and constraints. A plan describes implementation
work. Patchmill uses the issue number to connect these artifacts to their issue
run.

Repository configuration controls artifact directories and Git names. The
recommended `patchmill-planning` skill teaches agents the planning conventions.
Run-once task prompts supply the exact artifact path and owned worktree for each
assignment. If you customize prompts or skills, preserve those paths and the
limits on what each agent can change. See
[Skills configuration](/guides/skills-configuration/) for overrides.

## Artifact filenames

With the default configuration, generated artifacts use these paths:

| Artifact | Path                                                          |
| -------- | ------------------------------------------------------------- |
| Spec     | `docs/specs/YYYY-MM-DD-issue-<number>-<title-slug>-design.md` |
| Plan     | `docs/plans/YYYY-MM-DD-issue-<number>-<title-slug>.md`        |

A slug is a title formatted for filenames. Patchmill lowercases the title and
replaces groups of non-alphanumeric characters with hyphens. For issue #42,
“Export notifications,” example paths are:

```text
docs/specs/2026-06-22-issue-42-export-notifications-design.md
docs/plans/2026-06-22-issue-42-export-notifications.md
```

Run-once finds existing artifacts by the `-issue-42-` marker in the filename and
the configured artifact directory. The date and title do not need to match the
current date or issue title. Fresh workflows read regular files committed on the
fetched target base, not uncommitted files in the main checkout. Symlinks and
submodules do not count as artifacts.

Exactly one matching file satisfies assigned work. No match means that the
assigned phase creates the artifact. Multiple matches block the run. Do not
create another matching file just to update its date. Keep the original path
when you edit an existing artifact.

## Branch and worktree names

A phase workspace is a worktree and branch for one phase. Fresh `planning-pr-v1`
runs use separate identities for spec, plan, and implementation phases. With the
default configuration, issue #42 uses these names:

| Phase          | Branch                                               | Worktree                                                            |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Spec           | `agent/issue-42-export-notifications-spec`           | `.worktrees/patchmill-issue-42-export-notifications-spec`           |
| Plan           | `agent/issue-42-export-notifications-plan`           | `.worktrees/patchmill-issue-42-export-notifications-plan`           |
| Implementation | `agent/issue-42-export-notifications-implementation` | `.worktrees/patchmill-issue-42-export-notifications-implementation` |

The phase suffix describes the workspace owner. It does not require one
workspace for every artifact. The saved review gates determine which phase
creates each missing artifact. For example, with both planning gates off, the
implementation workspace carries the spec, plan, and code.

A matching name alone does not prove ownership. Patchmill also checks saved
state, worktree registration, repository identity, and Git evidence. It does not
adopt a foreign checkout or overwrite a conflicting branch.

## Configuration

These defaults control the paths and names above:

```json
{
  "paths": {
    "specsDir": "docs/specs",
    "plansDir": "docs/plans",
    "worktreeDir": ".worktrees"
  },
  "git": {
    "branchPrefix": "agent/issue-",
    "worktreeNamePrefix": "patchmill-issue-",
    "slugLength": 48
  }
}
```

`git.slugLength` limits the title slug in branch and worktree names. It does not
limit the title slug in artifact filenames. Changing a directory or prefix does
not rename existing artifacts or workspaces.

Stop affected processes before changing a running workflow's configuration.
Resume uses saved workspace identities and paths. See
[Configuration](/getting-started/configuration/#keep-paths-predictable) for the
bound namespace and todo-root rules.

## How an issue run uses these conventions

Run ordinary Run-once from the repository clone:

```sh
patchmill run-once --issue 42
```

For a fresh run:

1. Patchmill saves the review gates and fetches the target base.
2. It finds committed artifacts by issue number under the configured
   directories.
3. It prepares an owned phase workspace for missing work and supplies the
   agent's exact artifact path.
4. The agent edits, self-reviews, and commits only its assigned artifact.
5. Patchmill owns publication, review stops, merge reconciliation, and cleanup.

A required planning gate produces a non-closing planning pull request. After a
human merges that exact pull request, the next phase reads the artifact from the
fetched base. The implementation pull request carries the remaining work and
closes the issue. See [Workflow artifacts](/using-patchmill/workflow-artifacts/)
and the [gate matrix](/using-patchmill/run-once/#gate-matrix).

For unfinished legacy runs, the issue branch and worktree names lack the phase
suffix. Artifact lookup can use an owned issue worktree or read the committed
tree of the local issue branch without checking it out. This lookup does not
create a worktree or bypass ownership, approval, or checksum rules. Approval
labels and comment handoffs remain
[legacy compatibility data](/using-patchmill/workflow-artifacts/#legacy-compatibility).

## Resume without renaming or discarding work

Rerun the same explicit command to continue an issue. Patchmill keeps the saved
artifact paths, workspace identity, and todo location. It does not choose a new
artifact filename because the date or issue title changed.

Merging the target base into an owned implementation branch does not make the
workspace foreign. A changed implementation head requires fresh implementation
and review checks, not a reset or replacement pull request. See
[implementation head changes](/using-patchmill/run-once/#implementation-head-changes)
for recovery steps and limits.
