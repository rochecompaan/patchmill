---
title: Skills configuration
description:
  Configure the skills Patchmill uses for planning, implementation, review, and
  workflow discipline.
---

Patchmill uses skills to keep agent behavior explicit. Skills provide reusable
instructions for planning, implementation, debugging, review, and
repository-specific workflow rules.

## Project-local skills

`patchmill init` can install Patchmill-managed skills under
`.patchmill/skills/`. Project-local skills make the workflow reproducible for a
repository and allow teams to review skill changes as normal git diffs.

Common initialization modes are:

```sh
patchmill init --skills project
patchmill init --skills global
patchmill init --skills none
patchmill init --skills path:project-skills
```

## Updating managed skills

Run this command when Patchmill publishes a newer bundled skill pack:

```sh
npx patchmill@latest skills update
```

The update command only changes Patchmill-managed project-local skills. It stops
if managed skill files were edited locally.

## Configuration surface

Skill configuration can point at bundled Patchmill skills, project-local skill
paths, global skill names, or custom paths. Use path-like references when the
repository should own the exact instructions used by Patchmill.

## Review discipline

Skills are part of the production line. Treat skill changes like code changes:
review the diff, verify the behavior they affect, and commit updates with the
repository.
