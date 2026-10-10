---
title: Run-once
description:
  Advance one ready issue through Patchmill's planning pull-request workflow.
---

`patchmill run-once` advances one actionable issue through the configured
workflow. For a fresh `agent-ready` issue it initializes strict `planning-pr-v1`
state and snapshots the configured
[planning review gates](/reference/workflow-labels/). That snapshot stays
immutable for the Issue run.

Preview selection without mutation:

```sh
patchmill run-once --dry-run
```

## Fresh planning workflow

The saved gate snapshot assigns spec and plan artifacts to a **phase
workspace**: the owned worktree and branch for one spec, plan, or implementation
phase, pinned to saved remote-base evidence.

1. Patchmill fetches the target base and resolves assigned artifacts. Exactly
   one matching regular file under the configured directory satisfies assigned
   work; none creates work and multiple candidates block.
2. An agent edits, self-reviews, and commits only the requested artifact in its
   phase workspace.
3. If that phase has a required planning review gate, Patchmill pushes it in a
   non-closing **planning pull request** and returns `review-pending` with exit
   code `0`.
4. A human reviews and merges that exact pull request. Run ordinary recovery:

   ```sh
   patchmill run-once --issue N
   ```

   Patchmill verifies the exact saved pull request and its merge on the saved
   target base before advancing. Comments and labels do not unlock a fresh
   phase.

5. Implementation always produces an open, issue-closing pull request. Before
   finish or cleanup, Patchmill verifies its marker, `Closes #N` reference,
   repository, base, head, open status, remote/local/host OID equality, and
   ancestry.

### Gate matrix

| Spec review | Plan review | Pull request sequence                                                        |
| ----------- | ----------- | ---------------------------------------------------------------------------- |
| Off         | Off         | Implementation contains spec, plan, and code.                                |
| On          | Off         | Spec planning pull request, then implementation with plan and code.          |
| Off         | On          | Plan planning pull request contains spec and plan, then implementation.      |
| On          | On          | Spec planning pull request, plan planning pull request, then implementation. |

GitHub planning heads remain in the target repository. Forgejo may use the
supported same-host head repository. Both providers use the same markers, gate
rules, merge verification, and recovery behavior.

## Results and output

Progress is written to stderr. Redirect stdout for the compact one-line JSON
result:

```sh
patchmill run-once --issue N > result.json
```

`review-pending`, `cleanup-pending`, and `stopped` with reason `plan-only` are
exit-zero nonfailure results. `cleanup-pending` can still appear during
reconciliation of state from an older release. It preserves a valid pull request
while its Issue run remains incomplete. New ignored-only phase cleanup does not
return this result.

An open planning review takes precedence over a plan-only stop. A later
invocation without the option resumes the saved phase and gate snapshot.

### Failure diagnostics

Every reason-bearing blocked, stopped, cleanup, environment, and error result
keeps its stable `reason` code and adds a `diagnostic` object. The object has a
short `summary`, plain-language `explanation`, attributed `details`, safe
`actions`, `safety` warnings, and `retry` guidance. Redirected stdout and the
final JSONL `result` event contain the same object; terminal output renders the
same fields as Reason, Explanation, Details, Recommended action, Safety, and
Retry.

`retry.kind` states when another invocation can help: `retry-now` means the
recommended normal command can make progress now; `after-action` means first
complete the listed safe action; `same-result` means the same command will stop
again until the recorded state changes; and `inspect-first` means inspect and
reconcile preserved evidence before deciding whether to retry. For example,
redirected output for a dirty phase workspace includes its stable code and the
same structured diagnostic written to JSONL:

```json
{
  "status": "blocked",
  "issueNumber": 242,
  "reason": "planning-workspace-dirty",
  "diagnostic": {
    "summary": "Phase workspace has local changes",
    "explanation": "The phase workspace contains local changes and cannot be resumed or published safely.",
    "details": [
      {
        "key": "issueNumber",
        "label": "Issue",
        "value": 242
      },
      {
        "key": "phase",
        "label": "Phase",
        "value": "plan"
      },
      {
        "key": "branch",
        "label": "Branch",
        "value": "agent/issue-242-plan"
      },
      {
        "key": "worktreePath",
        "label": "Worktree",
        "value": ".worktrees/patchmill-issue-242-plan"
      },
      {
        "key": "workspaceState",
        "label": "Workspace state",
        "value": "ready"
      },
      {
        "key": "statusEvidence",
        "label": "Status",
        "value": "dirty"
      }
    ],
    "actions": [
      {
        "description": "Inspect the reported phase, branch, path, state, and status evidence; preserve the work before retrying."
      }
    ],
    "safety": [
      "Do not run git clean, destructive reset, or delete the phase workspace."
    ],
    "retry": {
      "kind": "same-result",
      "guidance": "An immediate retry will give the same result."
    }
  },
  "questions": []
}
```

Selection rejection JSONL events also include a diagnostic beside their reason.
A final `no-issue` result intentionally has no aggregate reason because its
per-Issue rejection events are the source of that information.

Commands in diagnostics are limited to supported commands with a positive Issue
number: `patchmill run-once --issue N`, and, only for Issue run lease/fence
recovery, `patchmill run lease repair --issue N`. A `planning-pr-v1` planning
lock is not an Issue run lease: lock diagnostics never recommend lease repair.

## Recovery and operator safety

A retry observes durable state, the remote, and the host before repeating an
effect. It can adopt an exact pushed head or created pull request, complete a
checkpointed cleanup, return the same open review, or verify a merge.

For spec, plan, and implementation cleanup, empty
`git status --porcelain=v1 --untracked-files=all` output satisfies the workspace
content requirement. Removal still requires valid ownership, path identity,
registration, HEAD, and publication evidence. Staged, tracked, and non-ignored
untracked changes remain blockers. Ignored content alone does not block cleanup
or require an operator retry.

**CAUTION:** Do not store unique data in ignored files inside disposable phase
workspaces. Cleanup permanently deletes all ignored content, including `.env`,
`.pi/`, unknown files, and operator-created files.

Non-destructive in-place recovery preserves ignored files. That preservation
rule does not apply to final phase cleanup. Patchmill never force-cleans a phase
workspace or force-updates a conflicting branch. It does not replace a missing,
ambiguous, or closed-unmerged planning pull request.

| Situation                                            | Operator action                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open review                                          | Review or merge the same pull request, then rerun Run-once.                                                                                                                                                                                                                         |
| Legacy cleanup pending                               | Apply the configured ready label. Then rerun the same issue. Patchmill rechecks ownership, HEAD, ordinary status, and remote evidence before cleanup.                                                                                                                               |
| Closed-unmerged, proven missing, or ambiguous review | Repair the host state manually; Patchmill does not replace the pull request.                                                                                                                                                                                                        |
| Dirty or uncheckpointed phase workspace              | Inspect and preserve local work before retrying.                                                                                                                                                                                                                                    |
| Transient host failure                               | Repair authentication or connectivity, then retry.                                                                                                                                                                                                                                  |
| Active lock                                          | Wait for its owner; never remove it.                                                                                                                                                                                                                                                |
| Stale same-host lock                                 | Run-once automatically archives exact stale bytes under `planning-pr-v1/archive/issue-locks/` and continues after a same-host dead-PID proof. The console warning identifies the archive path; JSONL warning data includes the fingerprint and archive path. Archives are retained. |
| Unverifiable, malformed, or transition-conflict lock | Coordinate with the recorded host/operator and inspect the preserved evidence before retrying; age alone proves nothing. Remote hosts, PID reuse that appears live, and infrastructure failures remain fail-closed.                                                                 |

`patchmill run lease repair` and `patchmill run reset` do not authorize deleting
a `planning-pr-v1` lock, state file, branch, or workspace. They retain their
legacy recovery behavior only.

## Legacy compatibility

`set-spec`, `set-plan`, approval labels, uploads, and `--plan-only` remain
available for unfinished legacy Issue runs during the compatibility window. They
are deprecated for fresh work. Use Run-once review gates for automated review
stops, or the human-invoked `patchmill-plan` skill for local planning without
automated implementation.
