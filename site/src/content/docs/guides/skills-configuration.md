---
title: Skills configuration
description:
  Configure the skills Patchmill uses for planning, implementation, review, and
  workflow discipline.
---

Patchmill uses skills to keep agent behavior explicit. Skills provide reusable
instructions for triage, planning, implementation, debugging, review, visual
evidence, and repository-specific workflow rules.

## Recommended skill pack

Patchmill's recommended workflow is built on the
[Superpowers](https://github.com/obra/superpowers) skill pack plus
Patchmill-specific skills. These skills encode the planning, implementation,
debugging, review, visual-evidence, and branch-finishing discipline that
Patchmill expects when it advances an issue.

`patchmill init` installs the recommended skill pack by default when you choose
project-local skills. The installed
`.patchmill/skills/patchmill-skill-pack.json` metadata records the pack name,
version, source, and managed file checksums so `patchmill skills update` can
update Patchmill-managed files safely.

You can replace skills with repository-specific versions, but preserve the same
workflow contracts: planning skills must produce usable plans, implementation
skills must return the expected final JSON, review and landing skills must leave
auditable evidence, and visual-evidence skills must reference committed proof
files.

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

## Entry points and supporting skills

The `skills` keys in `patchmill.config.json` are workflow entry points, not the
complete list of skills an agent may use. Patchmill uses those configured values
to start a workflow stage: planning receives the planning skill, implementation
receives implementation-related skills, and optional review, visual-evidence,
landing, toolchain, and development-environment skills are added when
configured.

Once Pi is running, the agent can also use relevant skills available on its
skill path. Those skills may come from project-local skill directories, global
skill directories, packages, Pi settings, or the explicit skill paths Patchmill
passes for the current stage. Subagents are agents too, so implementation
workflows that delegate work rely on the relevant skills available to those
subagents during their task execution.

That means the recommended skill pack matters even beyond the entries listed in
`patchmill.config.json`. Supporting skills such as brainstorming, systematic
debugging, test-driven development, code review, and verification before
completion shape how agents and subagents do the work. Do not prune a
project-local skill pack down to only the configured entry-point skills unless
you also update the workflow skills that reference or expect those supporting
capabilities.

## Configuration surface

Skill configuration can point at bundled Patchmill skills, project-local skill
paths, global skill names, or custom paths. Use path-like references when the
repository should own the exact instructions used by Patchmill.

Common `skills` keys include:

- `triage`: classifies issues for automation readiness.
- `planning`: writes implementation plans.
- `implementation`: executes approved implementation plans.
- `developmentEnvironment`: prepares mutable local services before
  implementation when a repository needs them.
- `toolchain`: prepares setup or validation commands.
- `review`: runs explicit review passes.
- `visualEvidence`: default-configured skill used when visible UI changes.
- `landing`: guides direct-land versus pull-request decisions.

Initialized repositories that use project-local skills default to paths under
`.patchmill/skills/`, including `.patchmill/skills/subagent-driven-development`
for implementation and `.patchmill/skills/patchmill-visual-evidence` for visual
evidence.

## Visual evidence

The `visualEvidence` skill is part of the implementation prompt, not a separate
workflow stage, and it does not return a standalone result. When an issue
changes visible UI, the implementation agent must add or update committed
reference screenshots and include `visualEvidence` entries in the final
`pr-created` JSON.

A visual-evidence entry looks like this:

```json
{
  "visualEvidence": [
    {
      "screenshotPath": "docs/screenshots/admin-log-entries-page.png",
      "caption": "Reference screenshot for the server-driven log entries page",
      "referencePaths": ["docs/screenshots/admin-dashboard.png"]
    }
  ]
}
```

`screenshotPath` is required. It must point to a real `.png`, `.jpg`, `.jpeg`,
`.gif`, or `.webp` file inside the issue worktree. The file must be a committed
reference screenshot under `docs/screenshots/` by default, or under a configured
`projectPolicy.visualEvidence.referenceScreenshotPaths` location.

For an existing screen, update the existing reference screenshot. For a new
screen, create a stable kebab-case filename based on the route, page or
component name, or visible title. Avoid issue numbers, dates, random hashes, and
temporary proof names. `caption` should describe the represented UI state, and
`referencePaths` can list additional committed baseline screenshots used for
comparison.

If no visible UI changed, omit `visualEvidence`.

## Playwright and screenshot tooling

The bundled `.patchmill/skills/patchmill-visual-evidence` skill uses a helper
script that loads `@playwright/test` from the target project. Patchmill does not
bundle Playwright or install browser dependencies.

If the project does not already provide Playwright, the implementation agent
should use approved project screenshot tooling or ask for a setup decision
before adding a dependency.

## Updating managed skills

Run this command when Patchmill publishes a newer bundled skill pack:

```sh
npx patchmill@latest skills update
```

The update command only changes Patchmill-managed project-local skills. It stops
if managed skill files were edited locally.

## Review discipline

Skills are part of the production line. Treat skill changes like code changes:
review the diff, verify the behavior they affect, and commit updates with the
repository.
