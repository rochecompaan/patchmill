---
title: Workflow artifacts
description:
  Publish approved specs and plans so Patchmill can reuse them
  deterministically.
---

Workflow artifacts are the approved documents that tell Patchmill what an issue
means before implementation starts:

- a **spec** describes the design, scope, and constraints;
- a **plan** describes the implementation tasks Patchmill should execute.

Developers often create these documents while discussing an issue. Patchmill can
reuse them, but only after they are published in Patchmill's deterministic issue
comment format.

## Publish specs and plans

Use `set-spec` and `set-plan` to publish local Markdown files to an issue:

```sh
patchmill set-spec --issue 99 docs/specs/log-entries-ui-design.md
patchmill set-plan --issue 99 docs/plans/log-entries-ui.md
```

Each command reads the local file and posts a Patchmill-owned issue comment
containing the artifact kind, source path, full body, and a SHA-256 checksum of
the normalized body.

When `patchmill run-once` later loads the issue, it parses those deterministic
comments directly. It does not ask a model to find, copy, or summarize artifacts
from arbitrary issue prose.

## What does not count

These issue contents can still help human reviewers, but Patchmill will not use
them as authoritative workflow artifacts:

- a regular comment saying "here is the spec";
- Markdown headings such as `# Spec` or `## Implementation Plan`;
- a hand-pasted `<details>` block;
- an edited issue comment containing a long plan;
- a link to an external document;
- a custom issue-template section.

If Patchmill must implement from a specific spec or plan, save it as a local
file and publish it with `set-spec` or `set-plan`.

## Recommended workflow

1. Write the spec locally under the configured specs directory, usually
   `docs/specs/`.
2. Publish it with `patchmill set-spec --issue <number> <path>`.
3. Write the plan locally under the configured plans directory, usually
   `docs/plans/`.
4. Publish it with `patchmill set-plan --issue <number> <path>`.
5. Apply the required approval labels, such as `spec-approved` or
   `plan-approved`, according to the repository workflow policy.
6. Run `patchmill run-once --issue <number>`.

`set-spec` and `set-plan` publish file contents to the issue. They do not commit
the local files. Commit source spec and plan files through the normal repository
workflow when your team wants those files in git.

## Updating an artifact

Run `set-spec` or `set-plan` again when a developer revises an artifact before
implementation:

```sh
patchmill set-plan --issue 99 docs/plans/log-entries-ui-v2.md
```

Patchmill leaves older artifact comments in the issue history, but `run-once`
uses the latest valid artifact comment of each kind.

## How run-once uses artifacts

In execute mode, `run-once` handles published artifacts before it mutates the
issue:

1. Load the issue body and comments.
2. Parse Patchmill-owned deterministic artifact comments.
3. Validate each artifact checksum.
4. Claim the issue and create the issue worktree.
5. Materialize published artifacts under their recorded docs paths in that
   worktree.
6. Use those published specs and plans as source-provided workflow artifacts.
7. Generate only the missing artifacts that the repository approval policy
   requires.

Patchmill never treats free-form issue comments, hand-edited artifact comments,
external links, or issue-template sections as authoritative workflow artifacts.

## Troubleshooting

If Patchmill generated a new spec or plan after you pasted one into an issue,
publish the local file with `set-spec` or `set-plan` and run `run-once` again.

If Patchmill reports a checksum mismatch, do not hand-edit the Patchmill-owned
artifact comment. Update the local file and publish the artifact again.
