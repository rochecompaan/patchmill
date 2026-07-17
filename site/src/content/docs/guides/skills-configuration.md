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

A few recommended project-local skills are Patchmill wrappers around pinned
Superpowers skills. Patchmill installs the upstream Superpowers skills as
siblings, then uses lightweight wrapper entry points to add repository workflow
rules. The `patchmill-planning` wrapper tells agents to read the sibling
`brainstorming` and `writing-plans` skills while saving artifacts under
`docs/specs/` and `docs/plans/` in the issue worktree. Patchmill prompts and
wrappers also apply the Testing Value Gate so agents keep automated tests as the
default for meaningful behavior and use direct verification for static docs,
workflow YAML, lockfiles, dependency versions, and similar low-value-test
changes.

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

The project-local skills directory is the broader skill path for development.
For initialized repositories this is usually `.patchmill/skills/`; custom skill
install modes can point at another project-local skills directory. During a
Patchmill run, the agent can use any relevant skill from that directory, and
subagents can use relevant skills during delegated task execution too.

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
`.patchmill/skills/`, including `.patchmill/skills/patchmill-planning` for
planning, `.patchmill/skills/subagent-driven-development` for implementation,
and `.patchmill/skills/patchmill-visual-evidence` for visual evidence.

## Landing skill

The `landing` skill guides the final direct-land versus pull-request decision.
Patchmill does not configure a default landing skill; create a project-specific
skill when a repository wants direct landing. The skill does not return a
separate standalone result. Instead, Patchmill adds the configured landing skill
to the implementation prompt, and the implementation agent returns the normal
final JSON for either `merged` or `pr-created`.

Patchmill accepts a `merged` result only when both conditions are true:

- `git.allowDirectLand` is `true`.
- `skills.landing` is configured.

Otherwise direct landing is rejected as a safety error and the agent must create
a pull request.

```json
{
  "skills": {
    "landing": ".patchmill/skills/project-landing"
  },
  "git": {
    "allowDirectLand": true
  }
}
```

A small project-local landing skill can encode the repository's default policy
and final-response requirements:

````markdown
---
name: project-landing
description: Decide when Patchmill may direct-land and when it must open a PR.
---

# Project Landing

Use this skill for the final direct-land versus pull-request decision.

Direct-land only when all of these are true:

- The issue is a trivial docs, copy, or config change; or a simple bug that was
  reproduced, fixed, and covered by validation.
- The change is small, localized, and easy to inspect from the diff.
- Required validation commands passed.
- No visible UI state requires human inspection.
- No migration, schema change, dependency change, security-sensitive behavior,
  public API change, large refactor, or ambiguous product/UX decision is
  involved.

If direct-land is eligible and Patchmill's prompt says direct landing is
allowed, squash-merge the implementation branch into the target branch, push the
target branch, close the source issue on the issue host, and return `merged`
final JSON. Include a `landingDecision` that explains why direct landing was
safe and confirms the issue was closed:

```json
{
  "status": "merged",
  "branch": "agent/issue-123-fix-empty-state",
  "mergeCommit": "<squash commit sha on target branch>",
  "commits": ["<implementation commit sha>"],
  "validation": ["npm test passed"],
  "reviewSummary": "reviewed simple localized bug fix; closed issue #123",
  "landingDecision": "direct squash-landed and closed issue: reproduced simple bug and validation passed"
}
```

For everything else, create or update a pull request and return `pr-created`
final JSON. Prefer PR fallback for visual UI changes, migrations, large
refactors, dependency updates, security-sensitive changes, and anything that
needs human product, UX, or architecture review. Include a `landingDecision`
that explains why human review is required:

```json
{
  "status": "pr-created",
  "prUrl": "<pull request URL>",
  "branch": "agent/issue-124-redesign-dashboard",
  "commits": ["<implementation commit sha>"],
  "validation": ["npm test passed", "npm run build passed"],
  "reviewSummary": "reviewed implementation and visual evidence",
  "landingDecision": "PR required: visible UI change needs human inspection"
}
```
````

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
