# Workflow Artifacts

Patchmill uses **workflow artifacts** to decide what an issue means before it
writes code:

- a **spec** describes the approved design and scope;
- a **plan** describes the implementation steps Patchmill should execute.

Developers often create these artifacts while brainstorming an issue before
Patchmill gets involved. That is the recommended workflow, but the artifacts
must be published to the issue in Patchmill's deterministic format.

## Deterministic artifact extraction only

Patchmill extracts specs and plans from issues only when they were published
with:

```sh
patchmill set-spec --issue <number> docs/specs/<name>.md
patchmill set-plan --issue <number> docs/plans/<name>.md
```

These commands read the local Markdown file and post a Patchmill-owned issue
comment containing:

- the artifact kind (`spec` or `plan`);
- the repository-relative source path;
- the complete artifact body;
- a SHA-256 checksum of the normalized body.

When `patchmill run-once` later loads the issue, it parses those Patchmill-owned
comments and copies the artifact text itself. No model is asked to find, copy,
or summarize a spec or plan from arbitrary issue prose.

## What does not count as a workflow artifact

The following issue content is useful context for humans, but Patchmill will not
extract it as an authoritative spec or plan:

- a regular issue comment saying "here is the spec";
- Markdown headings such as `# Spec` or `## Implementation Plan`;
- a `<details>` block pasted by hand;
- an edited issue comment containing a long plan;
- a link to an external document;
- a custom issue template section.

If you need Patchmill to use a developer-authored spec or plan, save it as a
local file and publish it with `set-spec` or `set-plan`.

## Recommended developer workflow

1. Brainstorm and write the spec locally.
2. Save it under the configured specs directory, usually `docs/specs/`.
3. Publish it to the issue:

   ```sh
   patchmill set-spec --issue 99 docs/specs/log-entries-ui-design.md
   ```

4. Write the implementation plan locally.
5. Save it under the configured plans directory, usually `docs/plans/`.
6. Publish it to the issue:

   ```sh
   patchmill set-plan --issue 99 docs/plans/log-entries-ui.md
   ```

7. Apply any required approval labels, such as `spec-approved` or
   `plan-approved`, according to the repository workflow policy.
8. Run Patchmill:

   ```sh
   patchmill run-once --issue 99
   ```

`set-spec` and `set-plan` do not commit the local files. They publish the file
contents to the issue. If the repository wants the source spec/plan files in
git, commit them through the normal repository workflow.

## Command behavior

Both commands require an issue number and one file path:

```sh
patchmill set-spec --issue <number> <path>
patchmill set-plan --issue <number> <path>
```

The path must point to an existing file inside the configured artifact
directory:

- `set-spec` requires a file under `paths.specsDir`;
- `set-plan` requires a file under `paths.plansDir`.

The default directories are:

```json
{
  "paths": {
    "specsDir": "docs/specs",
    "plansDir": "docs/plans"
  }
}
```

Provider login flags match the rest of the CLI:

```sh
patchmill set-spec --issue 99 docs/specs/design.md --host-login triage-agent
patchmill set-plan --issue 99 docs/plans/plan.md --tea-login triage-agent
```

## Replacing an artifact

Running `set-spec` or `set-plan` again posts another Patchmill-owned artifact
comment. `run-once` treats the latest valid artifact comment of each kind as the
authoritative one.

Use this when a developer revises a spec or plan before implementation:

```sh
patchmill set-plan --issue 99 docs/plans/log-entries-ui-v2.md
```

The old comment remains in the issue history, but the latest valid `plan`
artifact wins.

## What `run-once` does with published artifacts

`run-once` evaluates workflow artifacts in this order:

1. Load the issue body and comments.
2. Parse Patchmill-owned deterministic artifact comments.
3. Validate each artifact checksum.
4. Materialize published inline artifacts into the configured docs directories
   in the issue worktree after the issue is claimed.
5. Use the published spec and/or plan as the authoritative workflow artifacts.
6. If a spec or plan is missing, continue the normal workflow and create the
   missing artifact with Patchmill's planning stages.

Patchmill never asks Pi to extract workflow artifacts from free-form issue
content.

## Troubleshooting

### Patchmill generated a new spec or plan even though I pasted one into the issue

Pasted comments are issue discussion, not workflow artifacts. Publish the file
with `set-spec` or `set-plan`, then run `run-once` again.

### Patchmill reported a checksum mismatch

Do not hand-edit Patchmill-owned artifact comments. The checksum will no longer
match if the body changes. Update the local file and rerun `set-spec` or
`set-plan`.

### I need custom issue templates

Custom templates can still help humans understand an issue, but they do not
publish authoritative workflow artifacts. Use `set-spec` and `set-plan` when
Patchmill must implement from a specific spec or plan.
