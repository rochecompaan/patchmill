---
name: patchmill-planning
description:
  Use for Patchmill run-once spec and plan creation. Wraps sibling Superpowers
  brainstorming and writing-plans skills with Patchmill worktree, artifact path,
  and test-value policy, and applies the simple-english writing rules to specs
  and plans.
---

# Patchmill Planning

Use this as the Patchmill planning entrypoint. It does not replace the upstream
Superpowers workflows; it annotates the installed sibling Superpowers skills
with Patchmill-specific rules.

## Required sibling skills

- For design/spec work, read `../brainstorming/SKILL.md` and follow the upstream
  brainstorming workflow except where this wrapper or the Patchmill prompt gives
  a stricter instruction.
- For implementation-plan work, read `../writing-plans/SKILL.md` and follow the
  upstream writing-plans workflow except where this wrapper or the Patchmill
  prompt gives a stricter instruction.
- For writing style, read `../simple-english/SKILL.md` and apply its rules to
  the prose of the spec and plan documents you write, except where this wrapper
  or the Patchmill prompt gives a stricter instruction.

Use paths relative to this skill directory. If those sibling skills or their
supporting files are missing, stop and ask instead of recreating them.

## Patchmill modifications

### Worktree invariant

Specs and plans are feature artifacts. Write them in the active Patchmill issue
worktree. If already running in a Patchmill issue worktree, use that worktree
and do not create another one. If working ad hoc outside an issue worktree, use
`using-git-worktrees` before writing the artifact.

Return artifact paths relative to the repository root.

### Artifact output paths

When the Patchmill prompt supplies an output path, use that exact
repository-relative path. Keep its directory and filename unchanged. The prompt
path takes precedence over these examples and upstream skill naming rules.
Patchmill can use configured directories instead of `docs/specs/` and
`docs/plans/`.

Do not substitute an upstream `docs/superpowers/` path for the prompt path. For
ad hoc work without a Patchmill output path, follow the project's artifact
naming rules.

### Spec artifacts

For design specs, use the sibling brainstorming workflow as source material.
Save the validated design to the prompt's `Spec output path`.

With the default spec directory, Patchmill generates:

```text
docs/specs/YYYY-MM-DD-issue-<number>-<title-slug>-design.md
```

### Conditional frontend design during specification

Evaluate the proposed scope during brainstorming. Record whether frontend design
applies and give a brief reason in the spec. Activate for browser-visible
layout, responsive behavior, typography, color, spacing, imagery, styling,
interaction, motion, accessibility, navigation, or user-flow changes. Skip
backend and documentation work. Copy-only work activates only when it materially
changes one of these areas.

When design applies, read `../frontend-design/SKILL.md` during the normal
brainstorming process. Treat it as specification guidance, not a later product
implementation phase. If its skill or license is missing, stop with evidence; do
not fetch a substitute.

Apply this precedence to conflicts:

1. Explicit user and approved product requirements.
2. Repository policy and the existing design system.
3. The approved written specification.
4. Mockup visual intent.
5. Generic frontend-design guidance.

Record why a higher-priority requirement overrides generic guidance. Preserve
approved project choices instead of introducing preference-driven redesigns.

Before completing an applicable spec, create one self-contained HTML mockup at
`docs/mockups/YYYY-MM-DD-topic.html` in the active Phase workspace. Embed
required CSS and JavaScript. Do not require network assets, installation, a
build, or a local server. The file must open directly from disk in a browser.

Show changed components in complete page context, not isolated fragments.
Include mobile and desktop responsive layouts, semantic HTML, visible keyboard
focus, and reduced-motion support where applicable. Open the file from disk at
mobile and desktop widths during self-review. Verify page context, keyboard
focus, reduced motion, and operation without network access.

Declare each mockup with a repository-relative path and a working link in the
spec's single top-level companion section. For the default spec directory, use
this exact declaration shape:

```markdown
## Companion artifacts

- `docs/mockups/YYYY-MM-DD-topic.html`:
  [Full-page mockup](../mockups/YYYY-MM-DD-topic.html)
```

The link must resolve from the actual spec directory to the declared path. Use
regular `.html` files under `docs/mockups/`. Do not declare remote links,
traversal paths, symlinks, query strings, or fragments.

Commit the mockup with its spec as a planning-only companion in the active Phase
workspace. It is not product code and does not replace implementation screenshot
evidence. A missing, unlinked, fragment-only, or non-self-contained required
mockup stops the plan handoff. Repair the companion before proceeding. Preserve
approved older specs without mockups; do not add a retroactive requirement.

### Plan artifacts

For implementation plans, use the sibling writing-plans workflow as source
material. Save the plan to the prompt's `Plan output path`. Identify the
approved spec and each referenced mockup as plan inputs. Read available mockups
with the spec before planning the implementation.

With the default plan directory, Patchmill generates:

```text
docs/plans/YYYY-MM-DD-issue-<number>-<title-slug>.md
```

### Execution handoff

Preserve any explicit operator choice of Native or Subagent-driven execution. A
later default or recommendation does not replace that choice.

For unattended work, the configured implementation skill supplies the choice.
Record its exact reference in the plan. Do not ask for another method choice.
For `inline-dev-with-validation-and-pr-checks`, record Native through the
sibling `executing-plans` skill. The implementation session remains the sole
writer. Do not dispatch task implementers through this entrypoint.

Use this recorded choice in the plan header instead of the upstream static
Subagent-driven recommendation. Preserve custom implementation references
without mapping them to another method.

If no interactive method was supplied, keep the upstream handoff unchanged.
Explain both methods and recommend one with a reason from the plan. Keep
existing spec and plan review gates. A supplied method does not waive approval.

### Writing style

Write spec and plan prose with the sibling simple-english skill in its default
pragmatic mode. The style rules apply to the artifact's prose: keep code,
identifiers, commands, file paths, and quoted errors exact. Run the skill's
self-check on the document before you return it.

### Unattended Run-once phases

When Patchmill invokes this skill for unattended Run-once work, the prompt names
the review context: a dedicated planning pull request, a spec and plan sharing
the same phase, a verified merged-base artifact, or an artifact carried by the
implementation pull request.

In that phase:

1. Edit and commit only the requested spec or plan artifact in the active phase
   workspace. A spec commit also includes its required declared planning-only
   companions. A plan commit includes only the plan document. Do not implement
   product changes.
2. Self-review the complete document against the issue, approved source
   material, project instructions, Testing Value Gate, and simple-english
   writing style.
3. Return only the terminal JSON contract requested by the prompt.

Run-once owns push, pull request creation, review stops, merge reconciliation,
labels, and cleanup. Do not call `set-spec` or `set-plan`, create or merge a
pull request, or treat an approval label as review evidence.

After an issue has been declared ready, a stricter automation prompt may skip an
interactive approval ceremony. It does not skip document self-review.

### Testing Value Gate

Before planning a new automated test, apply Patchmill's Testing Value Gate:

- Will this test prove behavior rather than restate implementation or
  configuration?
- Could it fail for a meaningful regression?
- Will future maintainers benefit from rerunning it?
- Is the behavior reusable or risky enough to justify test maintenance?

Use automated tests by default for production behavior changes, bug fixes,
reusable logic, parsing/validation, API contracts, error handling,
security-sensitive behavior, and regressions.

Do not add new tests merely to assert workflow YAML content, dependency
versions, package lock contents, static configuration values, documentation
text, or one-off script structure. Use direct verification instead, such as
linting, syntax checks, dry-runs, builds, or existing test suites. When skipping
a new automated test, state the verification used instead.
