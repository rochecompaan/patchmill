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

`review-pending` and `stopped` with reason `plan-only` are exit-zero nonfailure
results. An open planning review takes precedence over a plan-only stop; a later
invocation without the option resumes the saved phase and gate snapshot.

## Recovery and operator safety

A retry observes durable state, the remote, and the host before repeating an
effect. It can adopt an exact pushed head or created pull request, complete a
checkpointed cleanup, return the same open review, or verify a merge. It never
force-updates a conflicting branch or replaces a missing, ambiguous, or
closed-unmerged planning pull request.

| Situation                                            | Operator action                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open review                                          | Review or merge the same pull request, then rerun Run-once.                                                                                          |
| Closed-unmerged, proven missing, or ambiguous review | Repair the host state manually; Patchmill does not replace the pull request.                                                                         |
| Dirty or uncheckpointed phase workspace              | Inspect and preserve local work before retrying.                                                                                                     |
| Transient host failure                               | Repair authentication or connectivity, then retry.                                                                                                   |
| Active lock                                          | Wait for its owner; never remove it.                                                                                                                 |
| Stale lock                                           | Prove the recorded process stopped, record its SHA-256 fingerprint, archive or move the exact `planning-pr-v1/locks/issue-N.lock` bytes, then rerun. |
| Unverifiable or malformed lock                       | Coordinate with the recorded host/operator or inspect archived bytes before manual removal; age alone proves nothing.                                |

`patchmill run lease repair` and `patchmill run reset` do not authorize deleting
a `planning-pr-v1` lock, state file, branch, or workspace. They retain their
legacy recovery behavior only.

## Legacy compatibility

`set-spec`, `set-plan`, approval labels, uploads, and `--plan-only` remain
available for unfinished legacy Issue runs during the compatibility window. They
are deprecated for fresh work. Use Run-once review gates for automated review
stops, or the human-invoked `patchmill-plan` skill for local planning without
automated implementation.
