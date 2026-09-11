---
title: Workflow artifacts
description:
  Use verified repository artifacts and planning pull requests in fresh
  workflows.
---

A spec describes design and constraints; a plan describes implementation work.
For a fresh `planning-pr-v1` Issue run, an artifact is authoritative only when
it is either:

- one unambiguous regular file committed under the configured spec or plan
  directory on the freshly fetched target base; or
- an artifact committed in its assigned phase workspace and reviewed in its
  planning or implementation pull request.

The saved planning review-gate snapshot assigns each artifact to a phase. Zero
matching files means that phase creates the artifact; more than one match blocks
rather than guessing. A merged planning pull request becomes part of the fetched
base for the next phase, so reviewer edits are carried forward.

## Fresh workflow

Let ordinary Run-once own artifact publication and review:

```sh
patchmill run-once --issue N
```

An agent changes and commits only the requested artifact. When its phase has a
planning review gate, Patchmill creates the non-closing planning pull request,
returns `review-pending`, and waits for a human to merge that exact pull
request. The implementation pull request carries remaining artifacts and code,
closes the issue, and is validated before terminal cleanup. See
[Run-once](/using-patchmill/run-once/) for the gate matrix and recovery steps.

## Legacy compatibility

`patchmill set-spec` and `patchmill set-plan` still publish deterministic issue
comments containing artifact kind, source path, normalized body, and SHA-256
checksum. Those comments are consumed only by unfinished legacy Issue runs; the
commands preserve their history and checksum behavior but are deprecated for
fresh work.

Likewise, upload handoffs and approval labels remain legacy compatibility data.
They do not authorize a fresh planning phase. For a fresh workflow, commit the
human-authored artifact to the target base before Run-once starts or allow the
assigned phase workspace to create it.
