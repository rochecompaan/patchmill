---
name: patchmill-planning
description:
  Use for Patchmill run-once spec and plan creation. Wraps sibling Superpowers
  brainstorming and writing-plans skills with Patchmill worktree, artifact path,
  and test-value policy.
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

Use paths relative to this skill directory. If those sibling skills or their
supporting files are missing, stop and ask instead of recreating them.

## Patchmill modifications

### Worktree invariant

Specs and plans are feature artifacts. Write them in the active Patchmill issue
worktree. If already running in a Patchmill issue worktree, use that worktree
and do not create another one. If working ad hoc outside an issue worktree, use
`using-git-worktrees` before writing the artifact.

Return artifact paths relative to the repository root.

### Spec artifacts

When the Patchmill prompt asks for a design spec, use the sibling brainstorming
workflow as source material, but save the validated design to:

```text
docs/specs/YYYY-MM-DD-<topic>-design.md
```

Do not save Patchmill specs under `docs/superpowers/`.

### Plan artifacts

When the Patchmill prompt asks for an implementation plan, use the sibling
writing-plans workflow as source material, but save the plan to:

```text
docs/plans/YYYY-MM-DD-<feature-name>.md
```

Do not save Patchmill plans under `docs/superpowers/`.

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
