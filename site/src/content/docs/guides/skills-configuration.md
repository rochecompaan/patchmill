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
`docs/specs/` and `docs/plans/` in the issue worktree, and to write spec and
plan prose with the sibling `simple-english` skill. Patchmill prompts and
wrappers also apply the Testing Value Gate so agents keep automated tests as the
default for meaningful behavior and use direct verification for static docs,
workflow YAML, lockfiles, dependency versions, and similar low-value-test
changes.

For unattended Run-once planning, the prompt identifies dedicated, same-phase,
merged-base, or implementation-carried review context. The agent edits, commits,
and self-reviews only the requested artifact and declared spec companions in its
phase workspace; Run-once owns push, pull requests, review, merge
reconciliation, labels, and cleanup.

`patchmill init` installs the recommended skill pack by default when you choose
project-local skills. The installed
`.patchmill/skills/patchmill-skill-pack.json` metadata records the pack name,
version, sources, required installed paths, upstream provenance, and managed
file checksums. `patchmill skills update` checks these records before it changes
managed files. Older metadata without per-skill records remains readable and
gains those records on update.

You can replace skills with repository-specific versions, but preserve the same
workflow contracts: planning skills must produce usable plans, implementation
skills must return the expected final JSON, review and landing skills must leave
auditable evidence, and visual-evidence skills must reference committed proof
files.

## Conditional frontend work

Pack `2026.10.2` adds `frontend-design` and `patchmill-frontend-review` as local
supporting skills. No new configuration key or phase is required. The managed
planning and inline implementation wrappers invoke them conditionally. Custom
and global entrypoints opt in through their own wrappers; updates do not change
those entrypoints.

Planning evaluates the proposed scope during brainstorming. Implementation
evaluates final delivery independently, including materialized files outside the
committed range. Each records applicability and a brief reason. Layout,
responsive behavior, styling, interaction, motion, accessibility, navigation,
and user-flow changes activate the skills. Backend and documentation work skip
them. Copy-only work activates only when it materially affects these areas.

When design applies, planning reads the frontend-design sibling as specification
guidance. It creates a self-contained HTML mockup with embedded CSS and
JavaScript. The mockup opens from disk without network assets, installation, a
build, or a server. It shows full-page context, mobile and desktop layouts,
semantic HTML, keyboard focus, and applicable reduced-motion behavior.

The author declares and links the mockup in the spec, then commits both in the
active phase workspace. Missing, unlinked, fragment-only, or non-self-contained
required mockups stop the plan handoff. Normal `writing-plans` consumes the spec
and referenced mockup. Approved older specs need no retroactive mockup. See
[Workflow artifacts](/using-patchmill/workflow-artifacts/#spec-companions) for
the declaration format and verification rules.

Frontend review follows task commands, normal whole-delivery review, its ordered
fix pass, explicit operator-configured reviews, and final validation. A fresh
canonical reviewer inspects code and available current visual evidence. It
remains read-only, shell-less, and unable to create children. The parent
supplies safe command evidence and remains the sole repair author.

Resolve every valid frontend finding, including Minor findings. Production
repairs require affected validation, independent normal repair-scope review,
accepted fixes, final commands, and fresh frontend review. Other repairs require
affected direct verification and fresh frontend review. Current-head PR-check
frontend repairs invalidate affected approval and screenshots. Refresh evidence
through existing tooling and repeat that order within the two-pass check limit.
Non-frontend work retains one normal review and one ordered fix pass.

Apply user and product requirements first, then repository policy and its design
system, the written spec, mockup intent, and generic guidance. Record reasons
for overrides and disputed findings. Do not demand pixel-perfect agreement.
Missing optional visual evidence does not block review; existing required
screenshots remain required. A planning mockup is not an implementation
screenshot.

The pack vendors Anthropic design guidance and Vercel review rules at immutable
commits. Review never fetches mutable rules. Local licenses, required paths,
upstream commits, source paths, and installed paths appear in metadata and
`THIRD_PARTY_NOTICES.md`. Missing required skills, references, or licenses block
installation or applicable review rather than trigger a download.

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

## User-global interactive skills

The separately installed human tools `patchmill-plan`, `patchmill-upload`,
`patchmill-label`, and `patchmill-cleanup` are not configured workflow entry
points. Project skill updates do not manage them. See
[Interactive skills](/using-patchmill/interactive-skills/) for installation,
invocation, authority boundaries, and handoffs.

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
- `landing`: guides PR review, validation, checks, and handoff requirements.

Initialized repositories use these project-local entrypoints:

- Planning: `.patchmill/skills/patchmill-planning`.
- Implementation: `.patchmill/skills/inline-dev-with-validation-and-pr-checks`.
- Visual evidence: `.patchmill/skills/patchmill-visual-evidence`.

The implementation session executes the whole plan through the sibling
Superpowers `executing-plans` skill. It does not dispatch task workers or
per-task reviewers. One fresh independent reviewer receives the full delivery,
the upstream template, and the Patchmill review appendix. The session completes
one ordered fix pass and reruns all final commands. Code-related PR check errors
permit at most two repair passes. A ready PR handoff requires observable passing
checks, or evidence that no required checks exist.

Namespace and user-global defaults use `superpowers:executing-plans`. This
compatibility path does not automatically include the Patchmill appendix. Use
the managed local pack for the complete Patchmill workflow.

Explicit custom implementation skills remain supported. An explicit
`skills.review` adds the operator's review workflow. An absent value adds no
extra operator-configured review pass. The managed inline wrapper still runs its
conditional frontend checkpoint. Planning preserves explicit execution choices
and unattended config choices. A supplied execution method does not waive
existing planning review gates.

## Landing skill

The `landing` skill defines PR review, validation, checks, and handoff policy.
It does not return a standalone result. Patchmill adds it to the implementation
prompt, and the agent returns `pr-created` or `blocked`.

Both planning and legacy workflows require implementation PRs. A custom skill
cannot authorize direct target-branch updates. `git.allowDirectLand` defaults to
`false`. An explicit `true` value is rejected with migration guidance.

Only Patchmill's saved-PR reconciliation can return `merged`. It verifies the
PR's identity and merge against the target base before completing finish
checkpoints.

```json
{
  "skills": {
    "landing": ".patchmill/skills/project-landing"
  },
  "git": {
    "allowDirectLand": false
  }
}
```

A small project-local landing skill can encode the repository's default policy
and final-response requirements:

````markdown
---
name: project-landing
description: Define PR review, validation, checks, and handoff requirements.
---

# Project Landing

Create or update an implementation PR from the owned branch. Do not update or
push the target branch directly. Do not merge the PR or close the issue as an
implementation handoff. Run the required validation and independent review. Wait
for passing required PR checks before the final handoff. For visible UI changes,
commit reference screenshots. For migrations or security-sensitive changes,
identify the human review requirements. Return `pr-created` JSON with validation
and review evidence:

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

The update command changes only Patchmill-managed project-local files. It stops
when managed files contain custom changes or new files collide with unmanaged
files. It does not rewrite `patchmill.config.json`.

Pack `2026.10.2` adds conditional frontend design and review without a
configuration migration. Update notices explain this addition. Customized
managed files and new-file collisions still stop updates.

Pack version `2026.10.1` retires these managed wrappers:

- `subagent-dev-with-validation-and-pr-checks`
- `subagent-dev-with-codex-and-thermo-reviews`
- `single-subagent-dev-with-codex-and-thermo-reviews`

After the update, explicitly change the implementation reference:

```json
{
  "skills": {
    "implementation": ".patchmill/skills/inline-dev-with-validation-and-pr-checks"
  }
}
```

If a managed file contains custom changes, preserve those changes first. Choose
explicitly whether to port them or keep a separate custom skill. Doctor reports
the same migration guidance for readable and missing retired managed paths.
Unrelated custom paths with matching names remain valid.

## Review discipline

Skills are part of the production line. Treat skill changes like code changes:
review the diff, verify the behavior they affect, and commit updates with the
repository.
